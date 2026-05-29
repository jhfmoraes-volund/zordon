/**
 * Planning Ceremony — Data Access Layer.
 *
 * Convenções (espelha src/lib/dal/story-hierarchy.ts):
 *   • `db()` (service_role) — DAL bypassa RLS de propósito. A API que chama
 *     valida acesso ANTES (via `canViewProject` etc).
 *   • Funções recebem ids prontos; nenhuma lê o caller (sessão/JWT).
 *   • Throw em erro; null/empty pra "não existe".
 *
 * Estado da phase é atualizado SÓ via `updatePlanningPhase`, que assume
 * que a state machine de `src/lib/planning/phase.ts` JÁ APROVOU a transição
 * e calculou os stamps. Esta camada não decide regras; só persiste.
 */
import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";
import {
  transition,
  type PlanningPhase,
  type PhaseContext,
  type PhaseStamps,
} from "@/lib/planning/phase";
import { applyPendingActionsForPlanning } from "@/lib/meetings/task-action-executor";

type Tables = Database["public"]["Tables"];

// ─── Row types (re-exportados pra API/UI usarem) ──────────────────────────

export type PlanningCeremonyRow = Tables["PlanningCeremony"]["Row"];
export type PlanningMeetingLinkRow = Tables["PlanningMeetingLink"]["Row"];
export type PlanningTranscriptLinkRow = Tables["PlanningTranscriptLink"]["Row"];
export type PlanningContextNoteRow = Tables["PlanningContextNote"]["Row"];
export type TranscriptRefRow = Tables["TranscriptRef"]["Row"];

/** Weight de um transcript linkado — guia o Alpha sobre relevância. */
export type TranscriptWeight = "primary" | "supporting" | "background";

/** Kinds aceitos em PlanningContextNote (espelha CHECK constraint). */
export type ContextNoteKind =
  | "summary"
  | "theme"
  | "risk"
  | "capacity_signal"
  | "code_observation"
  | "open_question";

/** Shape de retorno da lista — leve, pra o tab Cerimônias. */
export type PlanningSummary = {
  id: string;
  projectId: string;
  sprintId: string | null;
  sprintName: string | null;
  phase: PlanningPhase;
  scheduledFor: string | null;
  startedAt: string | null;
  closedAt: string | null;
  facilitatorId: string | null;
  facilitatorName: string | null;
  linkedMeetingCount: number;
  linkedTranscriptCount: number;
  contextNoteCount: number;
  pendingActionCount: number;
};

/** Shape de retorno do detalhe — usa no command center. */
export type PlanningDetail = PlanningSummary & {
  briefingGeneratedAt: string | null;
  archivedAt: string | null;
  linkedMeetings: Array<{
    meetingId: string;
    linkedAt: string;
    linkedById: string | null;
    note: string | null;
    meeting: {
      id: string;
      title: string | null;
      date: string;
      visibility: string;
      kind: string;
    } | null;
  }>;
  linkedTranscripts: Array<{
    transcriptRefId: string;
    linkedAt: string;
    linkedById: string | null;
    weight: TranscriptWeight;
    note: string | null;
    transcript: {
      id: string;
      source: string;
      sourceId: string | null;
      title: string | null;
      capturedAt: string | null;
      meetingId: string | null;
    } | null;
  }>;
  notes: Array<PlanningContextNoteRow>;
};

// ─── Reads ────────────────────────────────────────────────────────────────

/**
 * Lista plannings de um projeto, com contagens agregadas pra o tab Cerimônias.
 * Usa o índice (projectId, phase). Ordenado: ativas (não archived) primeiro,
 * depois scheduledFor desc.
 */
