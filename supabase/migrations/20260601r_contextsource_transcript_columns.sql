-- Fase 1 da unificação ContextSource (Jeito A): torna ContextSource um superset
-- completo de TranscriptRef, adicionando as colunas dos campos ricos que os
-- agentes leem estruturado. ADITIVO — nullable (só preenchido p/ kind='transcript'
-- e 'spreadsheet_*'). Não toca código nem dados existentes.
-- Ver docs/platform/context-source-unification-plan.md.

ALTER TABLE "ContextSource" ADD COLUMN IF NOT EXISTS source         text;
ALTER TABLE "ContextSource" ADD COLUMN IF NOT EXISTS "sourceId"     text;
ALTER TABLE "ContextSource" ADD COLUMN IF NOT EXISTS byline         text;
ALTER TABLE "ContextSource" ADD COLUMN IF NOT EXISTS "meetingId"    uuid REFERENCES "Meeting"(id) ON DELETE SET NULL;
ALTER TABLE "ContextSource" ADD COLUMN IF NOT EXISTS "storagePath"  text;
ALTER TABLE "ContextSource" ADD COLUMN IF NOT EXISTS "endedAt"      timestamptz;
ALTER TABLE "ContextSource" ADD COLUMN IF NOT EXISTS participants   jsonb;
ALTER TABLE "ContextSource" ADD COLUMN IF NOT EXISTS "actionItems"  jsonb;

-- Índice p/ "transcript deste meeting" (espelha TranscriptRef.meetingId).
CREATE INDEX IF NOT EXISTS contextsource_meeting_idx ON "ContextSource" ("meetingId") WHERE "meetingId" IS NOT NULL;

-- Rollback: ALTER TABLE "ContextSource" DROP COLUMN source, DROP COLUMN "sourceId",
--   DROP COLUMN byline, DROP COLUMN "meetingId", DROP COLUMN "storagePath",
--   DROP COLUMN "endedAt", DROP COLUMN participants, DROP COLUMN "actionItems";
