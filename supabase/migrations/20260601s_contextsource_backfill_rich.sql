-- Fase 2 da unificação ContextSource: backfill dos campos ricos do TranscriptRef
-- pras colunas novas. O backfill original (20260530d) só copiou fullText e jogou
-- source/sourceId/byline/meetingId no payload — deixou participants/actionItems/
-- summary/endedAt/storagePath de fora. Aqui completamos. ADITIVO/idempotente.

-- 1. Completa os ContextSource(kind='transcript') que compartilham id com TranscriptRef.
UPDATE "ContextSource" cs SET
  source         = tr.source,
  "sourceId"     = tr."sourceId",
  byline         = tr.byline,
  "meetingId"    = tr."meetingId",
  "storagePath"  = tr."storagePath",
  "endedAt"      = tr."endedAt",
  participants   = tr.participants,
  "actionItems"  = tr."actionItems",
  summary        = COALESCE(cs.summary, tr.summary)
FROM "TranscriptRef" tr
WHERE cs.id = tr.id;

-- 2. Defensivo: qualquer TranscriptRef sem ContextSource correspondente (criado
--    depois do backfill original) ganha um agora. Idempotente via NOT EXISTS.
INSERT INTO "ContextSource" (
  id, kind, title, source, "sourceId", byline, "meetingId", "storagePath",
  "endedAt", participants, "actionItems", "fullText", summary, "capturedAt",
  "createdBy", "createdAt", "updatedAt"
)
SELECT
  tr.id, 'transcript'::public.context_source_kind,
  COALESCE(tr.title, tr.byline, 'Transcript sem título'),
  tr.source, tr."sourceId", tr.byline, tr."meetingId", tr."storagePath",
  tr."endedAt", tr.participants, tr."actionItems", tr."fullText", tr.summary,
  tr."capturedAt", tr."importedById", tr."importedAt", tr."importedAt"
FROM "TranscriptRef" tr
WHERE NOT EXISTS (SELECT 1 FROM "ContextSource" cs WHERE cs.id = tr.id);

-- 3. Dedup: espelha o UNIQUE(source, sourceId) parcial do TranscriptRef.
--    Habilita ON CONFLICT pra ingestão idempotente na Fase 3.
CREATE UNIQUE INDEX IF NOT EXISTS contextsource_source_sourceid_uniq
  ON "ContextSource" (source, "sourceId")
  WHERE source IS NOT NULL AND "sourceId" IS NOT NULL;

-- Rollback: DROP INDEX IF EXISTS contextsource_source_sourceid_uniq;
--   (as colunas voltam a NULL se a Fase 1 for revertida)
