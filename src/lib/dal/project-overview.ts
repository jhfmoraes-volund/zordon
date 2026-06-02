/**
 * Project Overview — DAL para a aba "Projetos" do Overview.
 *
 * Cruza, por projeto:
 *   • capacidade da sprint corrente (sprint_capacity_overview)
 *   • sinais operacionais (vencidas / paradas +3d / sem dono)
 *   • insights vivos do PM Review da semana (notes tipadas + reportMarkdown)
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

export type PMReviewNoteLite = { kind: string; content: string; priority: number };

export type ProjectOverview = {
  id: string;
  name: string;
  category: ProjectCategory;
  phase: ProjectPhase;
  engagementType: ProjectEngagement;
  /** Estimativa de fim — só para `fixed_scope`; `null` em contínuos. */
  endDate: string | null;
  status: string;
  /** Convenção de nome — escondido por default na UI. */
  isEval: boolean;
  clientName: string | null;
  pmName: string | null;
  team: ProjectTeamMember[];
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
  pmReview: {
    id: string;
    referenceWeek: string;
    isCurrentWeek: boolean;
    reportMarkdown: string | null;
    notesByKind: Record<string, PMReviewNoteLite[]>;
  } | null;
  health: ProjectHealth;
};

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

type CapRow = {
  sprintId: string;
  capacity: number | null;
  planned: number | null;
  done: number | null;
  open: number | null;
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
type NoteRow = { pmReviewId: string; kind: string; content: string; priority: number | null };
type ProjectRow = {
  id: string;
  name: string;
  category: string | null;
  phase: string | null;
  engagementType: string | null;
  endDate: string | null;
  status: string;
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
      "id, name, category, phase, engagementType, endDate, status, client:Client(name), pm:Member!pmId(name), projectMembers:ProjectMember(member:Member(id, name, position))",
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
    overdueRes,
    blockedRes,
    openTasksRes,
    reviewsRes,
  ] = await Promise.all([
    supabase
      .from("Sprint")
      .select("id, name, startDate, endDate, status, projectId")
      .in("projectId", projectIds)
      .in("status", ["active", "upcoming"])
      .order("startDate"),
    supabase
      .from("sprint_capacity_overview")
      .select("sprintId, capacity, planned, done, open"),
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

  // Capacity por sprint
  const capBySprint = new Map<string, CapRow>(
    ((capsRes.data ?? []) as CapRow[]).map((c) => [c.sprintId, c]),
  );

  // Sprint corrente por projeto = sprint active/upcoming que sobrepõe a semana atual.
  const sprintByProject = new Map<string, SprintRow>();
  for (const s of (sprintsRes.data ?? []) as SprintRow[]) {
    if (!s.projectId || sprintByProject.has(s.projectId)) continue;
    const start = new Date(s.startDate);
    const end = new Date(s.endDate);
    if (end >= weekStart && start <= weekEnd) sprintByProject.set(s.projectId, s);
  }

  // PM Review por projeto: prefere a semana corrente; senão a mais recente.
  const reviewByProject = new Map<string, ReviewRow>();
  for (const r of (reviewsRes.data ?? []) as ReviewRow[]) {
    const existing = reviewByProject.get(r.projectId);
    if (!existing) {
      reviewByProject.set(r.projectId, r);
    } else if (r.referenceWeek === currentMonday && existing.referenceWeek !== currentMonday) {
      reviewByProject.set(r.projectId, r);
    }
  }

  // Notes das reviews selecionadas
  const selectedReviewIds = [...reviewByProject.values()].map((r) => r.id);
  const notesByReview = new Map<string, Record<string, PMReviewNoteLite[]>>();
  if (selectedReviewIds.length > 0) {
    const { data: noteRows } = await supabase
      .from("PMReviewNote")
      .select("pmReviewId, kind, content, priority")
      .in("pmReviewId", selectedReviewIds)
      .is("dismissedAt", null)
      .order("priority", { ascending: true });
    for (const n of (noteRows ?? []) as NoteRow[]) {
      const byKind = notesByReview.get(n.pmReviewId) ?? {};
      (byKind[n.kind] ??= []).push({ kind: n.kind, content: n.content, priority: n.priority ?? 0 });
      notesByReview.set(n.pmReviewId, byKind);
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
          name: s.name as string,
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

    const review = reviewByProject.get(p.id);
    const notesByKind = review ? notesByReview.get(review.id) ?? {} : {};
    const pmReview = review
      ? {
          id: review.id as string,
          referenceWeek: review.referenceWeek as string,
          isCurrentWeek: review.referenceWeek === currentMonday,
          reportMarkdown: review.reportMarkdown as string | null,
          notesByKind,
        }
      : null;

    const hasRisk = (notesByKind.risk?.length ?? 0) > 0;
    const hasNeedOrDecision =
      (notesByKind.need?.length ?? 0) > 0 || (notesByKind.open_decision?.length ?? 0) > 0;
    const overcommit = !!sprint && sprint.capacity > 0 && sprint.planned > sprint.capacity;
    const overloaded = !!sprint && sprint.loadPct > 0.85;

    let health: ProjectHealth = "green";
    if (signals.overdue > 0 || hasRisk || overcommit) health = "red";
    else if (signals.blocked > 0 || hasNeedOrDecision || overloaded) health = "amber";

    return {
      id: p.id,
      name: p.name,
      category: (p.category ?? "billable") as ProjectCategory,
      phase: (p.phase ?? "ops") as ProjectPhase,
      engagementType: (p.engagementType ?? "fixed_scope") as ProjectEngagement,
      endDate: p.endDate ?? null,
      status: p.status,
      isEval: typeof p.name === "string" && p.name.includes("__eval__"),
      clientName: p.client?.name ?? null,
      pmName: p.pm?.name ?? null,
      team: (p.projectMembers ?? [])
        .map((pm) => pm.member)
        .filter((m): m is { id: string; name: string | null; position: string | null } => !!m)
        .map((m) => ({ id: m.id, name: m.name ?? "—", position: m.position })),
      sprint,
      signals,
      pmReview,
      health,
    };
  });
}
