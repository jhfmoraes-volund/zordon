import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Upsert idempotente em `ContextSource` — ponto único de escrita de transcrição.
 *
 * (Migração Jeito A: escreve ContextSource, o SSOT unificado. `source` mapeia
 * pra `kind`: spreadsheet→'spreadsheet_csv', resto→'transcript'. Nome da função
 * mantido pros callers; ver docs/platform/context-source-unification-plan.md.)
 *
 * Toda feature que ingere transcript (Granola cron, import modal de Roam,
 * upload de planilha, criação manual) **deve** passar por aqui. Garante:
 *   • Dedup por (source, sourceId) — mesmo Roam/Granola não duplica.
 *   • Link com Meeting via `meetingId` quando existir reunião correspondente.
 *   • `fullText` propagado quando o caller já tem o texto em mãos.
 *
 * Lookup-then-write (em vez de Supabase `.upsert()`) porque `sourceId` pode
 * ser NULL para `source='manual'` — UNIQUE index é parcial, e o cliente JS
 * não expressa `ON CONFLICT WHERE`. Ler primeiro é correto e barato.
 *
 * Retorna o `id` do `ContextSource` (criado ou pré-existente).
 */

type SupabaseClientLike = Pick<SupabaseClient, "from">;

export type TranscriptSource = "roam" | "granola" | "manual" | "spreadsheet";

/** source → ContextSource.kind. Planilha vira fonte própria (não "transcript"). */
function kindForSource(source: TranscriptSource): "transcript" | "spreadsheet_csv" {
  return source === "spreadsheet" ? "spreadsheet_csv" : "transcript";
}

export type UpsertTranscriptRefInput = {
  source: TranscriptSource;
  /** Externo (note id, roam id, storage path). Pode ser null para manual. */
  sourceId?: string | null;
  meetingId?: string | null;
  fullText?: string | null;
  title?: string | null;
  byline?: string | null;
  capturedAt?: string | null;
  importedById?: string | null;
  /** Projeto ao qual a transcrição pertence (roteamento por folder do Granola).
   *  SSOT que o PM Review lê (ContextSource.projectId). Null = não roteada. */
  projectId?: string | null;
};

export async function upsertTranscriptRef(
  client: SupabaseClientLike,
  input: UpsertTranscriptRefInput,
): Promise<string> {
  if (input.sourceId) {
    const { data: existing, error: lookupErr } = await client
      .from("ContextSource")
      .select('id, "fullText", title, byline, "capturedAt", "meetingId", "projectId"')
      .eq("source", input.source)
      .eq("sourceId", input.sourceId)
      .maybeSingle();

    if (lookupErr) throw lookupErr;

    if (existing) {
      // Patch só com campos vindos não-vazios, preservando dado existente.
      const patch: Record<string, unknown> = {};
      if (input.meetingId && !existing.meetingId) patch.meetingId = input.meetingId;
      if (input.fullText && !existing.fullText) patch.fullText = input.fullText;
      if (input.byline && !existing.byline) patch.byline = input.byline;
      if (input.capturedAt && !existing.capturedAt) patch.capturedAt = input.capturedAt;
      if (input.projectId && !existing.projectId) patch.projectId = input.projectId;
      if (Object.keys(patch).length > 0) {
        const { error: updErr } = await client
          .from("ContextSource")
          .update(patch)
          .eq("id", existing.id);
        if (updErr) throw updErr;
      }
      return existing.id as string;
    }
  }

  const { data: inserted, error: insErr } = await client
    .from("ContextSource")
    .insert({
      kind: kindForSource(input.source),
      source: input.source,
      sourceId: input.sourceId ?? null,
      meetingId: input.meetingId ?? null,
      fullText: input.fullText ?? null,
      // title é NOT NULL em ContextSource — fallback pro byline ou placeholder.
      title: input.title ?? input.byline ?? "Transcript sem título",
      byline: input.byline ?? null,
      capturedAt: input.capturedAt ?? null,
      createdBy: input.importedById ?? null,
      projectId: input.projectId ?? null,
    })
    .select("id")
    .single();

  if (insErr) throw insErr;
  return inserted.id as string;
}

/**
 * Busca o `TranscriptRef` ligado a um Meeting, se houver.
 * Retorna null quando o meeting não tem transcript registrado.
 */
export async function getTranscriptRefForMeeting(
  client: SupabaseClientLike,
  meetingId: string,
): Promise<{
  id: string;
  source: TranscriptSource;
  sourceId: string | null;
  fullText: string | null;
  title: string | null;
  byline: string | null;
  capturedAt: string | null;
} | null> {
  const { data, error } = await client
    .from("ContextSource")
    .select('id, source, "sourceId", "fullText", title, byline, "capturedAt"')
    .eq("meetingId", meetingId)
    .eq("kind", "transcript")
    .maybeSingle();
  if (error) throw error;
  return (data as {
    id: string;
    source: TranscriptSource;
    sourceId: string | null;
    fullText: string | null;
    title: string | null;
    byline: string | null;
    capturedAt: string | null;
  } | null) ?? null;
}
