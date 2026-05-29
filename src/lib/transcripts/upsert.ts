import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Upsert idempotente em `TranscriptRef` — ponto único de escrita de transcrição.
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
 * Retorna o `id` do `TranscriptRef` (criado ou pré-existente).
 */

type SupabaseClientLike = Pick<SupabaseClient, "from">;

export type TranscriptSource = "roam" | "granola" | "manual" | "spreadsheet";

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
};

export async function upsertTranscriptRef(
  client: SupabaseClientLike,
  input: UpsertTranscriptRefInput,
): Promise<string> {
  if (input.sourceId) {
    const { data: existing, error: lookupErr } = await client
      .from("TranscriptRef")
      .select("id, fullText, title, byline, capturedAt, meetingId")
      .eq("source", input.source)
      .eq("sourceId", input.sourceId)
      .maybeSingle();

    if (lookupErr) throw lookupErr;

    if (existing) {
      // Patch só com campos vindos não-vazios, preservando dado existente.
      const patch: Record<string, unknown> = {};
      if (input.meetingId && !existing.meetingId) patch.meetingId = input.meetingId;
      if (input.fullText && !existing.fullText) patch.fullText = input.fullText;
      if (input.title && !existing.title) patch.title = input.title;
      if (input.byline && !existing.byline) patch.byline = input.byline;
      if (input.capturedAt && !existing.capturedAt) patch.capturedAt = input.capturedAt;
      if (Object.keys(patch).length > 0) {
        const { error: updErr } = await client
          .from("TranscriptRef")
          .update(patch)
          .eq("id", existing.id);
        if (updErr) throw updErr;
      }
      return existing.id as string;
    }
  }

  const { data: inserted, error: insErr } = await client
    .from("TranscriptRef")
    .insert({
      source: input.source,
      sourceId: input.sourceId ?? null,
      meetingId: input.meetingId ?? null,
      fullText: input.fullText ?? null,
      title: input.title ?? null,
      byline: input.byline ?? null,
      capturedAt: input.capturedAt ?? null,
      importedById: input.importedById ?? null,
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
    .from("TranscriptRef")
    .select("id, source, sourceId, fullText, title, byline, capturedAt")
    .eq("meetingId", meetingId)
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
