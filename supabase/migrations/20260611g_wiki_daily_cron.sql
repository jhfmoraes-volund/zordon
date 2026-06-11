-- Cron diário da Wiki (runbook drive-context-wiki-pipeline D12).
-- pg_cron (06:00 UTC = 03:00 BRT) → kick_wiki_daily() → net.http_post pra
-- rota Next /api/cron/wiki-daily autenticada por x-cron-secret.
-- Vault-driven (padrão granola, 20260521_granola_auto_import.sql §5):
--   wiki_daily_url          = https://<app>/api/cron/wiki-daily
--   wiki_daily_cron_secret  = shared secret matching env CRON_SECRET
-- Secrets são seedados manualmente via psql (nunca em migration commitada).

BEGIN;

-- ─── 1. Kick via pg_net + Vault ─────────────────────────────────────────────
--
-- Failures are swallowed: o cron nunca trava num soluço de transporte — o
-- próximo tick (ou curl manual com o secret) cobre.

CREATE OR REPLACE FUNCTION public.kick_wiki_daily()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'wiki_daily_url';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'wiki_daily_cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    -- Local/CI sem secrets seedados: rota manual com o secret cobre.
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    -- Refresh + compose de N projetos leva minutos; o post é fire-and-forget
    -- do ponto de vista do cron, timeout generoso só pro handshake.
    timeout_milliseconds := 10000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'kick_wiki_daily failed: %', SQLERRM;
END $$;

-- ─── 2. Schedule (diário 06:00 UTC = 03:00 BRT) ─────────────────────────────
--
-- Idempotente: unschedule por nome antes de recriar (padrão alpha-insights).

DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'wiki-daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'wiki-daily',
    '0 6 * * *',
    $cmd$ SELECT public.kick_wiki_daily(); $cmd$
  );
END $$;

-- ─── 3. Lock down EXECUTE ───────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.kick_wiki_daily() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kick_wiki_daily() TO service_role;

COMMIT;
