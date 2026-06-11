import "server-only";
import { db } from "@/lib/db";

/**
 * Camada determinística da Wiki (PRD project-wiki §6.2): métricas live por
 * SQL, sem LLM. Cache em memória 5min por projeto — é leitura executiva,
 * não telemetria de precisão.
 *
 * FP vive em Task.functionPoints (não existe tabela FunctionPoint).
 */

export type WikiMetrics = {
  hero: {
    sprintNumber: number | null;
    sprintName: string | null;
    /** Dia corrente dentro da sprint ativa (1..7, modelo seg→dom). */
    sprintDay: number | null;
    completionPercent: number;
    fpDone: number;
    fpTotal: number;
    /** Dias até o fim da sprint ativa (próximo marco). */
    nextMilestoneDays: number | null;
  };
  metrics: {
    /** Últimas 3 sprints concluídas (velocity = FP done por sprint). */
    velocity: Array<{ sprintName: string; fpDone: number; tasksDone: number }>;
  };
  team: Array<{
    memberId: string;
    name: string;
    role: string;
    position: string | null;
  }>;
  roadmap: Array<{
    kind: "sprint" | "design_session";
    id: string;
    title: string;
    date: string | null;
  }>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: WikiMetrics }>();

function sprintNumberFromName(name: string): number | null {
  const match = name.match(/sprint\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getWikiMetrics(projectId: string): Promise<WikiMetrics> {
  const cached = cache.get(projectId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const supabase = db();
  const nowIso = new Date().toISOString();

  const [activeSprintRes, tasksRes, doneSprintsRes, accessRes, upcomingRes, dsRes] =
    await Promise.all([
      supabase
        .from("Sprint")
        .select("id, name, startDate, endDate")
        .eq("projectId", projectId)
        .eq("status", "active")
        .order("startDate", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("Task")
        .select("status, functionPoints, sprintId")
        .eq("projectId", projectId)
        .is("dismissedAt", null)
        .neq("status", "draft"),
      supabase
        .from("Sprint")
        .select("id, name, endDate")
        .eq("projectId", projectId)
        .eq("status", "completed")
        .order("endDate", { ascending: false })
        .limit(3),
      supabase
        .from("ProjectAccess")
        .select("userId, role")
        .eq("projectId", projectId),
      supabase
        .from("Sprint")
        .select("id, name, startDate")
        .eq("projectId", projectId)
        .eq("status", "upcoming")
        .order("startDate", { ascending: true })
        .limit(3),
      supabase
        .from("DesignSession")
        .select("id, title, scheduledAt")
        .eq("projectId", projectId)
        .gte("scheduledAt", nowIso)
        .order("scheduledAt", { ascending: true })
        .limit(3),
    ]);

  const tasks = tasksRes.data ?? [];
  const fpOf = (t: { functionPoints: number | null }) => t.functionPoints ?? 0;
  const doneTasks = tasks.filter((t) => t.status === "done");
  const fpTotal = tasks.reduce((sum, t) => sum + fpOf(t), 0);
  const fpDone = doneTasks.reduce((sum, t) => sum + fpOf(t), 0);
  const completionPercent =
    tasks.length > 0 ? Math.round((doneTasks.length / tasks.length) * 100) : 0;

  const sprint = activeSprintRes.data;
  let sprintDay: number | null = null;
  let nextMilestoneDays: number | null = null;
  if (sprint?.startDate) {
    sprintDay = Math.min(
      7,
      Math.max(1, Math.floor((Date.now() - new Date(sprint.startDate).getTime()) / DAY_MS) + 1)
    );
  }
  if (sprint?.endDate) {
    nextMilestoneDays = Math.max(
      0,
      Math.ceil((new Date(sprint.endDate).getTime() - Date.now()) / DAY_MS)
    );
  }

  // Velocity: FP done por sprint concluída (tasks done com sprintId nelas).
  const doneSprints = doneSprintsRes.data ?? [];
  const velocity = doneSprints.map((s) => {
    const sprintTasks = doneTasks.filter((t) => t.sprintId === s.id);
    return {
      sprintName: s.name,
      fpDone: sprintTasks.reduce((sum, t) => sum + fpOf(t), 0),
      tasksDone: sprintTasks.length,
    };
  });

  // Team: ProjectAccess.userId → Member.userId (auth user em comum).
  const access = accessRes.data ?? [];
  const userIds = access.map((a) => a.userId).filter(Boolean);
  let team: WikiMetrics["team"] = [];
  if (userIds.length > 0) {
    const { data: members } = await supabase
      .from("Member")
      .select("id, name, userId, position")
      .in("userId", userIds);
    team = access.flatMap((a) => {
      const member = (members ?? []).find((m) => m.userId === a.userId);
      if (!member) return [];
      return [
        {
          memberId: member.id,
          name: member.name,
          role: a.role,
          position: member.position ?? null,
        },
      ];
    });
  }

  const roadmap: WikiMetrics["roadmap"] = [
    ...(upcomingRes.data ?? []).map((s) => ({
      kind: "sprint" as const,
      id: s.id,
      title: s.name,
      date: s.startDate,
    })),
    ...(dsRes.data ?? []).map((d) => ({
      kind: "design_session" as const,
      id: d.id,
      title: d.title,
      date: d.scheduledAt,
    })),
  ];

  const value: WikiMetrics = {
    hero: {
      sprintNumber: sprint ? sprintNumberFromName(sprint.name) : null,
      sprintName: sprint?.name ?? null,
      sprintDay,
      completionPercent,
      fpDone,
      fpTotal,
      nextMilestoneDays,
    },
    metrics: { velocity },
    team,
    roadmap,
  };

  cache.set(projectId, { at: Date.now(), value });
  return value;
}