export async function listPlanningsForProject(
  projectId: string,
): Promise<PlanningSummary[]> {
  const supabase = db();
  // 1. Plannings do projeto (com sprint + facilitator pra label rápido).
  const { data: rows, error } = await supabase
    .from("PlanningCeremony")
    .select(
      `
      id, projectId, sprintId, phase, scheduledFor, startedAt, closedAt, facilitatorId,
      sprint:Sprint(name),
      facilitator:Member!PlanningCeremony_facilitatorId_fkey(name)
      `,
    )
    .eq("projectId", projectId)
    .order("scheduledFor", { ascending: false, nullsFirst: false });
  if (error) throw error;
  const list = rows ?? [];
  if (list.length === 0) return [];

  // 2. Contagens em batch (3 queries com `in` — mais simples e legível que
  //    uma view materializada agora; promove pra view se virar gargalo).
  const ids = list.map((r) => r.id);
  const [meetingsRes, transcriptsRes, notesRes, actionsRes] = await Promise.all([
    supabase
      .from("PlanningMeetingLink")
      .select("planningCeremonyId")
      .in("planningCeremonyId", ids),
    supabase
      .from("PlanningTranscriptLink")
      .select("planningCeremonyId")
      .in("planningCeremonyId", ids),
    supabase
      .from("PlanningContextNote")
      .select("planningCeremonyId, dismissedAt")
      .in("planningCeremonyId", ids),
    supabase
      .from("MeetingTaskAction")
      .select("planningCeremonyId, decision")
      .in("planningCeremonyId", ids),
  ]);
  if (meetingsRes.error) throw meetingsRes.error;
  if (transcriptsRes.error) throw transcriptsRes.error;
  if (notesRes.error) throw notesRes.error;
  if (actionsRes.error) throw actionsRes.error;

  const countBy = <T extends { planningCeremonyId: string | null }>(
    arr: T[],
    pred: (r: T) => boolean = () => true,
  ): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of arr) {
      if (!r.planningCeremonyId || !pred(r)) continue;
      m.set(r.planningCeremonyId, (m.get(r.planningCeremonyId) ?? 0) + 1);
    }
    return m;
  };

  const meetingCounts = countBy(meetingsRes.data ?? []);
  const transcriptCounts = countBy(transcriptsRes.data ?? []);
  const noteCounts = countBy(
    notesRes.data ?? [],
    (r) => r.dismissedAt === null,
  );
  const pendingCounts = countBy(
    actionsRes.data ?? [],
    (r) => r.decision === "pending",
  );

  return list.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    sprintId: r.sprintId,
    sprintName: (r.sprint as { name: string } | null)?.name ?? null,
    phase: r.phase as PlanningPhase,
    scheduledFor: r.scheduledFor,
    startedAt: r.startedAt,
    closedAt: r.closedAt,
    facilitatorId: r.facilitatorId,
    facilitatorName:
      (r.facilitator as { name: string } | null)?.name ?? null,
    linkedMeetingCount: meetingCounts.get(r.id) ?? 0,
    linkedTranscriptCount: transcriptCounts.get(r.id) ?? 0,
    contextNoteCount: noteCounts.get(r.id) ?? 0,
    pendingActionCount: pendingCounts.get(r.id) ?? 0,
  }));
}

/**
 * Detalhe completo de uma planning — usa no command center.
 * Inclui meetings/transcripts/notes linkados + contagens.
 *
 * Retorna `null` se não existir. NÃO valida acesso — caller faz isso.
 */
