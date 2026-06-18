import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Audience, RitualCapability, RitualType } from "@/lib/rituals/types";

/**
 * Ritual Playbook DAL — runtime compartilhado pelo cron e pelo "Sintetizar"
 * manual (nenhum dos dois reimplementa). Três funções puras de leitura:
 *   • getEffectivePlaybook  — playbook autorado OU default sintetizado (zero-breaking)
 *   • resolveLoadContextSources — instâncias load_context → ids de ContextSource
 *   • derivePromptParams    — redact + emphasis → { audienceFloor, emphasisSections }
 *
 * O comportamento (frases de preset, etc.) vem do registry/types — aqui só
 * orquestra. Não escreve nada; quem linka (EntityLink) é o caller, com as DAL
 * link* existentes.
 */

type Client = SupabaseClient<Database>;

/**
 * Playbook efetivo de (projeto, ritual). **Default OFF, opt-in explícito:** a
 * automação só produz caps com um RitualPlaybook `enabled=true`. Sem row (ou row
 * desligado) → playbook efetivo VAZIO → cron e refresh no-op. O PM opta pela
 * automação ligando no card (cria o row enabled=true) — nenhum projeto entra no
 * cron sem o PM ligar. Quando ligado, sintetiza as caps a partir dos bindings de
 * folder do Granola (granola_folder) + o autorado (ênfase/redact/drive/notion).
 */
export async function getEffectivePlaybook(
  admin: Client,
  projectId: string,
  ritualType: RitualType,
): Promise<RitualCapability[]> {
  const { data } = await admin
    .from("RitualPlaybook")
    .select("capabilities, enabled")
    .eq("projectId", projectId)
    .eq("ritualType", ritualType)
    .maybeSingle();

  // Default OFF: sem row, ou row desligado → vazio. Ligar no card cria o row
  // enabled=true e é o gesto que opta pela automação.
  if (!data || data.enabled !== true) return [];

  // granola_folder é SEMPRE derivado dos bindings (o folder card é o SSOT dele):
  // nunca persiste no playbook row → não duplica, não fica stale, e autorar
  // ênfase/redact não derruba o roteamento do Granola.
  const granola: RitualCapability[] = [];
  if (ritualType === "pm_review") {
    const { data: bindings } = await admin
      .from("ProjectGranolaFolder")
      .select('"folderId"')
      .eq("projectId", projectId);
    for (const b of bindings ?? []) {
      granola.push({
        capabilityKey: "load_context",
        enabled: true,
        params: { kind: "granola_folder", ref: { folderId: b.folderId as string } },
      });
    }
  }

  // Autorado: ênfase/redact/load_context(drive|notion|…). Descarta qualquer
  // granola_folder que tenha vazado pro row — ele vem dos bindings, não daqui.
  const authored = Array.isArray(data.capabilities)
    ? (data.capabilities as RitualCapability[])
    : [];
  const authoredRest = authored.filter(
    (c) => !(c.capabilityKey === "load_context" && c.params.kind === "granola_folder"),
  );

  return [...granola, ...authoredRest];
}

/** Fonte resolvida a linkar no PM Review (campos que o cron usa). */
export type ResolvedSource = {
  id: string;
  meetingId: string | null;
  createdAt: string;
};

/**
 * Resolve as instâncias load_context habilitadas → ContextSources a linkar no
 * PM Review. granola_folder resolve a janela da semana (mesma query do cron de
 * hoje); drive/notion/spreadsheet resolvem por contextSourceId (fontes já no pool).
 * Escopado a projectId em ambos os ramos — nunca linka fonte de outro projeto.
 * Dedup por id (uma fonte linkada uma vez).
 *
 * NOTA (Fase 2): o `weight` do load_context (primary/supporting/background) não
 * é propagado pro EntityLink ainda — hoje toda fonte linka como 'primary'
 * (default da link DAL). Carregar weight fica pra quando a UI autorar fontes
 * drive/notion (no PoC só granola, sempre primary).
 */
export async function resolveLoadContextSources(
  admin: Client,
  projectId: string,
  caps: RitualCapability[],
  window: { startTs: string; endTs: string },
): Promise<ResolvedSource[]> {
  const byId = new Map<string, ResolvedSource>();
  let needsGranolaWeek = false;
  const directIds: string[] = [];

  for (const c of caps) {
    if (!c.enabled || c.capabilityKey !== "load_context") continue;
    if (c.params.kind === "granola_folder") needsGranolaWeek = true;
    else if (c.params.ref.contextSourceId) directIds.push(c.params.ref.contextSourceId);
  }

  const cols = 'id, "meetingId", "createdAt"';

  if (needsGranolaWeek) {
    const { data } = await admin
      .from("ContextSource")
      .select(cols)
      .eq("source", "granola")
      .eq("projectId", projectId)
      .gte("capturedAt", window.startTs)
      .lt("capturedAt", window.endTs);
    for (const r of data ?? []) {
      byId.set(r.id as string, {
        id: r.id as string,
        meetingId: (r.meetingId as string | null) ?? null,
        createdAt: r.createdAt as string,
      });
    }
  }

  if (directIds.length > 0) {
    const { data } = await admin
      .from("ContextSource")
      .select(cols)
      .eq("projectId", projectId)
      .in("id", directIds);
    for (const r of data ?? []) {
      byId.set(r.id as string, {
        id: r.id as string,
        meetingId: (r.meetingId as string | null) ?? null,
        createdAt: r.createdAt as string,
      });
    }
  }

  return [...byId.values()];
}

/**
 * Deriva os params de prompt (vão no ChatTurn.turnParams) das capabilities
 * redact + emphasis. audienceFloor só ESTREITA (executive vence). Os presets de
 * ênfase viram frase fixa do registry; custom usa só o texto clampado.
 */
export function derivePromptParams(caps: RitualCapability[]): {
  audienceFloor: Audience;
  emphasisSections: string[];
} {
  let audienceFloor: Audience = "detail";
  const emphasisSections: string[] = [];

  for (const c of caps) {
    if (!c.enabled) continue;
    if (c.capabilityKey === "redact") {
      if (c.params.audience === "executive") audienceFloor = "executive";
    } else if (c.capabilityKey === "emphasis") {
      // Colapsa whitespace/control chars do texto do PM (untrusted): impede que
      // a nota abra um novo header/linha markdown e escape o bullet no prompt.
      const text = c.params.text.replace(/\s+/g, " ").trim();
      if (text) emphasisSections.push(text);
    }
  }

  return { audienceFloor, emphasisSections };
}
