-- Project Insights drain trigger: point at the Next.js API route.
--
-- The initial migration (20260519_project_insights.sql) wired the kick to a
-- Supabase Edge Function. We moved the runtime to a Next.js route — same
-- contract (POST with bearer auth), different URL. This migration updates
-- kick_project_insight_drain() to read URL + token from Vault, matching the
-- pattern in 20260507_telegram_integration.sql.
--
-- Vault entries expected (seed manually per environment):
--   project_insights_url        e.g. https://volund.app/api/cron/run-alpha-insights
--   project_insights_auth_token shared secret matching env INSIGHTS_AUTH_TOKEN

BEGIN;

CREATE OR REPLACE FUNCTION public.kick_project_insight_drain()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url   text;
  v_token text;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'project_insights_url';
  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets WHERE name = 'project_insights_auth_token';

  -- Local/CI envs without the secrets seeded: no-op. The cron still enqueues
  -- jobs; whoever drains the queue (manual rerun route, scheduled task, etc.)
  -- will pick them up.
  IF v_url IS NULL OR v_token IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
EXCEPTION WHEN OTHERS THEN
  -- A drain kick failure should not block the cron — jobs sit in the queue
  -- and will be picked up on the next manual rerun or cron tick.
  RAISE WARNING 'kick_project_insight_drain failed: %', SQLERRM;
END $$;

COMMIT;
