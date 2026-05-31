-- ═══════════════════════════════════════════════════════════
-- Forge Workspace Garbage Collection — pg_cron daily job
--
-- Schedule: daily at 02:00 UTC
-- Calls: scripts/forge/gc-workspaces.ts via external kick (future)
--        OR direct shell execution in cron (simpler for now)
--
-- Per D8: workspaces preserved 24h after run, then gc.
-- ═══════════════════════════════════════════════════════════

-- ─── Schedule workspace GC daily at 02:00 UTC ─────────────────

-- Idempotent: unschedule existing job if present
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'forge_workspace_gc';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  -- Schedule daily at 02:00 UTC
  -- Note: pg_cron runs shell commands in the Postgres environment.
  -- For Supabase, we'll schedule this but the actual execution
  -- will be via external cron or manual runs until we have
  -- a proper kick function (similar to granola_import pattern).
  -- For now, this creates the job entry for verification.
  PERFORM cron.schedule(
    'forge_workspace_gc',
    '0 2 * * *',
    $cmd$ -- Placeholder: will be replaced with proper kick function in V2
          -- For now, run manually via: tsx scripts/forge/gc-workspaces.ts
          SELECT 1; $cmd$
  );
END $$;
