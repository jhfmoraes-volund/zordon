/**
 * Hierarchy Tree — DAL helper compartilhado.
 *
 * Monta uma árvore Module → Story → Task a partir de um filtro de escopo
 * (Design Session OU Sprint+backlog elegível). Usado por:
 *   • GET /api/design-sessions/[id]/tree   — escopo da DS
 *   • GET /api/planning/[id]/tree          — escopo da sprint da planning
 *
 * Convenções (mesmas de src/lib/dal/story-hierarchy.ts):
 *   • db() bypassa RLS; caller valida acesso antes.
 *   • Throw em erro real; retorna estrutura vazia se a query "não achou nada".
 *
 * Não conhece nada de MeetingTaskAction — a camada pending é overlay do client
 * (a árvore só renderiza estado real do banco).
 */
import "server-only";
import { db } from "@/lib/db";
import type {
  HierarchyModuleNode,
  HierarchyStats,
  HierarchyStoryNode,
  HierarchyTaskNode,
} from "@/lib/hierarchy-tree-types";

export type {
  HierarchyModuleNode,
  HierarchyStats,
  HierarchyStoryNode,
  HierarchyTaskNode,
};

export type HierarchyFilter =
  | { kind: "design-session"; sessionId: string }
  | {
      kind: "sprint";
      sprintId: string;
      /** Inclui tasks sem sprint dos mesmos módulos da sprint. Default true. */
      includeBacklogEligible?: boolean;
    };

export type BuildHierarchyOptions = {
  projectId: string;
  filter: HierarchyFilter;
  /**
   * Inclui módulos vazios (sem stories no escopo) na árvore. DS Briefing usa
   * `true` (pra mostrar resultados de module_discovery imediatamente).
   * Planning usa `false` (só módulos tocados pela sprint).
   */
  includeEmptyModules?: boolean;
  /** Mascarar FP (guest mode). Não muda a árvore — só zera fps nos stats e nas tasks. */
  guest?: boolean;
};

export type HierarchyResult = {
  tree: HierarchyModuleNode[];
  stats: HierarchyStats;
};

// ─── Tipos internos das rows ───────────────────────────────────────────────

type ModuleRow = {
  id: string;
  name: string;
  description: string | null;
  approvedAt: string | null;
};

type StoryRow = {
  id: string;
  reference: string;
  title: string;
  want: string;
  soThat: string | null;
  refinementStatus: string;
  moduleId: string | null;
  proposedModuleName: string | null;
  personaId: string | null;
};

type TaskRow = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  functionPoints: number | null;
  complexity: string;
  scope: string;
  userStoryId: string | null;
  sprintId: string | null;
};

type AcRow = {
  taskId: string | null;
  userStoryId: string | null;
};

type PersonaRow = { id: string; name: string };

// ─── Helper principal ─────────────────────────────────────────────────────

