/**
 * Project Overview — DAL para a aba "Projetos" do Overview.
 *
 * Cruza, por projeto:
 *   • STATS — prazo (régua de semanas do contrato), entrega (sprints fechadas
 *     + escopo FP), ritmo (média FP/sprint + aproveitamento) e projeção de
 *     término. Dicionário de métricas: docs/features/overview/stats-dictionary.md
 *   • capacidade da sprint corrente (sprint_capacity_overview)
 *   • sinais operacionais (vencidas / paradas +3d / sem dono)
 *   • PM Review — digest executivo da Vitoria (audience='executive') com
 *     fallback nas notes detail; janela de semanas pra navegação
 *
 * e deriva um `health` (red/amber/green) — sem coluna nova, tudo computado.
 *
 * Convenção: `db()` (service_role) bypassa RLS de propósito; o caller (página)
 * valida acesso ANTES via requireMinLevel. Espelha src/lib/dal/pm-review.ts.
 */
import "server-only";
import { db } from "@/lib/db";
import { OPEN_STATUSES } from "@/lib/function-points";
import { mondayOf } from "@/lib/dal/pm-review";

export type ProjectCategory = "billable" | "non_billable" | "internal";
export type ProjectPhase = "commercial" | "immersion" | "ops" | "post_ops";
export type ProjectEngagement = "fixed_scope" | "continuous";
export type ProjectHealth = "red" | "amber" | "green";

export type ProjectTeamMember = { id: string; name: string; position: string | null };

export type PMReviewNoteLite = {
  kind: string;
  content: string;
  priority: number;
  /** Data do marco — só kind='milestone' preenche. */
  dueAt: string | null;
  /** Postura do risco — só kind='risk' preenche (managed | needs_action | escalate). */
  stance: string | null;
};

// ─── STATS ──────────────────────────────────────────────────────────────────

/** Um segmento da régua = uma semana do contrato (ou uma sprint, em rolling). */
export type ReguaSegment = {
  /** Segunda-feira da semana (YYYY-MM-DD). */
  monday: string;
  sprintId: string | null;
  /**
   * closed  — semana passada com sprint (deliveryPct colore)
   * hole    — semana passada SEM sprint (contrato queimou sem produção)
   * current — semana corrente (sprintId null = produção sem sprint ativa)
   * future  — semana futura
   */
  kind: "closed" | "hole" | "current" | "future";
  /** done/planned da sprint (0-100); null sem sprint ou sem planned. */
  deliveryPct: number | null;
};

export type PaceVerdict = "ahead" | "on_track" | "behind" | "critical";

export type ProjectStats = {
  /**
   * contract — fixed_scope com datas: régua finita + prazo + projeção
   * rolling  — sem prazo (contínuo ou sem datas), com sprints: janela das últimas
   * none     — sem sprint nenhuma
   */
  mode: "contract" | "rolling" | "none";
  // PRAZO (só contract)
  /** Sprints estimadas = semanas-calendário do contrato (seg→dom, CHECK no DB). */
  weeksTotal: number | null;
  weeksElapsed: number | null;
  timePct: number | null;
  // ENTREGA
  /** Sprints com status completed ou endDate passada. */
  sprintsClosed: number;
  /** Done% guiado por sprint: fechadas ÷ estimadas (só contract). */
  donePct: number | null;
  /** Semanas decorridas sem nenhuma sprint cobrindo (só contract). */
  holes: number;
  fpDone: number;
  fpTotal: number;
  /** FP done ÷ FP total do backlog vivo; null sem FP estimado. */
  scopePct: number | null;
  // RITMO
  /** Σ done ÷ n, últimas 6 sprints fechadas com planned > 0. */
  avgFpPerSprint: number | null;
  /** Σ done ÷ Σ capacity na mesma janela (0-100). */
  utilizationPct: number | null;
  /** Σ done ÷ Σ planned na mesma janela (0-100) — entrega do planejado. */
  deliveryRatePct: number | null;
  /** Amostra da janela de ritmo (fechadas com planned > 0, máx 6) — gate de maturidade na UI. */
  deliverySprints: number;
  /** scopePct − timePct (pontos percentuais). */
  paceGapPp: number | null;
  paceVerdict: PaceVerdict | null;
  /** Nº da sprint projetada de término (1-based; pode exceder weeksTotal). */
  projectedEndWeek: number | null;
  // RÉGUA
  segments: ReguaSegment[];
  /** Índice do segmento corrente em `segments`; null fora da janela. */
  currentIndex: number | null;
  /** Índice do segmento onde o marco (⚑) cai; null fora da régua. */
  milestoneIndex: number | null;
};

