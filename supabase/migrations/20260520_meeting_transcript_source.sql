-- ═══════════════════════════════════════════════════════════
-- DesignSessionTranscript — source-agnostic ingestion
--
-- Today the table only stores Roam transcripts (column `roamTranscriptId`).
-- The product now imports from Granola too, so we generalize:
--   1) add `source` discriminator ('roam'|'granola')
--   2) rename `roamTranscriptId` → `sourceId`
--   3) replace the (sessionId, roamTranscriptId) UNIQUE with
--      (sessionId, source, sourceId) so a Granola note id can coexist
--      with a Roam transcript id that happens to share the same string.
--
-- Every existing row is Roam, so the column defaults to 'roam' for the
-- backfill; the default is dropped at the end to force callers to be
-- explicit on every insert.
-- ═══════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public."DesignSessionTranscript"
  ADD COLUMN "source" text NOT NULL DEFAULT 'roam'
    CHECK ("source" IN ('roam','granola'));

ALTER TABLE public."DesignSessionTranscript"
  RENAME COLUMN "roamTranscriptId" TO "sourceId";

ALTER TABLE public."DesignSessionTranscript"
  DROP CONSTRAINT IF EXISTS "DesignSessionTranscript_sessionId_roamTranscriptId_key";

ALTER TABLE public."DesignSessionTranscript"
  ADD CONSTRAINT "DesignSessionTranscript_sessionId_source_sourceId_key"
  UNIQUE ("sessionId","source","sourceId");

ALTER TABLE public."DesignSessionTranscript"
  ALTER COLUMN "source" DROP DEFAULT;

COMMIT;
