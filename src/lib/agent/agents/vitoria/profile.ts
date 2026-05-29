import { db } from "@/lib/db";

/**
 * ProjectProfile — contexto rico do projeto que a Vitória usa pra propor com
 * fundamento. Hidratado sob demanda; cacheado in-memory com TTL.
 *
 * Blocos:
 *  - core:        sempre presente em loadContext. US ativas + members do squad
 *                 + 3 sprints próximas. ~3-5k tokens.
 *  - sprintScope: tasks da sprint atual + próxima + grafo de bloqueios 1 hop.
 *                 Em loadContext quando há sprint definida na planning.
 *  - full:        tudo acima + description preview de cada task + AC.
 *                 Passado pros sub-agentes B1/B2 (F3+). Carregado via getter
 *                 separado.
 *
 * Cache: in-memory por processo, TTL 5min. Multi-instância: cada instância
 * mantém sua cópia (aceitável pro MVP — invalidação event-based via
 * pg_notify fica como follow-up se virar dor real).
 */

export type ProfileSprint = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  goal: string | null;
};

export type ProfileUserStory = {
  id: string;
  reference: string | null;
  title: string;
  refinementStatus: string;
  personaId: string | null;
  moduleId: string | null;
};

export type ProfileSquadMember = {
  id: string;
  name: string;
  position: string | null;
  role: string;
  seniority: string | null;
  fpCapacity: number;
  dedicationPercent: number;
};

export type ProfileTask = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  scope: string;
  complexity: string;
  functionPoints: number | null;
  priority: number;
  type: string;
  sprintId: string | null;
  userStoryId: string | null;
};

export type ProfileBlocker = {
  taskId: string;
  dependsOn: string;
  kind: string;
};

export type ProjectProfileCore = {
  projectId: string;
  upcomingSprints: ProfileSprint[];   // até 3 sprints com endDate >= hoje
  activeStories: ProfileUserStory[];  // refinement_status in (refined, committed)
  squadMembers: ProfileSquadMember[]; // members dos squads do projeto
};

export type ProjectProfileSprintScope = {
  currentSprintId: string | null;
  tasks: ProfileTask[];     // tasks da sprint atual + próxima
  blockers: ProfileBlocker[]; // deps onde origem/destino estão no escopo
};

export type ProjectProfile = {
  core: ProjectProfileCore;
  sprintScope: ProjectProfileSprintScope | null;
  computedAt: number;
};

type CacheEntry = { value: ProjectProfile; expiresAt: number };
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

function cacheKey(projectId: string, currentSprintId: string | null): string {
  return `${projectId}::${currentSprintId ?? "none"}`;
}

/**
 * Invalida cache do projeto. Chamar quando task/sprint/story mudam (do lado
 * de mutações, idealmente). Sem listener pg_notify ainda — invalidação por
 * TTL é o fallback default.
 */
export function invalidateProjectProfile(projectId: string): void {
  for (const key of CACHE.keys()) {
    if (key.startsWith(`${projectId}::`)) CACHE.delete(key);
  }
}

