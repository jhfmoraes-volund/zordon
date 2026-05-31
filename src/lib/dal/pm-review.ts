/**
 * PM Review — Data Access Layer.
 *
 * Convenções (espelha src/lib/dal/planning.ts):
 *   • `db()` (service_role) — bypassa RLS de propósito. Caller valida acesso
 *     ANTES via `canViewProject` / `canCreatePMReview`.
 *   • Funções recebem ids prontos; nenhuma lê o caller.
 *   • Throw em erro; null/empty pra "não existe".
 *
 * Status é atualizado SÓ via `transitionPMReviewStatus`, que delega à state
 * lib `src/lib/pm-review/status.ts`. Esta camada não decide regras.
 */
import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";
import { transition, type PMReviewStatus } from "@/lib/pm-review/status";

type Tables = Database["public"]["Tables"];

// ─── Row types ────────────────────────────────────────────────────────────

export type PMReviewRow = Tables["PMReview"]["Row"];
// Links unificados em EntityLink (meeting/transcript distinguidos por ref preenchido).
export type PMReviewMeetingLinkRow = Tables["EntityLink"]["Row"];
export type PMReviewTranscriptLinkRow = Tables["EntityLink"]["Row"];
export type PMReviewNoteRow = Tables["PMReviewNote"]["Row"];

export type TranscriptWeight = "primary" | "supporting" | "background";

/** Kinds aceitos em PMReviewNote (espelha CHECK constraint). */
export type PMReviewNoteKind =
  | "summary"
  | "project_direction"
  | "next_step"
  | "risk"
  | "need"
  | "team_signal"
  | "open_decision";

export const PM_REVIEW_NOTE_KINDS: PMReviewNoteKind[] = [
  "summary",
  "project_direction",
  "next_step",
  "risk",
  "need",
  "team_signal",
  "open_decision",
];

/** Forma leve pra a tab Rituais (lista normalizada UNION com Planning). */
export type PMReviewSummary = {
  id: string;
  projectId: string;
  referenceWeek: string; // YYYY-MM-DD (segunda)
  status: PMReviewStatus;
  scheduledFor: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  reportGeneratedAt: string | null;
  facilitatorId: string | null;
  facilitatorName: string | null;
  linkedMeetingCount: number;
  linkedTranscriptCount: number;
  noteCountByKind: Partial<Record<PMReviewNoteKind, number>>;
  noteTotal: number;
};

