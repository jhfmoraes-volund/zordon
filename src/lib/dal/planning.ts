/**
 * PlanningCeremony — Data Access Layer (companion-ceremony core).
 *
 * Sprint Planning (a cerimônia per-sprint) foi removida 2026-06-20 — o Planning
 * único é o `PlanningSession` (channel `release_planning`). O que sobrou aqui é
 * só o que o **apply do Planning** e a Vitoria ainda usam: a `PlanningCeremony`
 * vive como companion HEADLESS de um PlanningSession (sprintId NULL) e hospeda o
 * staging de tasks/stories. `concludePlanning` aplica as MeetingTaskAction
 * pendentes (via executor compartilhado) e fecha; `addContextNote` é o lastro de
 * procedência das propostas da Vitoria.
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
export type PlanningContextNoteRow = Tables["PlanningContextNote"]["Row"];

/** Weight de um transcript linkado — guia o Alpha sobre relevância. */
export type TranscriptWeight = "primary" | "supporting" | "background";

/** Kinds aceitos em PlanningContextNote (espelha CHECK constraint). */
export type ContextNoteKind =
  | "summary"
  | "theme"
  | "risk"
  | "capacity_signal"
  | "code_observation"
  | "open_question"
  | "scope_creep";

/** Shape de retorno da lista — leve. */
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

/** Shape de retorno do detalhe — usado pelo apply (lê projectId + phase). */
export type PlanningDetail = PlanningSummary & {
  projectName: string | null;
  briefingGeneratedAt: string | null;
  archivedAt: string | null;
  projectRepo: {
    owner: string | null;
    name: string | null;
    branch: string | null;
    manifestUpdatedAt: string | null;
  };
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
      source: string | null;
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
 * Detalhe completo de uma planning (companion ceremony).
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
      project:Project(name, githubRepoOwner, githubRepoName, githubDefaultBranch, repoManifestUpdatedAt),
      links:EntityLink!EntityLink_planningCeremonyId_fkey(
        meetingId, contextSourceId, linkedAt, linkedById, weight, note,
        meeting:Meeting!EntityLink_meetingId_fkey(id, title, date, visibility, kind),
        transcript:ContextSource!EntityLink_contextSourceId_fkey(id, source, sourceId, title, capturedAt, meetingId)
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
  type EntityLinkEmbed = {
    meetingId: string | null;
    contextSourceId: string | null;
    linkedAt: string;
    linkedById: string | null;
    weight: string | null;
    note: string | null;
    meeting: PlanningDetail["linkedMeetings"][number]["meeting"];
    transcript: PlanningDetail["linkedTranscripts"][number]["transcript"];
  };
  type Row = typeof row;
  const r = row as Row & {
    sprint: { name: string } | null;
    facilitator: { name: string } | null;
    project: {
      name: string | null;
      githubRepoOwner: string | null;
      githubRepoName: string | null;
      githubDefaultBranch: string | null;
      repoManifestUpdatedAt: string | null;
    } | null;
    links: EntityLinkEmbed[];
    notes: PlanningContextNoteRow[];
  };

  // EntityLink unifica meeting/transcript numa tabela — particiona pelo ref preenchido.
  const allLinks = r.links ?? [];
  const linkedMeetings: PlanningDetail["linkedMeetings"] = allLinks
    .filter((l) => l.meetingId !== null)
    .map((l) => ({
      meetingId: l.meetingId as string,
      linkedAt: l.linkedAt,
      linkedById: l.linkedById,
      note: l.note,
      meeting: l.meeting,
    }));
  const linkedTranscripts: PlanningDetail["linkedTranscripts"] = allLinks
    .filter((l) => l.contextSourceId !== null)
    .map((l) => ({
      transcriptRefId: l.contextSourceId as string,
      linkedAt: l.linkedAt,
      linkedById: l.linkedById,
      weight: (l.weight as TranscriptWeight | null) ?? "supporting",
      note: l.note,
      transcript: l.transcript as unknown as PlanningDetail["linkedTranscripts"][number]["transcript"],
    }));

  const notesActive = r.notes.filter((n) => n.dismissedAt === null);

  return {
    id: r.id,
    projectId: r.projectId,
    projectName: r.project?.name ?? null,
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
    linkedMeetingCount: linkedMeetings.length,
    linkedTranscriptCount: linkedTranscripts.length,
    contextNoteCount: notesActive.length,
    pendingActionCount: pendingActionCount ?? 0,
    linkedMeetings,
    linkedTranscripts,
    notes: r.notes,
    projectRepo: {
      owner: r.project?.githubRepoOwner ?? null,
      name: r.project?.githubRepoName ?? null,
      branch: r.project?.githubDefaultBranch ?? null,
      manifestUpdatedAt: r.project?.repoManifestUpdatedAt ?? null,
    },
  };
}

/**
 * Carrega o `PhaseContext` (counts) que a state machine `transition()` exige.
 * Chamado por `concludePlanning` antes de validar a transição → closed.
 *
 * 1 round-trip pra Postgres com 5 head-counts em paralelo.
 */
export async function getPlanningPhaseContext(
  id: string,
): Promise<PhaseContext> {
  const supabase = db();

  const [meetings, transcripts, notes, summaryNotes, pending] = await Promise.all([
    supabase
      .from("EntityLink")
      .select("id", { count: "exact", head: true })
      .eq("planningCeremonyId", id)
      .not("meetingId", "is", null),
    supabase
      .from("EntityLink")
      .select("id", { count: "exact", head: true })
      .eq("planningCeremonyId", id)
      .not("contextSourceId", "is", null),
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

// ─── Mutations: phase + conclude ──────────────────────────────────────────

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
 * Conclui (aplica) uma planning. Aplica as propostas pendentes e fecha.
 * Re-concluir é idempotente: `applyPendingActionsForPlanning` só pega actions
 * ainda pending, então tasks já criadas não duplicam ao re-aplicar.
 *
 * Sequência:
 *   1. Auto-aprova e aplica todas as MeetingTaskAction(decision=pending) via
 *      `applyPendingActionsForPlanning` (executor compartilhado).
 *   2. Roda a state machine `transition(current → closed, actor=pm)` pra
 *      validar e obter stamps.
 *   3. UPDATE phase='closed' + closedAt (trigger SQL revalida como fail-safe).
 *
 * Não há transação real (Supabase JS não expõe). Se passo 1 falha parcial,
 * actions ficam com `execution='failed'` e a phase NÃO é avançada.
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
  generatedByAgent?: "alpha" | "vitoria" | null;
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