/** Sprints fechadas na amostra de ritmo (média FP/sprint + aproveitamento). */
const RHYTHM_WINDOW = 6;
/** Sprints exibidas na régua rolante de projetos sem prazo. */
const ROLLING_WINDOW = 8;

export type ProjectOverview = {
  id: string;
  name: string;
  category: ProjectCategory;
  phase: ProjectPhase;
  engagementType: ProjectEngagement;
  startDate: string | null;
  /** Estimativa de fim — só para `fixed_scope`; `null` em contínuos. */
  endDate: string | null;
  status: string;
  /** Criação do projeto — alimenta o big-number "novos no mês". */
  createdAt: string;
  /** Entrada na fase atual (backfill: createdAt). */
  phaseChangedAt: string;
  daysInPhase: number;
  /** Convenção de nome — escondido por default na UI. */
  isEval: boolean;
  clientName: string | null;
  pmName: string | null;
  team: ProjectTeamMember[];
  stats: ProjectStats;
  sprint: {
    name: string;
    capacity: number;
    planned: number;
    done: number;
    open: number;
    /** done / planned — progresso dentro da sprint. */
    pct: number;
    /** planned / capacity — comprometimento de carga. */
    loadPct: number;
  } | null;
  signals: { overdue: number; blocked: number; unassigned: number };
  /** Próximo marco declarado pela Vitoria (note kind='milestone' com dueAt). */
  milestone: { label: string; dueAt: string } | null;
  /** Review default (semana corrente, senão a mais recente) — dirige health/sinais. */
  pmReview: PMReviewDigestEntry | null;
  /**
   * Janela fixa das últimas semanas (desc, começa na corrente) — chips de
   * navegação. `review: null` = semana sem PM Review (chip desabilitado).
   */
  weeks: Array<{ week: string; isCurrentWeek: boolean; review: PMReviewDigestEntry | null }>;
  health: ProjectHealth;
};

export type PMReviewDigestEntry = {
  id: string;
  referenceWeek: string;
  isCurrentWeek: boolean;
  /** Quando a review foi publicada — null enquanto draft. */
  publishedAt: string | null;
  reportMarkdown: string | null;
  /** Notes de trabalho (audience='detail') — alimentam health e sinais. */
  notesByKind: Record<string, PMReviewNoteLite[]>;
  /**
   * Conteúdo dos cards do Overview: digest executivo curado pela Vitoria
   * (audience='executive') quando existir; senão, fallback nas detail.
   */
  digestByKind: Record<string, PMReviewNoteLite[]>;
};

/** Números da fábrica pro ribbon do topo (independem da lista de projetos). */
export type FactoryStats = {
  membersTotal: number;
  builders: number;
};