export async function buildHierarchyTree(
  opts: BuildHierarchyOptions,
): Promise<HierarchyResult> {
  const { projectId, filter, includeEmptyModules = false, guest = false } = opts;
  const supabase = db();

  // ── Step 1 — carregar stories + tasks no escopo do filtro ─────────────
  let stories: StoryRow[];
  let tasks: Array<TaskRow & { membership: "committed" | "eligible" }>;

  if (filter.kind === "design-session") {
    const [storiesRes, tasksRes] = await Promise.all([
      supabase
        .from("UserStory")
        .select(
          "id, reference, title, want, soThat, refinementStatus, moduleId, proposedModuleName, personaId",
        )
        .eq("designSessionId", filter.sessionId)
        .is("dismissedAt", null)
        .order("createdAt", { ascending: true }),
      supabase
        .from("Task")
        .select(
          "id, reference, title, status, functionPoints, complexity, scope, userStoryId, sprintId",
        )
        .eq("designSessionId", filter.sessionId)
        .is("dismissedAt", null)
        .order("createdAt", { ascending: true }),
    ]);
    if (storiesRes.error) throw storiesRes.error;
    if (tasksRes.error) throw tasksRes.error;
    stories = (storiesRes.data ?? []) as StoryRow[];
    tasks = ((tasksRes.data ?? []) as TaskRow[]).map((t) => ({
      ...t,
      membership: "committed" as const,
    }));
  } else {
    // Sprint mode: committed = tasks da sprint; eligible = tasks sem sprint
    // dos módulos tocados pela sprint.
    const includeEligible = filter.includeBacklogEligible !== false;

    const committedTasksRes = await supabase
      .from("Task")
      .select(
        "id, reference, title, status, functionPoints, complexity, scope, userStoryId, sprintId",
      )
      .eq("sprintId", filter.sprintId)
      .is("dismissedAt", null)
      .order("createdAt", { ascending: true });
    if (committedTasksRes.error) throw committedTasksRes.error;
    const committedTasks = (committedTasksRes.data ?? []) as TaskRow[];

    // Stories ancoradoras: aquelas referenciadas pelas committed tasks.
    const storyIdsFromCommitted = new Set(
      committedTasks
        .map((t) => t.userStoryId)
        .filter((id): id is string => id !== null),
    );

    // Carrega essas stories pra descobrir os módulos.
    const anchorStoriesRes =
      storyIdsFromCommitted.size > 0
        ? await supabase
            .from("UserStory")
            .select(
              "id, reference, title, want, soThat, refinementStatus, moduleId, proposedModuleName, personaId",
            )
            .in("id", Array.from(storyIdsFromCommitted))
            .is("dismissedAt", null)
        : { data: [] as StoryRow[], error: null };
    if (anchorStoriesRes.error) throw anchorStoriesRes.error;
    const anchorStories = (anchorStoriesRes.data ?? []) as StoryRow[];

    const moduleIdsFromCommitted = new Set(
      anchorStories
        .map((s) => s.moduleId)
        .filter((id): id is string => id !== null),
    );

    let eligibleTasks: TaskRow[] = [];
    let eligibleStories: StoryRow[] = [];

    if (includeEligible && moduleIdsFromCommitted.size > 0) {
      // Pega stories de módulos tocados (incluindo as anchor).
      const moduleStoriesRes = await supabase
        .from("UserStory")
        .select(
          "id, reference, title, want, soThat, refinementStatus, moduleId, proposedModuleName, personaId",
        )
        .in("moduleId", Array.from(moduleIdsFromCommitted))
        .is("dismissedAt", null);
      if (moduleStoriesRes.error) throw moduleStoriesRes.error;
      eligibleStories = (moduleStoriesRes.data ?? []) as StoryRow[];

      const eligibleStoryIds = eligibleStories.map((s) => s.id);
      if (eligibleStoryIds.length > 0) {
        const eligibleTasksRes = await supabase
          .from("Task")
          .select(
            "id, reference, title, status, functionPoints, complexity, scope, userStoryId, sprintId",
          )
          .in("userStoryId", eligibleStoryIds)
          .is("sprintId", null)
          .is("dismissedAt", null)
          .order("createdAt", { ascending: true });
        if (eligibleTasksRes.error) throw eligibleTasksRes.error;
        eligibleTasks = (eligibleTasksRes.data ?? []) as TaskRow[];
      }
    }

    // União final de stories: anchor ∪ eligible (dedup).
    const storyById = new Map<string, StoryRow>();
    for (const s of anchorStories) storyById.set(s.id, s);
    for (const s of eligibleStories) if (!storyById.has(s.id)) storyById.set(s.id, s);
    stories = Array.from(storyById.values());

    tasks = [
      ...committedTasks.map((t) => ({ ...t, membership: "committed" as const })),
      ...eligibleTasks.map((t) => ({ ...t, membership: "eligible" as const })),
    ];
  }

  // ── Step 2 — carregar módulos + personas + AC counts ────────────────
  // Módulos: pra DS pega todos do projeto (pra mostrar módulos vazios resultantes
  // de module_discovery). Pra Sprint só os tocados.
  const moduleIdsTouched = new Set(
    stories
      .map((s) => s.moduleId)
      .filter((id): id is string => id !== null),
  );

  const storyIds = stories.map((s) => s.id);
  const taskIds = tasks.map((t) => t.id);

  const [modulesRes, personasRes, acByStoryRes, acByTaskRes] = await Promise.all([
    includeEmptyModules
      ? supabase
          .from("Module")
          .select("id, name, description, approvedAt")
          .eq("projectId", projectId)
      : moduleIdsTouched.size > 0
        ? supabase
            .from("Module")
            .select("id, name, description, approvedAt")
            .in("id", Array.from(moduleIdsTouched))
        : { data: [] as ModuleRow[], error: null },
    supabase
      .from("ProjectPersona")
      .select("id, name")
      .eq("projectId", projectId),
    // AC contagem: dois fetches separados pra não puxar a tabela inteira (a
    // versão DS legada fazia FULL TABLE SCAN sem filter — péssimo a longo prazo).
    storyIds.length > 0
      ? supabase
          .from("AcceptanceCriterion")
          .select("taskId, userStoryId")
          .in("userStoryId", storyIds)
      : { data: [] as AcRow[], error: null },
    taskIds.length > 0
      ? supabase
          .from("AcceptanceCriterion")
          .select("taskId, userStoryId")
          .in("taskId", taskIds)
      : { data: [] as AcRow[], error: null },
  ]);

  if (modulesRes.error) throw modulesRes.error;
  if (personasRes.error) throw personasRes.error;
  if (acByStoryRes.error) throw acByStoryRes.error;
  if (acByTaskRes.error) throw acByTaskRes.error;

  const modules = (modulesRes.data ?? []) as ModuleRow[];
  const personas = (personasRes.data ?? []) as PersonaRow[];

  // ── Step 3 — contagens de AC ─────────────────────────────────────────
  const acByStory = new Map<string, number>();
  const acByTask = new Map<string, number>();
  for (const ac of (acByStoryRes.data ?? []) as AcRow[]) {
    if (ac.userStoryId) {
      acByStory.set(ac.userStoryId, (acByStory.get(ac.userStoryId) ?? 0) + 1);
    }
  }
  for (const ac of (acByTaskRes.data ?? []) as AcRow[]) {
    if (ac.taskId) {
      acByTask.set(ac.taskId, (acByTask.get(ac.taskId) ?? 0) + 1);
    }
  }

  // ── Step 4 — bucket de tasks por story ─────────────────────────────
  const tasksByStory = new Map<string, HierarchyTaskNode[]>();
  for (const t of tasks) {
    if (!t.userStoryId) continue;
    const list = tasksByStory.get(t.userStoryId) ?? [];
    list.push({
      id: t.id,
      reference: t.reference,
      title: t.title,
      status: t.status,
      functionPoints: guest ? null : t.functionPoints,
      complexity: t.complexity,
      scope: t.scope,
      acTechnicalCount: acByTask.get(t.id) ?? 0,
      sprintId: t.sprintId,
      membership: t.membership,
    });
    tasksByStory.set(t.userStoryId, list);
  }

  // ── Step 5 — agrupar stories por chave de módulo ──────────────────
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const personaById = new Map(personas.map((p) => [p.id, p]));

  type Group = HierarchyModuleNode;
  const groupByKey = new Map<string, Group>();

  // 5a. Pre-popula módulos (todos do projeto pra DS; só os tocados pra Sprint).
  for (const m of modules) {
    groupByKey.set(`module:${m.id}`, {
      key: `module:${m.id}`,
      moduleId: m.id,
      name: m.name,
      description: m.description,
      approved: m.approvedAt !== null,
      approvedAt: m.approvedAt,
      stories: [],
    });
  }

  // 5b. Coloca stories nos grupos certos.
  for (const s of stories) {
    let key: string;
    let group: Group | undefined;

    if (s.moduleId && moduleById.has(s.moduleId)) {
      key = `module:${s.moduleId}`;
      group = groupByKey.get(key);
    } else if (s.proposedModuleName) {
      key = `proposed:${s.proposedModuleName}`;
      group = groupByKey.get(key);
      if (!group) {
        group = {
          key,
          moduleId: null,
          name: s.proposedModuleName,
          description: null,
          approved: false,
          approvedAt: null,
          stories: [],
        };
        groupByKey.set(key, group);
      }
    } else {
      key = "_orphan_";
      group = groupByKey.get(key);
      if (!group) {
        group = {
          key,
          moduleId: null,
          name: "(sem módulo)",
          description: null,
          approved: false,
          approvedAt: null,
          stories: [],
        };
        groupByKey.set(key, group);
      }
    }

    if (!group) continue; // defensive (não deveria acontecer)

    group.stories.push({
      id: s.id,
      reference: s.reference,
      title: s.title,
      want: s.want,
      soThat: s.soThat,
      refinementStatus: s.refinementStatus,
      persona: s.personaId ? personaById.get(s.personaId) ?? null : null,
      acProductCount: acByStory.get(s.id) ?? 0,
      tasks: tasksByStory.get(s.id) ?? [],
    });
  }

  // 5c. Filtra módulos vazios se solicitado (default pra sprint mode).
  let treeEntries = Array.from(groupByKey.values());
  if (!includeEmptyModules) {
    treeEntries = treeEntries.filter((g) => g.stories.length > 0);
  }

  // 5d. Ordena: módulos aprovados primeiro (alpha), depois propostos (alpha), orphan último.
  const tree = treeEntries.sort((a, b) => {
    const rank = (g: Group) =>
      g.key.startsWith("module:") ? 0 : g.key.startsWith("proposed:") ? 1 : 2;
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return a.name.localeCompare(b.name);
  });

  // ── Step 6 — stats agregados ────────────────────────────────────────
  const committedTasks = tasks.filter((t) => t.membership === "committed");
  const eligibleTasksArr = tasks.filter((t) => t.membership === "eligible");
  const draftTasks = tasks.filter((t) => t.status === "draft").length;
  const sumFp = (list: typeof tasks) =>
    list.reduce((s, t) => s + (t.functionPoints ?? 0), 0);

  const stats: HierarchyStats = {
    totalStories: stories.length,
    totalTasks: tasks.length,
    committedTasks: committedTasks.length,
    eligibleTasks: eligibleTasksArr.length,
    draftTasks,
    totalFp: guest ? 0 : sumFp(tasks),
    committedFp: guest ? 0 : sumFp(committedTasks),
    eligibleFp: guest ? 0 : sumFp(eligibleTasksArr),
    proposedModulesCount: tree.filter((g) => g.key.startsWith("proposed:")).length,
    approvedModulesCount: tree.filter(
      (g) => g.key.startsWith("module:") && g.approved,
    ).length,
  };

  return { tree, stats };
}
