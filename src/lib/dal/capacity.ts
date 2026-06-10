/**
 * Capacity — Data Access Layer pras métricas de capacidade & alocação
 * (`src/lib/metrics/capacity-metrics.ts`).
 *
 * Convenções (espelha src/lib/dal/project-overview.ts):
 *   • `db()` (service_role) — bypassa RLS de propósito. Caller valida acesso
 *     ANTES (UI) ou roda como sistema (cron/Alpha).
 *   • Throw em erro; null/empty pra "não existe".
 *
 * Fontes: views `sprint_member_capacity` (FP por member×sprint, com override)
 * e `member_commitment_overview` (compromisso cross-projeto corrente).
 * `getProjectCapacityForOpsTool` (alpha-planner) continua dona da leitura de
 * planejamento — as fórmulas aqui são de utilização histórica, que não
 * existiam lá.
 */
import "server-only";
import { db } from "@/lib/db";

/** Sprints fechadas na amostra de utilização — espelha RHYTHM_WINDOW do projeto. */
export const UTILIZATION_WINDOW = 6;

export type UtilizationWindow = {
  /** Σ FP done na janela. */
  done: number;
  /** Σ FP de capacidade alocada (fp_allocation) na janela. */
  capacity: number;
  /** Nº de amostras (member×sprint) que entraram na janela. */
  samples: number;
};

type MemberSprintRow = {
  memberId: string | null;
  sprintId: string | null;
  fp_allocation: number | null;
  fp_done: number | null;
};

/**
 * Linhas de produção ativas: Project status='active', fase produtiva
 * (immersion/ops), excluindo internos e projetos __eval__.
 */
export type ActiveLine = {
  id: string;
  name: string;
  clientId: string | null;
};

/**
 * Janela de utilização por member: últimas N sprints FECHADAS (completed ou
 * endDate passada) em que o member tinha alocação > 0 — sprint sem alocação
 * não é amostra de capacidade. Retorna Σ done / Σ capacity por member.
 */
export async function getMemberUtilizationWindows(
  memberIds: string[],
  window: number = UTILIZATION_WINDOW,
): Promise<Map<string, UtilizationWindow>> {
  const result = new Map<string, UtilizationWindow>();
  if (memberIds.length === 0) return result;
  const supabase = db();
  const now = new Date();

  const { data: rows, error } = await supabase
    .from("sprint_member_capacity")
    .select("memberId, sprintId, fp_allocation, fp_done")
    .in("memberId", memberIds);
  if (error) throw error;

  const samples = ((rows ?? []) as MemberSprintRow[]).filter(
    (r): r is MemberSprintRow & { memberId: string; sprintId: string } =>
      !!r.memberId && !!r.sprintId && Number(r.fp_allocation) > 0,
  );
  if (samples.length === 0) return result;

  const sprintIds = [...new Set(samples.map((r) => r.sprintId))];
  const { data: sprints, error: sprintErr } = await supabase
    .from("Sprint")
    .select("id, status, startDate, endDate")
    .in("id", sprintIds);
  if (sprintErr) throw sprintErr;

  const closedStart = new Map<string, string>();
  for (const s of sprints ?? []) {
    if (s.status === "completed" || new Date(s.endDate) < now) {
      closedStart.set(s.id, s.startDate);
    }
  }

  const byMember = new Map<string, (MemberSprintRow & { startDate: string })[]>();
  for (const r of samples) {
    const startDate = closedStart.get(r.sprintId);
    if (!startDate) continue; // sprint aberta — fora da janela
    const list = byMember.get(r.memberId) ?? [];
    list.push({ ...r, startDate });
    byMember.set(r.memberId, list);
  }

  for (const [memberId, list] of byMember) {
    const recent = list
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
      .slice(0, window);
    result.set(memberId, {
      done: recent.reduce((sum, r) => sum + (Number(r.fp_done) || 0), 0),
      capacity: recent.reduce((sum, r) => sum + (Number(r.fp_allocation) || 0), 0),
      samples: recent.length,
    });
  }
  return result;
}

/** Member ids de um squad. */
export async function getSquadMemberIds(squadId: string): Promise<string[]> {
  const { data, error } = await db()
    .from("SquadMember")
    .select("memberId")
    .eq("squadId", squadId);
  if (error) throw error;
  return (data ?? []).map((r) => r.memberId);
}

/**
 * Compromisso corrente do member (cross-projeto): Σ fpAllocation vs
 * fpCapacity. Fonte: view `member_commitment_overview` (a mesma da tool de
 * planejamento do Alpha). Null se o member não existe (ou é guest).
 */
export async function getMemberCommitment(memberId: string): Promise<{
  capacity: number;
  committed: number;
  remaining: number;
  projectCount: number;
} | null> {
  const { data, error } = await db()
    .from("member_commitment_overview")
    .select("id, capacity, committed, remaining, project_count")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    capacity: Number(data.capacity) || 0,
    committed: Number(data.committed) || 0,
    remaining: Number(data.remaining) || 0,
    projectCount: Number(data.project_count) || 0,
  };
}

/** Linhas ativas da fábrica (ver type ActiveLine). */
export async function getActiveLines(): Promise<ActiveLine[]> {
  const { data, error } = await db()
    .from("Project")
    .select("id, name, category, clientId")
    .eq("status", "active")
    .in("phase", ["immersion", "ops"]);
  if (error) throw error;
  return (data ?? [])
    .filter((p) => (p.category ?? "billable") !== "internal" && !p.name.includes("__eval__"))
    .map((p) => ({ id: p.id, name: p.name, clientId: p.clientId ?? null }));
}

/**
 * Builders alocados: Members position='product-builder' com fpAllocation > 0
 * em projeto ativo, sobre o total de product-builders.
 */
export async function getBuilderAllocation(): Promise<{ allocated: number; total: number }> {
  const supabase = db();
  const [{ data: builders, error: bErr }, { data: allocations, error: aErr }] =
    await Promise.all([
      supabase.from("Member").select("id").eq("position", "product-builder"),
      supabase
        .from("ProjectMember")
        .select("memberId, fpAllocation, member:Member(position), project:Project(status)")
        .gt("fpAllocation", 0),
    ]);
  if (bErr) throw bErr;
  if (aErr) throw aErr;

  const builderIds = new Set((builders ?? []).map((b) => b.id));
  const allocated = new Set(
    (allocations ?? [])
      .filter(
        (a) =>
          builderIds.has(a.memberId) &&
          (a.project as unknown as { status: string } | null)?.status === "active",
      )
      .map((a) => a.memberId),
  );
  return { allocated: allocated.size, total: builderIds.size };
}