/** Tamanho da janela de semanas nos chips de navegação (corrente + anteriores). */
const WEEK_CHIP_COUNT = 4;

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); // Monday
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date: Date): Date {
  const end = startOfWeek(date);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Soma N semanas a uma segunda-feira ISO (YYYY-MM-DD). */
function addWeeksISO(mondayISO: string, weeks: number): string {
  const d = new Date(`${mondayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * weeks);
  return d.toISOString().slice(0, 10);
}

/** Semanas inteiras entre duas segundas ISO (to − from). */
function diffWeeksISO(fromMonday: string, toMonday: string): number {
  return Math.round(
    (Date.parse(`${toMonday}T00:00:00Z`) - Date.parse(`${fromMonday}T00:00:00Z`)) /
      (7 * 86400000),
  );
}

type CapRow = {
  sprintId: string;
  capacity: number | null;
  planned: number | null;
  done: number | null;
  open: number | null;
};
/** sprint_delivery_overview — entrega por task (sem join de assignment). */
type DeliveryRow = {
  sprintId: string;
  planned: number | null;
  done: number | null;
  tasks_sem_fp: number | null;
};
type SprintRow = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  projectId: string | null;
};
type ReviewRow = {
  id: string;
  projectId: string;
  referenceWeek: string;
  reportMarkdown: string | null;
  status: string;
  publishedAt: string | null;
};
type NoteRow = {
  pmReviewId: string;
  kind: string;
  content: string;
  priority: number | null;
  audience: string;
  dueAt: string | null;
  stance: string | null;
};
type ProjectRow = {
  id: string;
  name: string;
  category: string | null;
  phase: string | null;
  engagementType: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  createdAt: string;
  phaseChangedAt: string;
  client: { name: string | null } | null;
  pm: { name: string | null } | null;
  projectMembers:
    | { member: { id: string; name: string | null; position: string | null } | null }[]
    | null;
};

function countByProject(rows: { projectId: string | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.projectId) continue;
    m.set(r.projectId, (m.get(r.projectId) ?? 0) + 1);
  }
  return m;
}

// ─── Motor de STATS ─────────────────────────────────────────────────────────

/**
 * Computa os STATS de um projeto. Função pura — toda métrica é derivada,
 * nada é coluna editável. Fórmulas defendidas no dicionário:
 * docs/features/overview/stats-dictionary.md
 */
function computeStats(args: {
  engagementType: ProjectEngagement;
  startDate: string | null;
  endDate: string | null;
  /** Todas as sprints do projeto, asc por startDate. */
  sprints: SprintRow[];
  capBySprint: Map<string, CapRow>;
  deliveryBySprint: Map<string, DeliveryRow>;
  fpDone: number;
  fpTotal: number;
  milestoneDueAt: string | null;
  currentMonday: string;
  now: Date;
}): ProjectStats {
  const {
    engagementType,
    startDate,
    endDate,
    sprints,
    capBySprint,
    deliveryBySprint,
    fpDone,
    fpTotal,
    milestoneDueAt,
    currentMonday,
    now,
  } = args;

  const isClosed = (s: SprintRow) => s.status === "completed" || new Date(s.endDate) < now;
  const closed = sprints.filter(isClosed);
  const sprintsClosed = closed.length;
  const scopePct = fpTotal > 0 ? Math.round((fpDone / fpTotal) * 100) : null;

  // RITMO — janela das últimas N fechadas com planned > 0 (sprint vazia não é
  // amostra de capacidade; semana sem sprint já aparece como buraco na régua).
  // Entrega (planned/done) vem da sprint_delivery_overview — por task, sem furo
  // de task-sem-dono nem double-count. Capacity segue na capacity_overview
  // (alocação é por membro por natureza).
  const rhythmSample = [...closed]
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
    .map((s) => ({
      delivery: deliveryBySprint.get(s.id),
      capacity: Number(capBySprint.get(s.id)?.capacity) || 0,
    }))
    .filter((r) => Number(r.delivery?.planned) > 0)
    .slice(0, RHYTHM_WINDOW);
  const sampleDone = rhythmSample.reduce((sum, r) => sum + (Number(r.delivery?.done) || 0), 0);
  const samplePlanned = rhythmSample.reduce(
    (sum, r) => sum + (Number(r.delivery?.planned) || 0),
    0,
  );
  const sampleCapacity = rhythmSample.reduce((sum, r) => sum + r.capacity, 0);
  const avgFpPerSprint =
    rhythmSample.length > 0 ? Math.round((sampleDone / rhythmSample.length) * 10) / 10 : null;
  const utilizationPct =
    sampleCapacity > 0 ? Math.round((sampleDone / sampleCapacity) * 100) : null;
  const deliverySprints = rhythmSample.length;
  const deliveryRatePct =
    samplePlanned > 0 ? Math.round((sampleDone / samplePlanned) * 100) : null;

  // Sprint por segunda-feira — sprints são seg→dom (CHECK no DB), 1 por semana.
  const sprintByMonday = new Map<string, SprintRow>();
  for (const s of sprints) {
    const monday = mondayOf(new Date(s.startDate));
    if (!sprintByMonday.has(monday)) sprintByMonday.set(monday, s);
  }

  const deliveryOf = (s: SprintRow): number | null => {
    const d = deliveryBySprint.get(s.id);
    if (!d || !(Number(d.planned) > 0)) return null;
    return Math.round((Number(d.done) / Number(d.planned)) * 100);
  };

  const isContract = engagementType === "fixed_scope" && !!startDate && !!endDate;

  if (isContract) {
    const startMonday = mondayOf(new Date(startDate));
    const endMonday = mondayOf(new Date(endDate));
    const weeksTotal = Math.max(1, diffWeeksISO(startMonday, endMonday) + 1);
    const rawElapsed = diffWeeksISO(startMonday, currentMonday) + 1; // corrente conta
    const weeksElapsed = Math.min(Math.max(rawElapsed, 0), weeksTotal);
    const timePct = Math.round((weeksElapsed / weeksTotal) * 100);
    const donePct = Math.round((sprintsClosed / weeksTotal) * 100);

    const segments: ReguaSegment[] = [];
    for (let i = 0; i < weeksTotal; i++) {
      const monday = addWeeksISO(startMonday, i);
      const sprint = sprintByMonday.get(monday) ?? null;
      let kind: ReguaSegment["kind"];
      if (monday > currentMonday) kind = "future";
      else if (monday === currentMonday) kind = "current";
      else kind = sprint ? "closed" : "hole";
      segments.push({
        monday,
        sprintId: sprint?.id ?? null,
        kind,
        deliveryPct: sprint && kind !== "future" ? deliveryOf(sprint) : null,
      });
    }

    const holes = segments.filter((g) => g.kind === "hole").length;
    const currentIndex = segments.findIndex((g) => g.kind === "current");

    let projectedEndWeek: number | null = null;
    if (avgFpPerSprint && avgFpPerSprint > 0 && fpTotal > 0) {
      const remaining = Math.max(0, fpTotal - fpDone);
      projectedEndWeek = weeksElapsed + Math.ceil(remaining / avgFpPerSprint);
    }

    const paceGapPp = scopePct !== null ? scopePct - timePct : null;
    const paceVerdict: PaceVerdict | null =
      paceGapPp === null
        ? null
        : paceGapPp >= 5
          ? "ahead"
          : paceGapPp >= -5
            ? "on_track"
            : paceGapPp >= -15
              ? "behind"
              : "critical";

    let milestoneIndex: number | null = null;
    if (milestoneDueAt) {
      const idx = diffWeeksISO(startMonday, mondayOf(new Date(milestoneDueAt)));
      if (idx >= 0 && idx < weeksTotal) milestoneIndex = idx;
    }

    return {
      mode: "contract",
      weeksTotal,
      weeksElapsed,
      timePct,
      sprintsClosed,
      donePct,
      holes,
      fpDone,
      fpTotal,
      scopePct,
      avgFpPerSprint,
      utilizationPct,
      deliveryRatePct,
      deliverySprints,
      paceGapPp,
      paceVerdict,
      projectedEndWeek,
      segments,
      currentIndex: currentIndex >= 0 ? currentIndex : null,
      milestoneIndex,
    };
  }

  if (sprints.length > 0) {
    // Rolling — sem prazo não há régua finita, % de prazo, pace nem projeção.
    // Fingir que há seria indefensável; a leitura vira consistência de ritmo.
    const lastSprints = sprints.slice(-ROLLING_WINDOW);
    const segments: ReguaSegment[] = lastSprints.map((s) => {
      const monday = mondayOf(new Date(s.startDate));
      const kind: ReguaSegment["kind"] = isClosed(s)
        ? "closed"
        : monday === currentMonday
          ? "current"
          : "future";
      return {
        monday,
        sprintId: s.id,
        kind,
        deliveryPct: kind === "future" ? null : deliveryOf(s),
      };
    });
    const currentIndex = segments.findIndex((g) => g.kind === "current");

    return {
      mode: "rolling",
      weeksTotal: null,
      weeksElapsed: null,
      timePct: null,
      sprintsClosed,
      donePct: null,
      holes: 0,
      fpDone,
      fpTotal,
      scopePct,
      avgFpPerSprint,
      utilizationPct,
      deliveryRatePct,
      deliverySprints,
      paceGapPp: null,
      paceVerdict: null,
      projectedEndWeek: null,
      segments,
      currentIndex: currentIndex >= 0 ? currentIndex : null,
      milestoneIndex: null,
    };
  }

  return {
    mode: "none",
    weeksTotal: null,
    weeksElapsed: null,
    timePct: null,
    sprintsClosed: 0,
    donePct: null,
    holes: 0,
    fpDone,
    fpTotal,
    scopePct,
    avgFpPerSprint: null,
    utilizationPct: null,
    deliveryRatePct: null,
    deliverySprints: 0,
    paceGapPp: null,
    paceVerdict: null,
    projectedEndWeek: null,
    segments: [],
    currentIndex: null,
    milestoneIndex: null,
  };
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * STATS de UM projeto — envelopa o motor `computeStats` (que segue privado)
 * pro registry de métricas (`src/lib/metrics/`). Mesmas fontes do
 * getProjectOverviews, escopadas por projeto. `milestoneDueAt` não é buscado:
 * só afeta `milestoneIndex`, que não é métrica do catálogo.
 *
 * Retorna null se o projeto não existe.
 */
export async function getProjectStats(projectId: string): Promise<ProjectStats | null> {
  const supabase = db();
  const now = new Date();
  const currentMonday = mondayOf(now);

  const { data: project, error: projErr } = await supabase
    .from("Project")
    .select("id, engagementType, startDate, endDate")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr) throw projErr;
  if (!project) return null;

  const [sprintsRes, fpRes] = await Promise.all([
    supabase
      .from("Sprint")
      .select("id, name, startDate, endDate, status, projectId")
      .eq("projectId", projectId)
      .order("startDate"),
    supabase
      .from("Task")
      .select("functionPoints, status")
      .eq("projectId", projectId)
      .neq("status", "draft")
      .is("dismissedAt", null),
  ]);
  if (sprintsRes.error) throw sprintsRes.error;
  if (fpRes.error) throw fpRes.error;

  const sprints = (sprintsRes.data ?? []) as SprintRow[];
  const sprintIds = sprints.map((s) => s.id);
  let capBySprint = new Map<string, CapRow>();
  let deliveryBySprint = new Map<string, DeliveryRow>();
  if (sprintIds.length > 0) {
    const [capsRes, delRes] = await Promise.all([
      supabase
        .from("sprint_capacity_overview")
        .select("sprintId, capacity, planned, done, open")
        .in("sprintId", sprintIds),
      supabase
        .from("sprint_delivery_overview")
        .select("sprintId, planned, done, tasks_sem_fp")
        .in("sprintId", sprintIds),
    ]);
    if (capsRes.error) throw capsRes.error;
    if (delRes.error) throw delRes.error;
    capBySprint = new Map(((capsRes.data ?? []) as CapRow[]).map((c) => [c.sprintId, c]));
    deliveryBySprint = new Map(
      ((delRes.data ?? []) as DeliveryRow[]).map((d) => [d.sprintId, d]),
    );
  }

  let fpDone = 0;
  let fpTotal = 0;
  for (const t of fpRes.data ?? []) {
    const fp = t.functionPoints ?? 0;
    fpTotal += fp;
    if (t.status === "done") fpDone += fp;
  }

  return computeStats({
    engagementType: (project.engagementType ?? "fixed_scope") as ProjectEngagement,
    startDate: project.startDate,
    endDate: project.endDate,
    sprints,
    capBySprint,
    deliveryBySprint,
    fpDone,
    fpTotal,
    milestoneDueAt: null,
    currentMonday,
    now,
  });
}

/** Membros da fábrica pro ribbon (total + builders). */
export async function getFactoryStats(): Promise<FactoryStats> {
  const { data, error } = await db().from("Member").select("position");
  if (error) throw error;
  const rows = data ?? [];
  return {
    membersTotal: rows.length,
    builders: rows.filter((m) => m.position === "product-builder").length,
  };
}

export async function getProjectOverviews(): Promise<ProjectOverview[]> {
  const supabase = db();
  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);
  const currentMonday = mondayOf(now);

  // ─── Projetos (ativos + pausados) ─────────────────────────
  const { data: projectRows, error: projErr } = await supabase
    .from("Project")
    .select(
      "id, name, category, phase, engagementType, startDate, endDate, status, createdAt, phaseChangedAt, client:Client(name), pm:Member!pmId(name), projectMembers:ProjectMember(member:Member(id, name, position))",
    )
    .in("status", ["active", "paused"])
    .order("name");
  if (projErr) throw projErr;

  const projects = projectRows ?? [];
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length === 0) return [];

  // ─── Demais fontes em paralelo ────────────────────────────
  const [
    sprintsRes,
    capsRes,
    deliveryRes,
    fpRes,
    overdueRes,
    blockedRes,
    openTasksRes,
    reviewsRes,
  ] = await Promise.all([
    // TODAS as sprints — a régua e o ritmo precisam das fechadas.
    supabase
      .from("Sprint")
      .select("id, name, startDate, endDate, status, projectId")
      .in("projectId", projectIds)
      .order("startDate"),
    supabase
      .from("sprint_capacity_overview")
      .select("sprintId, capacity, planned, done, open"),
    supabase
      .from("sprint_delivery_overview")
      .select("sprintId, planned, done, tasks_sem_fp"),
    // Escopo FP — backlog vivo (sem draft, sem dismissed).
    supabase
      .from("Task")
      .select("projectId, functionPoints, status")
      .in("projectId", projectIds)
      .neq("status", "draft")
      .is("dismissedAt", null),
    supabase
      .from("Task")
      .select("projectId")
      .in("projectId", projectIds)
      .lt("dueDate", now.toISOString())
      .not("status", "eq", "done")
      .neq("status", "draft")
      .is("dismissedAt", null),
    supabase
      .from("Task")
      .select("projectId")
      .in("projectId", projectIds)
      .eq("status", "in_progress")
      .lt("updatedAt", threeDaysAgo.toISOString())
      .is("dismissedAt", null),
    supabase
      .from("Task")
      .select("projectId, assignments:TaskAssignment(id)")
      .in("projectId", projectIds)
      .in("status", [...OPEN_STATUSES])
      .is("dismissedAt", null),
    supabase
      .from("PMReview")
      .select("id, projectId, referenceWeek, reportMarkdown, status, publishedAt")
      .in("projectId", projectIds)
      .order("referenceWeek", { ascending: false }),
  ]);

  // Sinais por projeto
  const overdueByProject = countByProject((overdueRes.data ?? []) as { projectId: string | null }[]);
  const blockedByProject = countByProject((blockedRes.data ?? []) as { projectId: string | null }[]);
  const unassignedByProject = countByProject(
    ((openTasksRes.data ?? []) as { projectId: string | null; assignments: { id: string }[] }[])
      .filter((t) => (t.assignments?.length ?? 0) === 0),
  );

  // Escopo FP por projeto
  const fpByProject = new Map<string, { done: number; total: number }>();
  for (const t of (fpRes.data ?? []) as {
    projectId: string | null;
    functionPoints: number | null;
    status: string;
  }[]) {
    if (!t.projectId) continue;
    const acc = fpByProject.get(t.projectId) ?? { done: 0, total: 0 };
    const fp = t.functionPoints ?? 0;
    acc.total += fp;
    if (t.status === "done") acc.done += fp;
    fpByProject.set(t.projectId, acc);
  }

  // Capacity por sprint
  const capBySprint = new Map<string, CapRow>(
    ((capsRes.data ?? []) as CapRow[]).map((c) => [c.sprintId, c]),
  );

  // Entrega por sprint (planned/done por task — régua e delivery_rate)
  const deliveryBySprint = new Map<string, DeliveryRow>(
    ((deliveryRes.data ?? []) as DeliveryRow[]).map((d) => [d.sprintId, d]),
  );

  // Sprints por projeto (asc por startDate) + sprint corrente (card da sprint)
  const sprintsByProject = new Map<string, SprintRow[]>();
  const sprintByProject = new Map<string, SprintRow>();
  for (const s of (sprintsRes.data ?? []) as SprintRow[]) {
    if (!s.projectId) continue;
    const list = sprintsByProject.get(s.projectId) ?? [];
    list.push(s);
    sprintsByProject.set(s.projectId, list);
    if (!sprintByProject.has(s.projectId) && (s.status === "active" || s.status === "upcoming")) {
      const start = new Date(s.startDate);
      const end = new Date(s.endDate);
      if (end >= weekStart && start <= weekEnd) sprintByProject.set(s.projectId, s);
    }
  }

  // Janela fixa de semanas pros chips: corrente + (N-1) anteriores, desc.
  const weekWindow: string[] = Array.from({ length: WEEK_CHIP_COUNT }, (_, i) =>
    addWeeksISO(currentMonday, -i),
  );
  const weekSet = new Set(weekWindow);

  // PM Reviews por projeto: as da janela (chips) + a mais recente de todas
  // (default de health/abertura — pode estar fora da janela). rows já vêm
  // em referenceWeek desc.
  const windowReviewByProjectWeek = new Map<string, ReviewRow>(); // `${projectId}:${week}`
  const latestReviewByProject = new Map<string, ReviewRow>();
  for (const r of (reviewsRes.data ?? []) as ReviewRow[]) {
    if (!latestReviewByProject.has(r.projectId)) latestReviewByProject.set(r.projectId, r);
    if (weekSet.has(r.referenceWeek)) {
      const key = `${r.projectId}:${r.referenceWeek}`;
      if (!windowReviewByProjectWeek.has(key)) windowReviewByProjectWeek.set(key, r);
    }
  }

  // Notes das reviews selecionadas — separadas por audience: 'detail' dirige
  // health/sinais; 'executive' (digest curado pela Vitoria) dirige os cards.
  // priority desc = mais importante primeiro (convenção da tabela).
  const selectedReviewIds = [
    ...new Set(
      [...windowReviewByProjectWeek.values(), ...latestReviewByProject.values()].map(
        (r) => r.id,
      ),
    ),
  ];
  const notesByReview = new Map<string, Record<string, PMReviewNoteLite[]>>();
  const execByReview = new Map<string, Record<string, PMReviewNoteLite[]>>();
  if (selectedReviewIds.length > 0) {
    const { data: noteRows } = await supabase
      .from("PMReviewNote")
      .select("pmReviewId, kind, content, priority, audience, dueAt, stance")
      .in("pmReviewId", selectedReviewIds)
      .is("dismissedAt", null)
      .order("priority", { ascending: false });
    for (const n of (noteRows ?? []) as NoteRow[]) {
      const target = n.audience === "executive" ? execByReview : notesByReview;
      const byKind = target.get(n.pmReviewId) ?? {};
      (byKind[n.kind] ??= []).push({
        kind: n.kind,
        content: n.content,
        priority: n.priority ?? 0,
        dueAt: n.dueAt,
        stance: n.stance,
      });
      target.set(n.pmReviewId, byKind);
    }
  }

  // ─── Montagem + health ────────────────────────────────────
  return (projects as unknown as ProjectRow[]).map((p): ProjectOverview => {
    const signals = {
      overdue: overdueByProject.get(p.id) ?? 0,
      blocked: blockedByProject.get(p.id) ?? 0,
      unassigned: unassignedByProject.get(p.id) ?? 0,
    };

    const s = sprintByProject.get(p.id);
    const cap = s ? capBySprint.get(s.id) : null;
    const sprint = s
      ? {
          name: s.name,
          capacity: Number(cap?.capacity) || 0,
          planned: Number(cap?.planned) || 0,
          done: Number(cap?.done) || 0,
          open: Number(cap?.open) || 0,
          pct:
            Number(cap?.planned) > 0
              ? Math.round((Number(cap?.done) / Number(cap?.planned)) * 100)
              : 0,
          loadPct:
            Number(cap?.capacity) > 0 ? Number(cap?.planned) / Number(cap?.capacity) : 0,
        }
      : null;

    const selected =
      windowReviewByProjectWeek.get(`${p.id}:${currentMonday}`) ??
      latestReviewByProject.get(p.id) ??
      null;
    const toEntry = (r: ReviewRow): PMReviewDigestEntry => {
      const detail = notesByReview.get(r.id) ?? {};
      const exec = execByReview.get(r.id) ?? {};
      return {
        id: r.id,
        referenceWeek: r.referenceWeek,
        isCurrentWeek: r.referenceWeek === currentMonday,
        publishedAt: r.publishedAt,
        reportMarkdown: r.reportMarkdown,
        notesByKind: detail,
        digestByKind: Object.keys(exec).length > 0 ? exec : detail,
      };
    };
    const pmReview = selected ? toEntry(selected) : null;
    const weeks = weekWindow.map((week) => {
      const r = windowReviewByProjectWeek.get(`${p.id}:${week}`);
      return {
        week,
        isCurrentWeek: week === currentMonday,
        review: r ? toEntry(r) : null,
      };
    });
    const notesByKind = pmReview?.notesByKind ?? {};

    // Próximo marco: note kind='milestone' da review default (priority desc
    // já ordena; a Vitoria mantém no máx. 1 por review).
    const milestoneNote = (notesByKind.milestone ?? []).find((n) => n.dueAt);
    const milestone = milestoneNote?.dueAt
      ? { label: milestoneNote.content, dueAt: milestoneNote.dueAt }
      : null;

    const fp = fpByProject.get(p.id) ?? { done: 0, total: 0 };
    const stats = computeStats({
      engagementType: (p.engagementType ?? "fixed_scope") as ProjectEngagement,
      startDate: p.startDate,
      endDate: p.endDate,
      sprints: sprintsByProject.get(p.id) ?? [],
      capBySprint,
      deliveryBySprint,
      fpDone: fp.done,
      fpTotal: fp.total,
      milestoneDueAt: milestone?.dueAt ?? null,
      currentMonday,
      now,
    });

    // Risco pesa pelo stance, não pela existência (calibração 0ca428d4):
    //   escalate → red · needs_action (ou nota antiga sem stance) → amber ·
    //   managed → não altera health.
    const riskNotes = notesByKind.risk ?? [];
    const hasEscalatedRisk = riskNotes.some((n) => n.stance === "escalate");
    const hasActionableRisk = riskNotes.some((n) => n.stance !== "managed");
    const hasNeedOrDecision =
      (notesByKind.need?.length ?? 0) > 0 || (notesByKind.open_decision?.length ?? 0) > 0;
    const overcommit = !!sprint && sprint.capacity > 0 && sprint.planned > sprint.capacity;
    const overloaded = !!sprint && sprint.loadPct > 0.85;

    // Fase-aware: risco só puxa red em projeto operacional (fase ops/post_ops
    // com ≥1 sprint fechada). Em discovery/imersão — ou ops recém-começado —
    // red fica reservado a sinais operacionais (overdue, overcommit).
    const phase = (p.phase ?? "ops") as ProjectPhase;
    const operational =
      (phase === "ops" || phase === "post_ops") && stats.sprintsClosed > 0;

    let health: ProjectHealth = "green";
    if (signals.overdue > 0 || overcommit || (hasEscalatedRisk && operational))
      health = "red";
    else if (signals.blocked > 0 || hasNeedOrDecision || overloaded || hasActionableRisk)
      health = "amber";

    return {
      id: p.id,
      name: p.name,
      category: (p.category ?? "billable") as ProjectCategory,
      phase,
      engagementType: (p.engagementType ?? "fixed_scope") as ProjectEngagement,
      startDate: p.startDate ?? null,
      endDate: p.endDate ?? null,
      status: p.status,
      createdAt: p.createdAt,
      phaseChangedAt: p.phaseChangedAt,
      daysInPhase: Math.max(
        0,
        Math.floor((now.getTime() - new Date(p.phaseChangedAt).getTime()) / 86400000),
      ),
      isEval: typeof p.name === "string" && p.name.includes("__eval__"),
      clientName: p.client?.name ?? null,
      pmName: p.pm?.name ?? null,
      team: (p.projectMembers ?? [])
        .map((pm) => pm.member)
        .filter((m): m is { id: string; name: string | null; position: string | null } => !!m)
        .map((m) => ({ id: m.id, name: m.name ?? "—", position: m.position })),
      stats,
      sprint,
      signals,
      milestone,
      pmReview,
      weeks,
      health,
    };
  });
}