export async function getPlanningById(
  id: string,
): Promise<PlanningDetail | null> {
  const supabase = db();

  const { data: row, error } = await supabase
    .from("PlanningCeremony")
    .select(
      `
      *,
      sprint:Sprint(name),
      facilitator:Member!PlanningCeremony_facilitatorId_fkey(name),
      linkedMeetings:PlanningMeetingLink(
        meetingId, linkedAt, linkedById, note,
        meeting:Meeting(id, title, date, visibility, kind)
      ),
      linkedTranscripts:PlanningTranscriptLink(
        transcriptRefId, linkedAt, linkedById, weight, note,
        transcript:TranscriptRef(id, source, sourceId, title, capturedAt, meetingId)
      ),
      notes:PlanningContextNote(*)
      `,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  // Pending actions count (sem trazer payloads na lista — API fetch separado se precisar)
  const { count: pendingActionCount, error: actionErr } = await supabase
    .from("MeetingTaskAction")
    .select("id", { count: "exact", head: true })
    .eq("planningCeremonyId", id)
    .eq("decision", "pending");
  if (actionErr) throw actionErr;

  // Cast helpers — Supabase JS infere joins como possivelmente arrays/objects.
  type Row = typeof row;
  const r = row as Row & {
    sprint: { name: string } | null;
    facilitator: { name: string } | null;
    linkedMeetings: PlanningDetail["linkedMeetings"];
    linkedTranscripts: PlanningDetail["linkedTranscripts"];
    notes: PlanningContextNoteRow[];
  };

  const notesActive = r.notes.filter((n) => n.dismissedAt === null);

  return {
    id: r.id,
    projectId: r.projectId,
    sprintId: r.sprintId,
    sprintName: r.sprint?.name ?? null,
    phase: r.phase as PlanningPhase,
    scheduledFor: r.scheduledFor,
    startedAt: r.startedAt,
    briefingGeneratedAt: r.briefingGeneratedAt,
    closedAt: r.closedAt,
    archivedAt: r.archivedAt,
    facilitatorId: r.facilitatorId,
    facilitatorName: r.facilitator?.name ?? null,
    linkedMeetingCount: r.linkedMeetings.length,
    linkedTranscriptCount: r.linkedTranscripts.length,
    contextNoteCount: notesActive.length,
    pendingActionCount: pendingActionCount ?? 0,
    linkedMeetings: r.linkedMeetings,
    linkedTranscripts: r.linkedTranscripts,
    notes: r.notes,
  };
}

/**
 * Carrega o `PhaseContext` (counts) que a state machine `transition()` exige.
 * Chamado pela API antes de validar uma mudança de phase.
 *
 * 1 round-trip pra Postgres com 4 head-counts em paralelo.
 */
export async function getPlanningPhaseContext(
  id: string,
): Promise<PhaseContext> {
  const supabase = db();

  const [meetings, transcripts, notes, summaryNotes, pending] = await Promise.all([
    supabase
      .from("PlanningMeetingLink")
      .select("id", { count: "exact", head: true })
      .eq("planningCeremonyId", id),
    supabase
      .from("PlanningTranscriptLink")
      .select("id", { count: "exact", head: true })
      .eq("planningCeremonyId", id),
    supabase
      .from("PlanningContextNote")
      .select("id", { count: "exact", head: true })
      .eq("planningCeremonyId", id)
      .is("dismissedAt", null),
    supabase
      .from("PlanningContextNote")
      .select("id", { count: "exact", head: true })
      .eq("planningCeremonyId", id)
      .eq("kind", "summary")
      .is("dismissedAt", null),
    supabase
      .from("MeetingTaskAction")
      .select("id", { count: "exact", head: true })
      .eq("planningCeremonyId", id)
      .eq("decision", "pending"),
  ]);

  // Throw no primeiro erro real (Supabase retorna count + error juntos).
  for (const r of [meetings, transcripts, notes, summaryNotes, pending]) {
    if (r.error) throw r.error;
  }

  return {
    linkedMeetingCount: meetings.count ?? 0,
    linkedTranscriptCount: transcripts.count ?? 0,
    contextNoteCount: notes.count ?? 0,
    summaryNoteCount: summaryNotes.count ?? 0,
    pendingActionCount: pending.count ?? 0,
  };
}

// ─── Mutations: PlanningCeremony core ─────────────────────────────────────

/**
 * Cria uma planning nova em `phase='idle'`. Staging-commit: múltiplas
 * plannings por sprint são esperadas (cada uma é um commit do "branch"
 * sprint). UNIQUE(projectId, sprintId) foi removido na migration
 * 20260528f_planning_staging_model.sql.
 */
export async function createPlanning(input: {
  projectId: string;
  sprintId?: string | null;
  facilitatorId?: string | null;
  scheduledFor?: string | null;
}): Promise<PlanningCeremonyRow> {
  const supabase = db();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("PlanningCeremony")
    .insert({
      projectId: input.projectId,
      sprintId: input.sprintId ?? null,
      facilitatorId: input.facilitatorId ?? null,
      scheduledFor: input.scheduledFor ?? null,
      phase: "idle",
      updatedAt: now,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Atualiza campos editáveis: sprint, facilitador, data agendada.
 * Phase NÃO é alterada aqui — usa updatePlanningPhase.
 */
export async function updatePlanning(
  id: string,
  patch: {
    sprintId?: string | null;
    facilitatorId?: string | null;
    scheduledFor?: string | null;
  },
): Promise<PlanningCeremonyRow> {
  const { data, error } = await db()
    .from("PlanningCeremony")
    .update({ ...patch, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Arquiva uma planning (soft-delete via phase='archived').
 * Mantém dados para auditoria; só esconde da lista ativa.
 */
export async function archivePlanning(id: string): Promise<void> {
  const { error } = await db()
    .from("PlanningCeremony")
    .update({ phase: "archived", updatedAt: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Hard-delete planning + dependências (FKs em CASCADE: PlanningContextNote,
 * PlanningMeetingLink, PlanningTranscriptLink. MeetingTaskAction.planningCeremonyId
 * vira NULL — actions preservam audit trail).
 *
 * ChatThread (channel="planning", agentName=planningId) não tem FK; fica órfã
 * mas não causa erro — apagar mensagens antigas tornaria histórico inconsistente.
 */
export async function deletePlanning(id: string): Promise<void> {
  const { error } = await db().from("PlanningCeremony").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Aplica uma transição de phase já APROVADA pela state machine.
 * O caller passa `to` + `stamps` (vindos de `transition()`).
 *
 * Banco tem trigger guardrail que rejeita transições inválidas — segunda
 * camada de defesa caso a API chame sem passar pela state machine.
 */
export async function updatePlanningPhase(
  id: string,
  to: PlanningPhase,
  stamps: PhaseStamps,
): Promise<PlanningCeremonyRow> {
  const supabase = db();
  const { data, error } = await supabase
    .from("PlanningCeremony")
    .update({
      phase: to,
      ...stamps,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Conclui uma planning (staging-commit). Append-only, irreversível.
 *
 * Sequência:
 *   1. Auto-aprova e aplica todas as MeetingTaskAction(decision=pending) via
 *      `applyPendingActionsForPlanning` (executor compartilhado).
 *   2. Roda a state machine `transition(current → closed, actor=pm)` pra
 *      validar e obter stamps.
 *   3. UPDATE phase='closed' + closedAt (trigger SQL revalida como fail-safe).
 *
 * Não há transação real (Supabase JS não expõe). Se passo 1 falha parcial,
 * actions ficam com `execution='failed'` e a phase NÃO é avançada — caller
 * pode reabrir (na verdade, no novo modelo, abrir outra planning).
 */
export async function concludePlanning(
  id: string,
  decidedById: string,
): Promise<{
  planning: PlanningCeremonyRow;
  applied: { applied: number; failed: number; skipped: number };
}> {
  const supabase = db();

  // 1. Carrega phase atual + valida transição.
  const { data: row, error: readErr } = await supabase
    .from("PlanningCeremony")
    .select("phase")
    .eq("id", id)
    .single();
  if (readErr) throw readErr;
  const current = row.phase as PlanningPhase;

  // 2. Aplica pending actions (auto-approve + execute em ordem).
  const applied = await applyPendingActionsForPlanning(supabase, id, decidedById);

  // 3. State machine + UPDATE phase.
  const ctx = await getPlanningPhaseContext(id);
  const result = transition(current, "closed", ctx, "pm");
  if (!result.ok) {
    throw new Error(
      `concludePlanning: transição ${current} → closed inválida (${result.reason}: ${result.detail})`,
    );
  }
  const planning = await updatePlanningPhase(id, result.to, result.stamps);

  return {
    planning,
    applied: { applied: applied.applied, failed: applied.failed, skipped: applied.skipped },
  };
}

// ─── Mutations: links (meetings + transcripts) ────────────────────────────

export async function linkMeetingToPlanning(input: {
  planningCeremonyId: string;
  meetingId: string;
  linkedById: string;
  note?: string | null;
}): Promise<PlanningMeetingLinkRow> {
  const supabase = db();
  const { data, error } = await supabase
    .from("PlanningMeetingLink")
    .insert({
      planningCeremonyId: input.planningCeremonyId,
      meetingId: input.meetingId,
      linkedById: input.linkedById,
      linkedAt: new Date().toISOString(),
      note: input.note ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function unlinkMeetingFromPlanning(
  planningCeremonyId: string,
  meetingId: string,
): Promise<void> {
  const { error } = await db()
    .from("PlanningMeetingLink")
    .delete()
    .eq("planningCeremonyId", planningCeremonyId)
    .eq("meetingId", meetingId);
  if (error) throw error;
}

export async function linkTranscriptToPlanning(input: {
  planningCeremonyId: string;
  transcriptRefId: string;
  linkedById: string;
  weight?: TranscriptWeight;
  note?: string | null;
}): Promise<PlanningTranscriptLinkRow> {
  const supabase = db();
  const { data, error } = await supabase
    .from("PlanningTranscriptLink")
    .insert({
      planningCeremonyId: input.planningCeremonyId,
      transcriptRefId: input.transcriptRefId,
      linkedById: input.linkedById,
      linkedAt: new Date().toISOString(),
      weight: input.weight ?? "supporting",
      note: input.note ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function unlinkTranscriptFromPlanning(
  planningCeremonyId: string,
  transcriptRefId: string,
): Promise<void> {
  const { error } = await db()
    .from("PlanningTranscriptLink")
    .delete()
    .eq("planningCeremonyId", planningCeremonyId)
    .eq("transcriptRefId", transcriptRefId);
  if (error) throw error;
}

// ─── Mutations: TranscriptRef ─────────────────────────────────────────────

/**
 * Idempotente — UNIQUE(source, sourceId) garante 1 row por transcript externo.
 * Útil quando um agente importa um transcript já visto sem cri ar duplicata.
 */
export async function findOrCreateTranscriptRef(input: {
  source: "roam" | "granola" | "manual" | "spreadsheet";
  sourceId: string;
  fullText?: string | null;
  title?: string | null;
  byline?: string | null;
  capturedAt?: string | null;
  meetingId?: string | null;
  importedById?: string | null;
  storagePath?: string | null;
}): Promise<TranscriptRefRow> {
  const supabase = db();
  // Tenta select primeiro (mais cache-friendly que upsert quando já existe).
  const { data: existing } = await supabase
    .from("TranscriptRef")
    .select("*")
    .eq("source", input.source)
    .eq("sourceId", input.sourceId)
    .maybeSingle();
  if (existing) return existing;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("TranscriptRef")
    .insert({
      source: input.source,
      sourceId: input.sourceId,
      fullText: input.fullText ?? null,
      title: input.title ?? null,
      byline: input.byline ?? null,
      capturedAt: input.capturedAt ?? null,
      meetingId: input.meetingId ?? null,
      importedById: input.importedById ?? null,
      storagePath: input.storagePath ?? null,
      importedAt: now,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ─── Mutations: PlanningContextNote ───────────────────────────────────────

export async function addContextNote(input: {
  planningCeremonyId: string;
  kind: ContextNoteKind;
  content: string;
  sourceTranscriptIds?: string[];
  sourceMeetingIds?: string[];
  sourceRepoPath?: string | null;
  priority?: number;
  /** XOR: passar UM dos dois (CHECK constraint no banco enforces). */
  generatedByAgent?: "alpha" | null;
  generatedByMemberId?: string | null;
}): Promise<PlanningContextNoteRow> {
  const supabase = db();

  // Sanidade do XOR antes de bater no banco — erro mais explícito que
  // a violação de CHECK constraint.
  const hasAgent = !!input.generatedByAgent;
  const hasMember = !!input.generatedByMemberId;
  if (hasAgent === hasMember) {
    throw new Error(
      "addContextNote: passe generatedByAgent OU generatedByMemberId, não os dois nem nenhum",
    );
  }

  const { data, error } = await supabase
    .from("PlanningContextNote")
    .insert({
      planningCeremonyId: input.planningCeremonyId,
      kind: input.kind,
      content: input.content,
      sourceTranscriptIds: input.sourceTranscriptIds ?? [],
      sourceMeetingIds: input.sourceMeetingIds ?? [],
      sourceRepoPath: input.sourceRepoPath ?? null,
      priority: input.priority ?? 0,
      generatedByAgent: input.generatedByAgent ?? null,
      generatedByMemberId: input.generatedByMemberId ?? null,
      generatedAt: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function dismissContextNote(
  id: string,
): Promise<PlanningContextNoteRow> {
  const supabase = db();
  const { data, error } = await supabase
    .from("PlanningContextNote")
    .update({ dismissedAt: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Limpa TODAS as notes desta planning. Side effect do reset
 * `reading/proposing → idle` — caller dispara depois que a state machine
 * aprovar a transição.
 */
export async function resetBriefingNotes(
  planningCeremonyId: string,
): Promise<void> {
  const { error } = await db()
    .from("PlanningContextNote")
    .delete()
    .eq("planningCeremonyId", planningCeremonyId);
  if (error) throw error;
}