export type PMReviewDetail = PMReviewSummary & {
  reportMarkdown: string | null;
  createdAt: string;
  updatedAt: string;
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
    weight: TranscriptWeight | null;
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
  notes: PMReviewNoteRow[];
  /**
   * Status do contexto que a Vitoria precisa pra sintetizar com qualidade.
   * Usado na UI pra gatear o botão "Sintetizar report" e mostrar o checklist
   * de "o que falta antes da síntese".
   */
  projectContext: {
    /** ≥1 transcript linkado a este PM Review. Único item user-curated. */
    hasTranscripts: boolean;
    /** ≥1 DesignSession ativa no projeto. */
    hasActiveDS: boolean;
    /** ≥1 Sprint no projeto (current ou upcoming). */
    hasSprint: boolean;
    /** ≥3 notes ativas (matéria-prima alternativa pra síntese). */
    hasNotesEnough: boolean;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Resolve a segunda-feira da semana de uma data (UTC, ISO).
 * Se o caller já passou uma segunda, retorna como veio.
 */
export function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listPMReviewsForProject(
  projectId: string,
): Promise<PMReviewSummary[]> {
  const supabase = db();
  const { data: rows, error } = await supabase
    .from("PMReview")
    .select(
      "id, projectId, referenceWeek, status, scheduledFor, publishedAt, archivedAt, reportGeneratedAt, facilitatorId, facilitator:Member!PMReview_facilitatorId_fkey(name)",
    )
    .eq("projectId", projectId)
    .order("referenceWeek", { ascending: false });
  if (error) throw error;

  const ids = (rows ?? []).map((r) => r.id);
  if (ids.length === 0) return [];

  const [meetingsRes, transcriptsRes, notesRes] = await Promise.all([
    supabase
      .from("EntityLink")
      .select("pmReviewId")
      .in("pmReviewId", ids)
      .not("meetingId", "is", null),
    supabase
      .from("EntityLink")
      .select("pmReviewId")
      .in("pmReviewId", ids)
      .not("transcriptRefId", "is", null),
    supabase
      .from("PMReviewNote")
      .select("pmReviewId, kind")
      .in("pmReviewId", ids)
      .is("dismissedAt", null),
  ]);

  // pmReviewId é non-null em todas as rows retornadas pelos filtros .in() acima
  const meetingsByPm = countBy(meetingsRes.data ?? [], (r) => r.pmReviewId as string);
  const transcriptsByPm = countBy(transcriptsRes.data ?? [], (r) => r.pmReviewId as string);
  const notesByPmKind = new Map<string, Map<string, number>>();
  const totalsByPm = new Map<string, number>();
  for (const n of notesRes.data ?? []) {
    const inner = notesByPmKind.get(n.pmReviewId) ?? new Map<string, number>();
    inner.set(n.kind, (inner.get(n.kind) ?? 0) + 1);
    notesByPmKind.set(n.pmReviewId, inner);
    totalsByPm.set(n.pmReviewId, (totalsByPm.get(n.pmReviewId) ?? 0) + 1);
  }

  return (rows ?? []).map((r) => {
    const fac = r.facilitator as { name: string | null } | null;
    const noteMap = notesByPmKind.get(r.id) ?? new Map();
    const noteCountByKind: Partial<Record<PMReviewNoteKind, number>> = {};
    for (const [k, v] of noteMap.entries()) {
      noteCountByKind[k as PMReviewNoteKind] = v;
    }
    return {
      id: r.id,
      projectId: r.projectId,
      referenceWeek: r.referenceWeek,
      status: r.status as PMReviewStatus,
      scheduledFor: r.scheduledFor,
      publishedAt: r.publishedAt,
      archivedAt: r.archivedAt,
      reportGeneratedAt: r.reportGeneratedAt,
      facilitatorId: r.facilitatorId,
      facilitatorName: fac?.name ?? null,
      linkedMeetingCount: meetingsByPm.get(r.id) ?? 0,
      linkedTranscriptCount: transcriptsByPm.get(r.id) ?? 0,
      noteCountByKind,
      noteTotal: totalsByPm.get(r.id) ?? 0,
    };
  });
}

export async function getPMReview(id: string): Promise<PMReviewDetail | null> {
  const supabase = db();
  const { data: row, error } = await supabase
    .from("PMReview")
    .select(
      "*, facilitator:Member!PMReview_facilitatorId_fkey(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const [meetingsRes, transcriptsRes, notesRes, dsRes, sprintRes] = await Promise.all([
    supabase
      .from("EntityLink")
      .select(
        'id, "meetingId", "linkedAt", "linkedById", note, meeting:Meeting!EntityLink_meetingId_fkey(id, title, date, visibility, kind)',
      )
      .eq("pmReviewId", id)
      .not("meetingId", "is", null)
      .order("linkedAt", { ascending: false }),
    supabase
      .from("EntityLink")
      .select(
        'id, "transcriptRefId", "linkedAt", "linkedById", weight, note, transcript:TranscriptRef!EntityLink_transcriptRefId_fkey(id, source, "sourceId", title, "capturedAt", "meetingId")',
      )
      .eq("pmReviewId", id)
      .not("transcriptRefId", "is", null)
      .order("linkedAt", { ascending: false }),
    supabase
      .from("PMReviewNote")
      .select("*")
      .eq("pmReviewId", id)
      .order("priority", { ascending: false })
      .order("generatedAt", { ascending: true }),
    // Camada DS — ≥1 sessão ativa basta pra marcar hasActiveDS.
    supabase
      .from("DesignSession")
      .select("id", { count: "exact", head: true })
      .eq("projectId", row.projectId)
      .in("status", ["active", "in_progress"]),
    // Camada Sistema — qualquer Sprint serve (ops info disponível).
    supabase
      .from("Sprint")
      .select("id", { count: "exact", head: true })
      .eq("projectId", row.projectId),
  ]);

  if (meetingsRes.error) throw meetingsRes.error;
  if (transcriptsRes.error) throw transcriptsRes.error;
  if (notesRes.error) throw notesRes.error;

  const fac = row.facilitator as { name: string | null } | null;
  const notes = (notesRes.data ?? []) as PMReviewNoteRow[];
  const noteCountByKind: Partial<Record<PMReviewNoteKind, number>> = {};
  let noteTotal = 0;
  for (const n of notes) {
    if (n.dismissedAt) continue;
    noteCountByKind[n.kind as PMReviewNoteKind] =
      (noteCountByKind[n.kind as PMReviewNoteKind] ?? 0) + 1;
    noteTotal += 1;
  }

  return {
    id: row.id,
    projectId: row.projectId,
    referenceWeek: row.referenceWeek,
    status: row.status as PMReviewStatus,
    scheduledFor: row.scheduledFor,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    reportGeneratedAt: row.reportGeneratedAt,
    facilitatorId: row.facilitatorId,
    facilitatorName: fac?.name ?? null,
    linkedMeetingCount: meetingsRes.data?.length ?? 0,
    linkedTranscriptCount: transcriptsRes.data?.length ?? 0,
    noteCountByKind,
    noteTotal,
    reportMarkdown: row.reportMarkdown,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    linkedMeetings: (meetingsRes.data ?? [])
      .filter((l) => l.meetingId !== null)
      .map((l) => ({
        meetingId: l.meetingId as string,
        linkedAt: l.linkedAt,
        linkedById: l.linkedById,
        note: l.note,
        meeting: l.meeting as PMReviewDetail["linkedMeetings"][number]["meeting"],
      })),
    linkedTranscripts: (transcriptsRes.data ?? [])
      .filter((l) => l.transcriptRefId !== null)
      .map((l) => ({
        transcriptRefId: l.transcriptRefId as string,
        linkedAt: l.linkedAt,
        linkedById: l.linkedById,
        weight: (l.weight as TranscriptWeight | null) ?? null,
        note: l.note,
        transcript: l.transcript as PMReviewDetail["linkedTranscripts"][number]["transcript"],
      })),
    notes,
    projectContext: {
      hasTranscripts: (transcriptsRes.data?.length ?? 0) > 0,
      hasActiveDS: (dsRes.count ?? 0) > 0,
      hasSprint: (sprintRes.count ?? 0) > 0,
      hasNotesEnough: noteTotal >= 3,
    },
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function createPMReview(input: {
  projectId: string;
  referenceWeek?: string | null; // YYYY-MM-DD; default = monday of today
  facilitatorId?: string | null;
  scheduledFor?: string | null;
}): Promise<PMReviewRow> {
  const supabase = db();
  const week = input.referenceWeek ?? mondayOf(new Date());

  const { data: inserted, error } = await supabase
    .from("PMReview")
    .insert({
      projectId: input.projectId,
      referenceWeek: week,
      facilitatorId: input.facilitatorId ?? null,
      scheduledFor: input.scheduledFor ?? null,
      // status default 'draft' via DB.
    })
    .select("*")
    .single();
  if (error) throw error;
  return inserted as PMReviewRow;
}

export async function updatePMReview(
  id: string,
  patch: {
    referenceWeek?: string;
    facilitatorId?: string | null;
    scheduledFor?: string | null;
    reportMarkdown?: string | null;
    reportGeneratedAt?: string | null;
  },
): Promise<PMReviewRow> {
  const supabase = db();
  const { data: updated, error } = await supabase
    .from("PMReview")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return updated as PMReviewRow;
}

export async function deletePMReview(id: string): Promise<void> {
  const supabase = db();
  const { error } = await supabase.from("PMReview").delete().eq("id", id);
  if (error) throw error;
}

export async function transitionPMReviewStatus(
  id: string,
  to: PMReviewStatus,
): Promise<PMReviewRow> {
  const supabase = db();
  const { data: current, error: loadErr } = await supabase
    .from("PMReview")
    .select("status")
    .eq("id", id)
    .single();
  if (loadErr) throw loadErr;

  const result = transition(current.status, to);
  if (!result.ok) {
    throw new Error(`PMReview transition failed: ${result.detail}`);
  }

  const { data: updated, error: updErr } = await supabase
    .from("PMReview")
    .update({ status: to, ...result.stamps })
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) throw updErr;
  return updated as PMReviewRow;
}

// ─── Links ────────────────────────────────────────────────────────────────

export async function linkMeetingToPMReview(params: {
  pmReviewId: string;
  meetingId: string;
  linkedById?: string | null;
  note?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const supabase = db();
  const { data: existing } = await supabase
    .from("EntityLink")
    .select("id")
    .eq("pmReviewId", params.pmReviewId)
    .eq("meetingId", params.meetingId)
    .maybeSingle();
  if (existing) return { id: existing.id, created: false };

  const { data: inserted, error } = await supabase
    .from("EntityLink")
    .insert({
      pmReviewId: params.pmReviewId,
      meetingId: params.meetingId,
      linkedById: params.linkedById ?? null,
      note: params.note ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: inserted.id, created: true };
}

export async function unlinkMeetingFromPMReview(params: {
  pmReviewId: string;
  meetingId: string;
}): Promise<void> {
  const supabase = db();
  const { error } = await supabase
    .from("EntityLink")
    .delete()
    .eq("pmReviewId", params.pmReviewId)
    .eq("meetingId", params.meetingId);
  if (error) throw error;
}

export async function linkTranscriptToPMReview(params: {
  pmReviewId: string;
  transcriptRefId: string;
  linkedById?: string | null;
  weight?: TranscriptWeight | null;
  note?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const supabase = db();
  const { data: existing } = await supabase
    .from("EntityLink")
    .select("id")
    .eq("pmReviewId", params.pmReviewId)
    .eq("transcriptRefId", params.transcriptRefId)
    .maybeSingle();
  if (existing) return { id: existing.id, created: false };

  const { data: inserted, error } = await supabase
    .from("EntityLink")
    .insert({
      pmReviewId: params.pmReviewId,
      transcriptRefId: params.transcriptRefId,
      linkedById: params.linkedById ?? null,
      weight: params.weight ?? "primary",
      note: params.note ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: inserted.id, created: true };
}

export async function unlinkTranscriptFromPMReview(params: {
  pmReviewId: string;
  transcriptRefId: string;
}): Promise<void> {
  const supabase = db();
  const { error } = await supabase
    .from("EntityLink")
    .delete()
    .eq("pmReviewId", params.pmReviewId)
    .eq("transcriptRefId", params.transcriptRefId);
  if (error) throw error;
}

// ─── Notes ────────────────────────────────────────────────────────────────

export async function addPMReviewNote(input: {
  pmReviewId: string;
  kind: PMReviewNoteKind;
  content: string;
  sourceTranscriptIds?: string[];
  sourceMeetingIds?: string[];
  priority?: number;
  generatedByAgent?: "vitoria" | null;
  generatedByMemberId?: string | null;
}): Promise<PMReviewNoteRow> {
  const supabase = db();
  // XOR enforced by DB CHECK; ensure caller passes exactly one origin.
  if (
    (input.generatedByAgent && input.generatedByMemberId) ||
    (!input.generatedByAgent && !input.generatedByMemberId)
  ) {
    throw new Error(
      "PMReviewNote: passe exatamente um origin — generatedByAgent OU generatedByMemberId.",
    );
  }
  const { data: inserted, error } = await supabase
    .from("PMReviewNote")
    .insert({
      pmReviewId: input.pmReviewId,
      kind: input.kind,
      content: input.content,
      sourceTranscriptIds: input.sourceTranscriptIds ?? [],
      sourceMeetingIds: input.sourceMeetingIds ?? [],
      priority: input.priority ?? 0,
      generatedByAgent: input.generatedByAgent ?? null,
      generatedByMemberId: input.generatedByMemberId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return inserted as PMReviewNoteRow;
}

export async function updatePMReviewNote(
  id: string,
  patch: {
    kind?: PMReviewNoteKind;
    content?: string;
    priority?: number;
    dismissedAt?: string | null;
  },
): Promise<PMReviewNoteRow> {
  const supabase = db();
  const { data: updated, error } = await supabase
    .from("PMReviewNote")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return updated as PMReviewNoteRow;
}

export async function deletePMReviewNote(id: string): Promise<void> {
  const supabase = db();
  const { error } = await supabase.from("PMReviewNote").delete().eq("id", id);
  if (error) throw error;
}

// ─── util local ───────────────────────────────────────────────────────────

function countBy<T>(rows: T[], key: (r: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}
