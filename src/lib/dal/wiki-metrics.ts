import "server-only";
import { db } from "@/lib/db";

/**
 * Camada determinística da Wiki (PRD project-wiki §6.2): métricas live por
 * SQL, sem LLM. Cache em memória 5min por projeto — é leitura executiva,
 * não telemetria de precisão.
 *
 * PFV vive em Task.functionPoints (não existe tabela FunctionPoint).
 */

/** Tipos de evento do log de Atividade recente (WER-002). */
export type WikiActivityKind =
  | "sprint"
  | "planning"
  | "design_session"
  | "phase"
  | "pm_review";

export type WikiMetrics = {
  /** Introdução executiva determinística (WER-001) — sempre renderizável. */
  identity: {
    projectName: string;
    status: string;
    phase: string;
    phaseChangedAt: string | null;
    startDate: string | null;
    endDate: string | null;
    clientName: string;
    /** Path no bucket client-logos (cru); resolve via <ClientLogo>. */
    clientLogoPath: string | null;
    clientLogoUpdatedAt: string | null;
  };
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
    /** Últimas 3 sprints concluídas (velocity = PFV done por sprint). */
    velocity: Array<{ sprintName: string; fpDone: number; tasksDone: number }>;
  };
  /** TODAS as sprints do projeto → cronograma de blocos (WER-001/003). */
  sprints: Array<{
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    doneTaskCount: number;
  }>;
  /** Log de atividade recente, mais novo primeiro, máx 6 (WER-002). */
  activity: Array<{
    kind: WikiActivityKind;
    title: string;
    /** ISO do evento. */
    date: string;
    href: string | null;
  }>;
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

const PHASE_LABELS: Record<string, string> = {
  commercial: "Comercial",
  immersion: "Imersão",
  ops: "Operação",
  post_ops: "Pós-operação",
};
const phaseLabel = (p: string | null): string =>
  p ? (PHASE_LABELS[p] ?? p) : "—";

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

  const [
    activeSprintRes,
    tasksRes,
    doneSprintsRes,
    accessRes,
    upcomingRes,
    dsRes,
    projectRes,
    allSprintsRes,
    planningSessionsRes,
    phaseEventsRes,
    pmReviewsRes,
    completedDsRes,
  ] = await Promise.all([
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
    // ── identity (WER-001) ──
    supabase
      .from("Project")
      .select(
        "name, status, phase, phaseChangedAt, startDate, endDate, Client(name, logoStoragePath, logoUpdatedAt)"
      )
      .eq("id", projectId)
      .maybeSingle(),
    // ── todas as sprints → cronograma (WER-001) ──
    supabase
      .from("Sprint")
      .select("id, name, startDate, endDate")
      .eq("projectId", projectId)
      .order("startDate", { ascending: true }),
    // ── activity (WER-002) ──
    supabase
      .from("PlanningSession")
      .select("id")
      .eq("projectId", projectId),
    supabase
      .from("ProjectPhaseEvent")
      .select("fromPhase, toPhase, changedAt")
      .eq("projectId", projectId)
      .order("changedAt", { ascending: false })
      .limit(6),
    supabase
      .from("PMReview")
      .select("referenceWeek, publishedAt")
      .eq("projectId", projectId)
      .not("publishedAt", "is", null)
      .order("publishedAt", { ascending: false })
      .limit(6),
    supabase
      .from("DesignSession")
      .select("id, title, completedAt")
      .eq("projectId", projectId)
      .not("completedAt", "is", null)
      .order("completedAt", { ascending: false })
      .limit(6),
  ]);

  // PlanningEvent é 2-hop (via PlanningSession do projeto).
  const planningSessionIds = (planningSessionsRes.data ?? []).map((s) => s.id);
  let planningEvents: Array<{ appliedCount: number; createdAt: string }> = [];
  if (planningSessionIds.length > 0) {
    const { data } = await supabase
      .from("PlanningEvent")
      .select("appliedCount, createdAt")
      .in("planningSessionId", planningSessionIds)
      .order("createdAt", { ascending: false })
      .limit(6);
    planningEvents = data ?? [];
  }

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

  // Velocity: PFV done por sprint concluída (tasks done com sprintId nelas).
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

  // Identity (WER-001): Project + Client embedado. Client é 1:1 (FK clientId).
  const project = projectRes.data;
  const client = (project?.Client ?? null) as {
    name: string;
    logoStoragePath: string | null;
    logoUpdatedAt: string | null;
  } | null;
  const identity: WikiMetrics["identity"] = {
    projectName: project?.name ?? "",
    status: project?.status ?? "",
    phase: project?.phase ?? "",
    phaseChangedAt: project?.phaseChangedAt ?? null,
    startDate: project?.startDate ?? null,
    endDate: project?.endDate ?? null,
    clientName: client?.name ?? "—",
    clientLogoPath: client?.logoStoragePath ?? null,
    clientLogoUpdatedAt: client?.logoUpdatedAt ?? null,
  };

  // Cronograma (WER-001): todas as sprints + nº de tasks done por sprint.
  const doneCountBySprint = new Map<string, number>();
  for (const t of doneTasks) {
    if (t.sprintId) {
      doneCountBySprint.set(t.sprintId, (doneCountBySprint.get(t.sprintId) ?? 0) + 1);
    }
  }
  const sprints: WikiMetrics["sprints"] = (allSprintsRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    startDate: s.startDate,
    endDate: s.endDate,
    doneTaskCount: doneCountBySprint.get(s.id) ?? 0,
  }));

  // Atividade recente (WER-002): une 5 fontes, ordena desc, top 6.
  const activity: WikiMetrics["activity"] = [
    ...sprints
      .filter((s) => s.startDate <= nowIso)
      .map((s) => ({
        kind: "sprint" as const,
        title: `${s.name} iniciada`,
        date: s.startDate,
        href: null,
      })),
    ...planningEvents.map((e) => ({
      kind: "planning" as const,
      title: `Planning aplicada — ${e.appliedCount} task${e.appliedCount === 1 ? "" : "s"}`,
      date: e.createdAt,
      href: null,
    })),
    ...(completedDsRes.data ?? []).map((d) => ({
      kind: "design_session" as const,
      title: `DS "${d.title}" aprovada`,
      date: d.completedAt as string,
      href: null,
    })),
    ...(phaseEventsRes.data ?? []).map((p) => ({
      kind: "phase" as const,
      title: `Fase: ${phaseLabel(p.fromPhase)} → ${phaseLabel(p.toPhase)}`,
      date: p.changedAt,
      href: null,
    })),
    ...(pmReviewsRes.data ?? []).map((r) => ({
      kind: "pm_review" as const,
      title: `PM Review semana ${r.referenceWeek} publicado`,
      date: r.publishedAt as string,
      href: null,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  const value: WikiMetrics = {
    identity,
    sprints,
    activity,
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
