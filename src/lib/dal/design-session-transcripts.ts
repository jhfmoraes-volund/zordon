import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Acesso à transcrição de Design Sessions via SSOT (TranscriptRef + link N:N).
 *
 * Hoje cada DS linka 0..N TranscriptRefs via `DesignSessionTranscriptLink`.
 * O Vitor (agent) e a UI de Pre-Work consomem deste módulo — antes liam
 * direto de `DesignSessionTranscript`, droppada na Fundação B (2026-05-29).
 *
 * Forma rica vs leve:
 *   • `listSessionTranscripts` retorna shape rico (metadados + fullText) —
 *     usado pelo Vitor.loadContext e endpoint /full.
 *   • `listSessionTranscriptMeta` exclui fullText — usado na lista da modal
 *     de import, onde só metadados são exibidos.
 */

type SupabaseClientLike = Pick<SupabaseClient<Database>, "from">;

export type SessionTranscript = {
  id: string;                       // PK do link (estável para a DS)
  transcriptRefId: string;          // PK da TranscriptRef
  kind: string;                     // ContextSource.kind (transcript | document | spreadsheet_* | github_*)
  source: string;
  sourceId: string | null;
  meetingTitle: string | null;
  meetingStart: string | null;
  meetingEnd: string | null;
  participants: Array<{ name: string; email?: string }>;
  summary: string | null;
  actionItems: Array<{ title: string; description: string }>;
  fullText: string;
  linkedAt: string;
  linkedById: string | null;
  weight: "primary" | "supporting" | "background" | null;
};

const FULL_SELECT = `
  id,
  "linkedAt",
  "linkedById",
  weight,
  transcript:ContextSource!EntityLink_contextSourceId_fkey(
    id, kind, source, "sourceId", title, "capturedAt", "endedAt",
    participants, summary, "actionItems", "fullText"
  )
` as const;

type LinkRow = {
  id: string;
  linkedAt: string;
  linkedById: string | null;
  weight: string | null;
  transcript: {
    id: string;
    kind: string;
    source: string;
    sourceId: string | null;
    title: string | null;
    capturedAt: string | null;
    endedAt: string | null;
    participants: unknown;
    summary: string | null;
    actionItems: unknown;
    fullText: string | null;
  } | null;
};

function asParticipants(v: unknown): Array<{ name: string; email?: string }> {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is { name: unknown; email?: unknown } => !!x && typeof x === "object")
    .map((x) => ({
      name: typeof x.name === "string" ? x.name : "",
      email: typeof x.email === "string" ? x.email : undefined,
    }));
}

function asActionItems(
  v: unknown,
): Array<{ title: string; description: string }> {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is { title?: unknown; description?: unknown } => !!x && typeof x === "object")
    .map((x) => ({
      title: typeof x.title === "string" ? x.title : "",
      description: typeof x.description === "string" ? x.description : "",
    }));
}

function asWeight(v: string | null): SessionTranscript["weight"] {
  if (v === "primary" || v === "supporting" || v === "background") return v;
  return null;
}

function rowToTranscript(row: LinkRow): SessionTranscript | null {
  if (!row.transcript) return null;
  const t = row.transcript;
  return {
    id: row.id,
    transcriptRefId: t.id,
    kind: t.kind,
    source: t.source,
    sourceId: t.sourceId,
    meetingTitle: t.title,
    meetingStart: t.capturedAt,
    meetingEnd: t.endedAt,
    participants: asParticipants(t.participants),
    summary: t.summary,
    actionItems: asActionItems(t.actionItems),
    fullText: t.fullText ?? "",
    linkedAt: row.linkedAt,
    linkedById: row.linkedById,
    weight: asWeight(row.weight),
  };
}

export async function listSessionTranscripts(
  client: SupabaseClientLike,
  sessionId: string,
): Promise<SessionTranscript[]> {
  const { data, error } = await client
    .from("EntityLink")
    .select(FULL_SELECT)
    .eq("designSessionId", sessionId)
    .not("contextSourceId", "is", null);
  if (error) throw error;
  const rows = (data ?? []) as unknown as LinkRow[];
  const items = rows
    .map(rowToTranscript)
    .filter((x): x is SessionTranscript => x !== null);
  // Ordena por meetingStart desc — preserva a ordem que DST usava no GET.
  items.sort((a, b) => {
    const sa = a.meetingStart ?? "";
    const sb = b.meetingStart ?? "";
    return sb.localeCompare(sa);
  });
  return items;
}

/**
 * Cria o link entre uma DS e um TranscriptRef já existente (idempotente).
 * Retorna o link (existente ou recém-criado). Em conflito de unique
 * (link já existia), retorna a row pré-existente.
 */
export async function linkTranscriptToSession(
  client: SupabaseClientLike,
  params: {
    sessionId: string;
    transcriptRefId: string;
    linkedById?: string | null;
    weight?: "primary" | "supporting" | "background" | null;
  },
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: lookupErr } = await client
    .from("EntityLink")
    .select("id")
    .eq("designSessionId", params.sessionId)
    .eq("contextSourceId", params.transcriptRefId)
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (existing) return { id: existing.id as string, created: false };

  const { data: inserted, error: insErr } = await client
    .from("EntityLink")
    .insert({
      designSessionId: params.sessionId,
      contextSourceId: params.transcriptRefId,
      linkedById: params.linkedById ?? null,
      weight: params.weight ?? "primary",
    })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return { id: inserted.id as string, created: true };
}

export async function unlinkTranscriptFromSession(
  client: SupabaseClientLike,
  params: { sessionId: string; linkId: string },
): Promise<void> {
  const { error } = await client
    .from("EntityLink")
    .delete()
    .eq("id", params.linkId)
    .eq("designSessionId", params.sessionId);
  if (error) throw error;
}
