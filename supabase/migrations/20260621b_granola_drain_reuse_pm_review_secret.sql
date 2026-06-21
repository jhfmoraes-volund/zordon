-- Granola import drain — reusa o secret do PM Review em vez de um próprio.
--
-- Contexto (2026-06-21): o cron de import do Granola precisa autenticar no
-- endpoint /api/cron/run-granola-import. Em vez de provisionar um 2º par
-- env+Vault (GRANOLA_IMPORT_AUTH_TOKEN — que nunca foi setado no Cloud Run),
-- reusamos PM_REVIEW_REFRESH_AUTH_TOKEN, que JÁ está provisionado em prod
-- (env + Vault como pm_review_refresh_auth_token). O import do Granola alimenta
-- o PM Review — mesmo domínio de automação da Vitoria — então um único secret
-- de cron basta. A rota e o "Varrer agora" passaram a checar
-- PM_REVIEW_REFRESH_AUTH_TOKEN (no env); aqui o kick passa a ler o token do
-- Vault de pm_review_refresh_auth_token. A URL continua específica do endpoint
-- (granola_import_url), pois é outro path.

BEGIN;

CREATE OR REPLACE FUNCTION public.kick_granola_import_drain()
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
    FROM vault.decrypted_secrets WHERE name = 'granola_import_url';
  -- Token compartilhado com o cron do PM Review (mesmo valor do env
  -- PM_REVIEW_REFRESH_AUTH_TOKEN que a rota checa).
  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets WHERE name = 'pm_review_refresh_auth_token';

  IF v_url IS NULL OR v_token IS NULL THEN
    -- Sem secrets seedados: enqueue já aconteceu; o reaper limpa o pending e a
    -- rota manual com Bearer cobre. No-op silencioso (igual local/CI).
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
  RAISE WARNING 'kick_granola_import_drain failed: %', SQLERRM;
END $$;

-- Limpa o secret que eu havia seedado e que agora não é mais lido (reuso do
-- pm_review_refresh_auth_token). granola_import_url permanece (a URL é própria).
DELETE FROM vault.secrets WHERE name = 'granola_import_auth_token';

COMMIT;
