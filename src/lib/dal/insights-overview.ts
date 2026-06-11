/**
 * Insights Overview — Data Access Layer da aba "Insights" do overview.
 *
 * Convenções (espelha src/lib/dal/capacity.ts):
 *   • `db()` (service_role) — bypassa RLS de propósito. A page valida acesso
 *     (requireMinLevel MANAGER) ANTES de renderizar.
 *   • Throw em erro; null pra "sem amostra".
 *
 * Quatro blocos, todos sobre dado que já existe:
 *   1. Time      — composição (builders/PMs/externos) por Member.position.
 *   2. PMs       — projetos ativos por Project.pmId (atribuição real, não cargo),
 *      sem internos/eval (recorte canônico, espelha capacity.ts).
 *   3. Satisfação — médias de CsatResponse na janela recente + delta vs anterior.
 *   4. Clientes  — projetos ativos × health (ClientInsight) × CSAT por cliente.
 */
import "server-only";
import { db } from "@/lib/db";
import { isPmEligible, type Position } from "@/lib/roles";
import { PROJECT_PHASE } from "@/lib/status-chips";

/** Ordem canônica das fases (commercial → immersion → ops → post_ops). */
const PHASE_ORDER = Object.keys(PROJECT_PHASE);
const phaseRank = (phase: string) => {
  const i = PHASE_ORDER.indexOf(phase);
  return i === -1 ? PHASE_ORDER.length : i;
};

/** Positions que contam como "builder" no headcount (D: por position). */
const BUILDER_POSITIONS: Position[] = ["product-builder", "principal-engineer"];

/** Janela de satisfação: amostra recente vs anterior (dias). */
const CSAT_WINDOW_DAYS = 90;

/** Máx. de itens "a melhorar" puxados pro destaque qualitativo. */
const TO_IMPROVE_MAX = 4;

export type TeamComposition = {
  /** Membros não-externos (time interno total). */
  internalTotal: number;
  /** position ∈ {product-builder, principal-engineer}. */
  builders: number;
  /**
   * position === "pm", cravado. head-ops é PM-eligible (pode assumir projeto
   * às vezes — dropdown usa isPmEligible), mas não é PM de cargo: headcount
   * conta cargo, não elegibilidade.
   */
  pms: number;
  /** isExternal || isGuest. */
  externals: number;
  /** Builders agrupados por specialty (catch-all "—" quando null). */
  bySpecialty: Array<{ specialty: string; count: number }>;
};

/** Média + delta vs janela anterior de um score CSAT. */
export type ScoreStat = { avg: number | null; delta: number | null };

export type SatisfactionStats = {
  csat: ScoreStat;
  nps: ScoreStat;
  team: ScoreStat;
  methodology: ScoreStat;
  /** Amostras (entrevistas) na janela recente. */
  sampleCount: number;
  /** Últimos "a melhorar" não-vazios, com cliente. */
  toImprove: Array<{ text: string; clientName: string }>;
};

export type PmDistributionRow = {
  /** Member.id; null agrupa projetos ativos sem PM atribuído. */
  id: string | null;
  name: string;
  activeProjects: number;
  /** Split por Project.phase, ordem canônica, só fases com ≥ 1 projeto. */
  byPhase: Array<{ phase: string; count: number }>;
};

export type ClientHealthRow = {
  id: string;
  name: string;
  logoStoragePath: string | null;
  activeProjects: number;
  /** "healthy" | "watch" | "at_risk" | "critical" | null (último ClientInsight). */
  health: string | null;
  /** csatScore da entrevista mais recente do cliente. */
  csat: number | null;
};

export type InsightsOverview = {
  team: TeamComposition;
  /** Projetos ativos por PM (atribuição via Project.pmId, não cargo). */
  pms: PmDistributionRow[];
  satisfaction: SatisfactionStats;
  clients: ClientHealthRow[];
};

/** Arredonda pra 1 casa; null se vazio. */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

