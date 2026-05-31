-- ═══════════════════════════════════════════════════════════
-- Forge Job Orphan Recovery — pg_cron job every 2 minutes
--
-- Schedule: every 2 minutes
-- Purpose: Reset jobs with stale heartbeats (>5min) back to queued
--          so other daemons can pick them up.
--
-- Scenario: daemon crashes or network disconnects while running
--           a job. Without orphan recovery, job stays stuck in
--           'claimed' or 'running' forever.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── Recovery function ─────────────────────────────────────

-- Finds jobs in claimed/running with heartbeatAt > 5min stale
-- and resets them to 'queued' status. This allows other daemons
-- to pick them up.
CREATE OR REPLACE FUNCTION public.forge_recover_orphan_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale_threshold timestamptz;
  v_recovered_count int;
BEGIN
  -- 5 minutes ago
  v_stale_threshold := now() - interval '5 minutes';

  -- Reset jobs that are claimed/running but haven't sent heartbeat
  -- in >5min. Also reset jobs that were claimed but never got a heartbeat.
  UPDATE public."ForgeJob"
  SET
    status = 'queued',
    "claimedBy" = NULL,
    "claimedAt" = NULL,
    "heartbeatAt" = NULL,
    "updatedAt" = now()
  WHERE
    status IN ('claimed', 'running')
    AND (
      "heartbeatAt" IS NULL AND "claimedAt" < v_stale_threshold
      OR "heartbeatAt" < v_stale_threshold
    );

  GET DIAGNOSTICS v_recovered_count = ROW_COUNT;

  -- Log recovery events (optional, can be removed if noisy)
  IF v_recovered_count > 0 THEN
    RAISE NOTICE 'forge_recover_orphan_jobs: recovered % stale jobs', v_recovered_count;
  END IF;
END;
$$;

-- ─── Schedule: every 2 minutes ─────────────────────────────

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  -- Idempotent: unschedule existing job if present
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'forge_orphan_recovery';

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  -- Schedule every 2 minutes (*/2 * * * *)
  PERFORM cron.schedule(
    'forge_orphan_recovery',
    '*/2 * * * *',
    $cmd$ SELECT public.forge_recover_orphan_jobs(); $cmd$
  );
END $$;

COMMIT;
