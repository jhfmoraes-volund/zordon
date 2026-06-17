-- Cron do PM Review folder-aware (runbook pm-review-granola-folder, Fase 2.2).
-- Diário Seg–Sex 08:00 BRT (= 11:00 UTC). Inerte até os secrets serem seedados
-- no Vault (mesma convenção da wiki/granola): sem secret → RETURN, e a rota
-- /api/cron/pm-review-refresh pode ser chamada manualmente com o Bearer token.

BEGIN;

CREATE OR REPLACE FUNCTION public.kick_pm_review_refresh()
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
    FROM vault.decrypted_secrets WHERE name = 'pm_review_refresh_url';
  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets WHERE name = 'pm_review_refresh_auth_token';

  IF v_url IS NULL OR v_token IS NULL THEN
    -- Local/CI sem secrets seedados: rota manual com o Bearer token cobre.
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'kick_pm_review_refresh failed: %', SQLERRM;
END $$;

-- Lockdown: SECURITY DEFINER que lê Vault + dispara HTTP não pode ser chamada
-- por anon/authenticated. Só service_role (= o pg_cron). Espelha wiki/granola.
REVOKE EXECUTE ON FUNCTION public.kick_pm_review_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kick_pm_review_refresh() TO service_role;

-- Agenda idempotente: re-roda a migration sem duplicar o job.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pm-review-refresh') THEN
    PERFORM cron.unschedule('pm-review-refresh');
  END IF;
  PERFORM cron.schedule(
    'pm-review-refresh',
    '0 11 * * 1-5',
    $cmd$ SELECT public.kick_pm_review_refresh(); $cmd$
  );
END $$;

COMMIT;