/** avg da janela recente + delta (recente − anterior), null quando faltar amostra. */
function scoreStat(recent: number[], prior: number[]): ScoreStat {
  const avg = mean(recent);
  const priorAvg = mean(prior);
  const delta = avg !== null && priorAvg !== null ? Math.round((avg - priorAvg) * 10) / 10 : null;
  return { avg, delta };
}

export async function getInsightsOverview(): Promise<InsightsOverview> {
  const supabase = db();
  const now = Date.now();
  const recentCutoff = new Date(now - CSAT_WINDOW_DAYS * 86400000).toISOString();
  const priorCutoff = new Date(now - 2 * CSAT_WINDOW_DAYS * 86400000).toISOString();

  const [
    { data: members, error: mErr },
    { data: csat, error: cErr },
    { data: clients, error: clErr },
    { data: projects, error: pErr },
    { data: insights, error: iErr },
  ] = await Promise.all([
    supabase.from("Member").select("id, name, position, specialty, isExternal, isGuest"),
    supabase
      .from("CsatResponse")
      .select(
        "clientId, csatScore, npsScore, teamScore, methodologyScore, whatsToImprove, interviewedAt, client:Client(name)",
      )
      .gte("interviewedAt", priorCutoff)
      .order("interviewedAt", { ascending: false }),
    supabase.from("Client").select("id, name, logoStoragePath"),
    supabase.from("Project").select("clientId, pmId, status, phase, name, category"),
    supabase
      .from("ClientInsight")
      .select("clientId, relationalHealth, technicalHealth, generatedAt")
      .order("generatedAt", { ascending: false }),
  ]);
  if (mErr) throw mErr;
  if (cErr) throw cErr;
  if (clErr) throw clErr;
  if (pErr) throw pErr;
  if (iErr) throw iErr;

  // ── Bloco 1: Time ──────────────────────────────────────
  const ms = members ?? [];
  const isExternal = (m: { isExternal: boolean; isGuest: boolean }) => m.isExternal || m.isGuest;
  const internal = ms.filter((m) => !isExternal(m));
  const specialtyCount = new Map<string, number>();
  for (const m of internal) {
    if (!BUILDER_POSITIONS.includes(m.position as Position)) continue;
    const key = m.specialty ?? "—";
    specialtyCount.set(key, (specialtyCount.get(key) ?? 0) + 1);
  }
  const team: TeamComposition = {
    internalTotal: internal.length,
    builders: internal.filter((m) => BUILDER_POSITIONS.includes(m.position as Position)).length,
    pms: internal.filter((m) => m.position === "pm").length,
    externals: ms.filter(isExternal).length,
    bySpecialty: [...specialtyCount.entries()]
      .map(([specialty, count]) => ({ specialty, count }))
      .sort((a, b) => b.count - a.count),
  };

  // ── Bloco 2: Projetos ativos por PM ────────────────────
  // Agrega por Project.pmId (quem de fato assume o projeto), não por cargo —
  // head-ops PM-eligible entra quando é PM de projeto, mesmo sem cargo "pm".
  // Recorte canônico (espelha capacity.ts): internos/eval ficam fora.
  const isCounted = (p: { name: string; category: string | null }) =>
    (p.category ?? "billable") !== "internal" && !p.name.includes("__eval__");
  const activeByPm = new Map<string | null, Map<string, number>>();
  for (const p of projects ?? []) {
    if (p.status !== "active" || !isCounted(p)) continue;
    const phases = activeByPm.get(p.pmId) ?? new Map<string, number>();
    phases.set(p.phase, (phases.get(p.phase) ?? 0) + 1);
    activeByPm.set(p.pmId, phases);
  }
  const toByPhase = (phases: Map<string, number> | undefined) =>
    [...(phases?.entries() ?? [])]
      .map(([phase, count]) => ({ phase, count }))
      .sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase));
  const sumPhases = (byPhase: Array<{ count: number }>) =>
    byPhase.reduce((s, x) => s + x.count, 0);
  const memberById = new Map(ms.map((m) => [m.id, m]));
  // PM-eligible internos sempre aparecem (mesmo com 0 projetos); pmIds fora
  // da elegibilidade (atribuição pontual) entram porque carregam projeto.
  const pmIds = new Set<string>(internal.filter((m) => isPmEligible(m.position)).map((m) => m.id));
  for (const pmId of activeByPm.keys()) {
    if (pmId !== null) pmIds.add(pmId);
  }
  const pms: PmDistributionRow[] = [...pmIds]
    .map((id) => {
      const byPhase = toByPhase(activeByPm.get(id));
      return {
        id,
        name: memberById.get(id)?.name ?? "—",
        activeProjects: sumPhases(byPhase),
        byPhase,
      };
    })
    .sort((a, b) => b.activeProjects - a.activeProjects || a.name.localeCompare(b.name));
  const unassignedByPhase = toByPhase(activeByPm.get(null));
  if (unassignedByPhase.length > 0) {
    pms.push({
      id: null,
      name: "Sem PM",
      activeProjects: sumPhases(unassignedByPhase),
      byPhase: unassignedByPhase,
    });
  }

  // ── Bloco 3: Satisfação ────────────────────────────────
  const rows = csat ?? [];
  const recent = rows.filter((r) => r.interviewedAt >= recentCutoff);
  const prior = rows.filter((r) => r.interviewedAt < recentCutoff);
  const pick = (list: typeof rows, key: "csatScore" | "npsScore" | "teamScore" | "methodologyScore") =>
    list.map((r) => r[key]).filter((v): v is number => typeof v === "number");
  const satisfaction: SatisfactionStats = {
    csat: scoreStat(pick(recent, "csatScore"), pick(prior, "csatScore")),
    nps: scoreStat(pick(recent, "npsScore"), pick(prior, "npsScore")),
    team: scoreStat(pick(recent, "teamScore"), pick(prior, "teamScore")),
    methodology: scoreStat(pick(recent, "methodologyScore"), pick(prior, "methodologyScore")),
    sampleCount: recent.length,
    toImprove: recent
      .filter((r) => r.whatsToImprove && r.whatsToImprove.trim().length > 0)
      .slice(0, TO_IMPROVE_MAX)
      .map((r) => ({
        text: r.whatsToImprove as string,
        clientName: (r.client as unknown as { name: string } | null)?.name ?? "—",
      })),
  };

  // ── Bloco 4: Clientes × projetos ───────────────────────
  // Projetos ativos por cliente.
  const activeByClient = new Map<string, number>();
  for (const p of projects ?? []) {
    if (p.status !== "active" || !p.clientId) continue;
    activeByClient.set(p.clientId, (activeByClient.get(p.clientId) ?? 0) + 1);
  }
  // Health = relationalHealth do ClientInsight mais recente (insights já vem
  // ordenado desc por generatedAt → primeiro encontrado é o último gerado).
  const healthByClient = new Map<string, string | null>();
  for (const ins of insights ?? []) {
    if (healthByClient.has(ins.clientId)) continue;
    healthByClient.set(ins.clientId, ins.relationalHealth ?? ins.technicalHealth ?? null);
  }
  // CSAT mais recente por cliente (rows já vem desc por interviewedAt).
  const csatByClient = new Map<string, number>();
  for (const r of rows) {
    if (csatByClient.has(r.clientId)) continue;
    csatByClient.set(r.clientId, r.csatScore);
  }
  const clientRows: ClientHealthRow[] = (clients ?? [])
    .map((c) => ({
      id: c.id,
      name: c.name,
      logoStoragePath: c.logoStoragePath,
      activeProjects: activeByClient.get(c.id) ?? 0,
      health: healthByClient.get(c.id) ?? null,
      csat: csatByClient.get(c.id) ?? null,
    }))
    // Ordena: mais projetos ativos primeiro, depois nome.
    .sort((a, b) => b.activeProjects - a.activeProjects || a.name.localeCompare(b.name));

  return { team, pms, satisfaction, clients: clientRows };
}