export async function buildProjectProfile(
  projectId: string,
  opts: { currentSprintId?: string | null } = {},
): Promise<ProjectProfile> {
  const currentSprintId = opts.currentSprintId ?? null;
  const key = cacheKey(projectId, currentSprintId);
  const hit = CACHE.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.value;

  const supabase = db();
  const todayISO = new Date().toISOString().slice(0, 10);

  // === core blocks (paralelo) ===
  const [sprintsRes, storiesRes, projectSquadsRes] = await Promise.all([
    supabase
      .from("Sprint")
      .select("id, name, startDate, endDate, status, goal")
      .eq("projectId", projectId)
      .gte("endDate", todayISO)
      .order("startDate", { ascending: true })
      .limit(3),
    supabase
      .from("UserStory")
      .select("id, reference, title, refinementStatus, personaId, moduleId")
      .in("refinementStatus", ["refined", "committed"])
      .is("dismissedAt", null)
      .or(`moduleId.in.(${await collectProjectModuleIds(projectId)})`),
    supabase
      .from("ProjectSquad")
      .select("squadId")
      .eq("projectId", projectId),
  ]);

  if (sprintsRes.error) throw sprintsRes.error;
  if (storiesRes.error) throw storiesRes.error;
  if (projectSquadsRes.error) throw projectSquadsRes.error;

  const squadIds = (projectSquadsRes.data ?? []).map((r) => r.squadId);
  const squadMembers: ProfileSquadMember[] = [];
  if (squadIds.length > 0) {
    const { data: smRows, error: smErr } = await supabase
      .from("SquadMember")
      .select(
        "memberId, member:Member(id, name, position, role, seniority, fpCapacity, dedicationPercent)",
      )
      .in("squadId", squadIds);
    if (smErr) throw smErr;

    const seen = new Set<string>();
    for (const row of smRows ?? []) {
      const m = row.member as ProfileSquadMember | null;
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      squadMembers.push(m);
    }
  }

  const core: ProjectProfileCore = {
    projectId,
    upcomingSprints: (sprintsRes.data ?? []) as ProfileSprint[],
    activeStories: (storiesRes.data ?? []) as ProfileUserStory[],
    squadMembers,
  };

  // === sprintScope (apenas se há sprint definida) ===
  let sprintScope: ProjectProfileSprintScope | null = null;
  if (currentSprintId) {
    // Sprint atual + próxima (next por startDate).
    const targetSprintIds = await resolveSprintScopeIds(projectId, currentSprintId);
    if (targetSprintIds.length > 0) {
      const { data: tasksRows, error: tasksErr } = await supabase
        .from("Task")
        .select(
          "id, reference, title, status, scope, complexity, functionPoints, priority, type, sprintId, userStoryId",
        )
        .in("sprintId", targetSprintIds)
        .is("dismissedAt", null)
        .order("priority", { ascending: false });
      if (tasksErr) throw tasksErr;
      const tasks = (tasksRows ?? []) as ProfileTask[];

      const taskIds = tasks.map((t) => t.id);
      let blockers: ProfileBlocker[] = [];
      if (taskIds.length > 0) {
        const { data: depsRows, error: depsErr } = await supabase
          .from("TaskDependency")
          .select("taskId, dependsOn, kind")
          .or(`taskId.in.(${taskIds.join(",")}),dependsOn.in.(${taskIds.join(",")})`);
        if (depsErr) throw depsErr;
        blockers = (depsRows ?? []) as ProfileBlocker[];
      }

      sprintScope = {
        currentSprintId,
        tasks,
        blockers,
      };
    } else {
      sprintScope = { currentSprintId, tasks: [], blockers: [] };
    }
  }

  const profile: ProjectProfile = {
    core,
    sprintScope,
    computedAt: now,
  };

  CACHE.set(key, { value: profile, expiresAt: now + TTL_MS });
  return profile;
}

/**
 * Resolve a lista de sprintIds em escopo: atual + próxima (próxima =
 * Sprint do mesmo projeto com menor startDate > endDate da atual).
 */
async function resolveSprintScopeIds(
  projectId: string,
  currentSprintId: string,
): Promise<string[]> {
  const supabase = db();
  const { data: current, error } = await supabase
    .from("Sprint")
    .select("id, endDate")
    .eq("id", currentSprintId)
    .single();
  if (error || !current) return [currentSprintId];

  const { data: next } = await supabase
    .from("Sprint")
    .select("id")
    .eq("projectId", projectId)
    .gt("startDate", current.endDate)
    .order("startDate", { ascending: true })
    .limit(1)
    .maybeSingle();

  return next ? [currentSprintId, next.id] : [currentSprintId];
}

/**
 * Filtro de stories por moduleId do projeto. Retorna lista pronta pra
 * usar em `.in("moduleId", ...)` (já como CSV pro .or()). Vazia → retorna
 * sentinela impossível pra não trazer nada.
 */
async function collectProjectModuleIds(projectId: string): Promise<string> {
  const supabase = db();
  const { data, error } = await supabase
    .from("Module")
    .select("id")
    .eq("projectId", projectId);
  if (error) return "00000000-0000-0000-0000-000000000000";
  const ids = (data ?? []).map((m) => m.id);
  if (ids.length === 0) return "00000000-0000-0000-0000-000000000000";
  return ids.join(",");
}
