-- ═══════════════════════════════════════════════════════════
-- TranscriptRef — transcrição como entidade de 1ª classe.
--
-- Hoje, transcript vive como par de colunas em Meeting:
--   Meeting.transcriptSource ('roam'|'granola')
--   Meeting.transcriptSourceId text
-- Isso funciona quando 1 meeting = 1 transcript. Mas Planning Ceremony
-- precisa de:
--   • transcript sem Meeting (Roam-note solta, anotação manual);
--   • 1 transcript alimentando N plannings;
--   • metadados denormalizados (título, byline) pra listagem rápida.
--
-- Modelo:
--   TranscriptRef(id, source, sourceId, title, byline, capturedAt,
--                 importedById, importedAt, meetingId?)
--
-- Backfill: 1 row por Meeting.transcriptSource não-nula, idempotente via
-- ON CONFLICT (source, sourceId) DO NOTHING.
--
-- Meeting.transcriptSource/transcriptSourceId NÃO são droppadas aqui —
-- código atual ainda lê delas em 6 lugares. Sweep em PR separado.
--
-- RLS: visibilidade do TranscriptRef segue a do Meeting linkado (quando há);
-- transcript "solto" (sem meeting) é visível ao importer e managers.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tabela ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."TranscriptRef" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL,
  "sourceId"    text,                            -- null pra source='manual'
  title         text,
  byline        text,                            -- "Cliente X · 2026-05-15"
  "capturedAt"  timestamptz,                     -- quando foi gerado (não importado)
  "importedById" uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "importedAt"  timestamptz NOT NULL DEFAULT now(),
  "meetingId"   uuid REFERENCES public."Meeting"(id) ON DELETE SET NULL
);

ALTER TABLE public."TranscriptRef"
  DROP CONSTRAINT IF EXISTS "TranscriptRef_source_check";
ALTER TABLE public."TranscriptRef"
  ADD CONSTRAINT "TranscriptRef_source_check"
  CHECK ("source" = ANY (ARRAY['roam'::text, 'granola'::text, 'manual'::text]));

-- Unicidade do par (source, sourceId) — apenas quando sourceId não é null.
-- Permite múltiplos 'manual' (sem sourceId externo) sem violar unicidade.
CREATE UNIQUE INDEX IF NOT EXISTS "TranscriptRef_source_sourceId_key"
  ON public."TranscriptRef" ("source", "sourceId")
  WHERE "sourceId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "TranscriptRef_meetingId_idx"
  ON public."TranscriptRef" ("meetingId");

CREATE INDEX IF NOT EXISTS "TranscriptRef_source_capturedAt_idx"
  ON public."TranscriptRef" ("source", "capturedAt" DESC);

-- ── 2. Backfill (idempotente) ──────────────────────────────────────────────
INSERT INTO public."TranscriptRef" ("source", "sourceId", "meetingId", "importedAt")
SELECT
  m."transcriptSource",
  m."transcriptSourceId",
  m.id,
  COALESCE(m."createdAt", now())
FROM public."Meeting" m
WHERE m."transcriptSource" IS NOT NULL
  AND m."transcriptSourceId" IS NOT NULL
ON CONFLICT ("source", "sourceId") WHERE "sourceId" IS NOT NULL DO NOTHING;

-- ── 3. Grants + RLS ────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."TranscriptRef" TO authenticated;

ALTER TABLE public."TranscriptRef" ENABLE ROW LEVEL SECURITY;

-- SELECT: vê transcript se (a) é manager, OU (b) vê o meeting linkado,
-- OU (c) é o importer (transcript solto seu).
CREATE POLICY "transcriptref_select" ON public."TranscriptRef"
  FOR SELECT USING (
    public.is_manager()
    OR ("meetingId" IS NOT NULL AND public.can_view_meeting("meetingId"))
    OR ("importedById" IS NOT NULL AND "importedById" = public.get_my_member_id())
  );

-- INSERT: qualquer authenticated pode importar (consistente com import atual de Meeting).
CREATE POLICY "transcriptref_insert" ON public."TranscriptRef"
  FOR INSERT WITH CHECK (
    "importedById" IS NULL
    OR "importedById" = public.get_my_member_id()
    OR public.is_manager()
  );

-- UPDATE: importer próprio OU manager.
CREATE POLICY "transcriptref_update" ON public."TranscriptRef"
  FOR UPDATE
  USING (
    public.is_manager()
    OR ("importedById" IS NOT NULL AND "importedById" = public.get_my_member_id())
  )
  WITH CHECK (
    public.is_manager()
    OR ("importedById" IS NOT NULL AND "importedById" = public.get_my_member_id())
  );

-- DELETE: importer próprio OU manager.
CREATE POLICY "transcriptref_delete" ON public."TranscriptRef"
  FOR DELETE USING (
    public.is_manager()
    OR ("importedById" IS NOT NULL AND "importedById" = public.get_my_member_id())
  );

COMMENT ON TABLE public."TranscriptRef" IS
  'Transcrição como entidade de 1ª classe. Backfill 2026-05-28 dos Meeting.transcriptSource existentes. meetingId opcional pra transcripts soltos (Roam-note sem call).';

COMMIT;
