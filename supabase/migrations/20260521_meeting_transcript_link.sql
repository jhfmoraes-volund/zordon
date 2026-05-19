-- ═══════════════════════════════════════════════════════════
-- Meeting — persist the external transcript source/id used to ingest it.
--
-- Today, the link to a Roam transcript or Granola note only lives in the
-- ephemeral Alpha kickoff (buildIngestSeed). After import, the Meeting row
-- has no idea where the transcript came from, so any later "re-read the
-- transcript" feature has to ask the user to pick the source again.
--
-- We add two nullable columns mirroring the shape used by
-- DesignSessionTranscript:
--   - transcriptSource  text  CHECK IN ('roam','granola')
--   - transcriptSourceId text
--
-- Nullable because Meetings created manually (without an import) have no
-- transcript. CHECK is conditional on transcriptSource being set.
-- The pair (transcriptSource, transcriptSourceId) is UNIQUE when present
-- so the same external transcript can't be linked to two Meeting rows.
-- ═══════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public."Meeting"
  ADD COLUMN "transcriptSource" text
    CHECK ("transcriptSource" IS NULL OR "transcriptSource" IN ('roam','granola'));

ALTER TABLE public."Meeting"
  ADD COLUMN "transcriptSourceId" text;

-- Both set or both null; no half-states.
ALTER TABLE public."Meeting"
  ADD CONSTRAINT "Meeting_transcript_pair_ck"
  CHECK (
    ("transcriptSource" IS NULL AND "transcriptSourceId" IS NULL)
    OR
    ("transcriptSource" IS NOT NULL AND "transcriptSourceId" IS NOT NULL)
  );

-- A given external transcript belongs to at most one Meeting row.
CREATE UNIQUE INDEX "Meeting_transcriptSource_sourceId_key"
  ON public."Meeting" ("transcriptSource", "transcriptSourceId")
  WHERE "transcriptSource" IS NOT NULL;

COMMIT;
