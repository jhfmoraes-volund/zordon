-- Migration H: Drop legacy link tables after migration to ContextSource unified system
-- CTXSRC-014
--
-- This migration drops the old transcript/meeting link tables after successful migration
-- to the unified ContextSource system (CTXSRC-001 through CTXSRC-013).
--
-- TranscriptRef table is NOT dropped - it remains as the source of truth for transcript metadata.
-- Only the linking tables (PMReviewTranscriptLink, PMReviewMeetingLink, DesignSessionTranscriptLink)
-- are removed, as their data has been migrated to PMReviewContextLink and DesignSessionContextLink.

-- Drop PM Review legacy link tables
DROP TABLE IF EXISTS "PMReviewTranscriptLink" CASCADE;
DROP TABLE IF EXISTS "PMReviewMeetingLink" CASCADE;

-- Drop Design Session legacy link table
DROP TABLE IF EXISTS "DesignSessionTranscriptLink" CASCADE;

-- Verification query (uncomment to run manually after migration):
-- SELECT
--   to_regclass('public."DesignSessionTranscriptLink"') IS NULL as ds_dropped,
--   to_regclass('public."PMReviewTranscriptLink"') IS NULL as pmr_transcript_dropped,
--   to_regclass('public."PMReviewMeetingLink"') IS NULL as pmr_meeting_dropped,
--   to_regclass('public."TranscriptRef"') IS NOT NULL as transcript_ref_preserved;
