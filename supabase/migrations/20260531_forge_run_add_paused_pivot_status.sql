-- ============================================================================
-- ForgeRun: add 'paused-pivot' status for pivot detection (FE-004)
--
-- Expands the status CHECK constraint to include 'paused-pivot', which is set
-- when the orchestrator detects 2 consecutive task failures (Decision D21).
-- ============================================================================

BEGIN;

-- Drop existing constraint and recreate with new status
ALTER TABLE "ForgeRun"
  DROP CONSTRAINT IF EXISTS "ForgeRun_status_check";

ALTER TABLE "ForgeRun"
  ADD CONSTRAINT "ForgeRun_status_check"
  CHECK (status IN ('queued','running','done','error','aborted','paused-pivot'));

COMMIT;
