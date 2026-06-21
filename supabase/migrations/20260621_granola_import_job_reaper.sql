-- Granola import job reaper — destrava a fila de GranolaImportJob.
--
-- Problema (diagnóstico 2026-06-21): um job preso em 'pending'/'running' trava
-- a fila pra sempre. O enqueue (enqueue_granola_auto_imports) tem guard
-- `NOT EXISTS (pending|running)` e o "Varrer agora" (enqueueManualGranolaImport)
-- é no-op com pending aberto. Sem reaper, um drain que nunca rodou (ex.: secrets
-- de drain ausentes) deixa um pending órfão bloqueando todo import — foi o que
-- aconteceu (zumbi de 20/05 travou ~1 mês). Espelha forge_recover_orphan_jobs.
--
-- Estratégia: falha (não re-enfileira) jobs presos —
--   • running  > 15min  → o drain (maxDuration 300s) morreu no meio.
--   • pending  > 2h      → nenhum drain o pegou (cron horário + manual deveriam
--                          drenar em minutos); 2h = preso.
-- O cursor do member NÃO avança em job falho (advanceMemberCursor só roda em
-- job ok), então o próximo ciclo re-enfileira e re-escaneia a mesma janela —
-- idempotente por (source, sourceId), sem perda de notas.

BEGIN;

-- ─── 1. Reaper ──────────────────────────────────────────────────────────────

-- Separa running×pending pra sinalizar diferente: running reaped = NOTICE
-- (rotina; o drain morreu no meio); pending reaped = WARNING (alertável: um
-- pending estourando 2h significa que o drain NÃO está drenando — env/secrets
-- ausentes?). "createdAt" tem DEFAULT now() (sempre não-NULL), então o
-- COALESCE("startedAt","createdAt") nunca dá NULL nem comparação three-valued.
CREATE OR REPLACE FUNCTION public.reap_stale_granola_jobs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n_run int; n_pend int;
BEGIN
  -- running > 15min: a invocação do drain (maxDuration 300s na rota) morreu no
  -- meio (3× de margem sobre os 300s → nunca falha um job legitimamente vivo).
  UPDATE public."GranolaImportJob"
  SET status       = 'failed',
      "finishedAt" = now(),
      error        = COALESCE(NULLIF(error, ''), '') ||
                     CASE WHEN COALESCE(error,'') <> '' THEN E'\n' ELSE '' END ||
                     'reaped: running > 15min (drain morreu)'
  WHERE status = 'running'
    AND COALESCE("startedAt", "createdAt") < now() - interval '15 minutes';
  GET DIAGNOSTICS n_run = ROW_COUNT;
  IF n_run > 0 THEN
    RAISE NOTICE 'reap_stale_granola_jobs: % running job(s) reaped', n_run;
  END IF;

  -- pending > 2h: nenhum drain pegou (cron horário + manual deveriam drenar em
  -- minutos). Pending estourando = drain quebrado → alertável.
  UPDATE public."GranolaImportJob"
  SET status       = 'failed',
      "finishedAt" = now(),
      error        = COALESCE(NULLIF(error, ''), '') ||
                     CASE WHEN COALESCE(error,'') <> '' THEN E'\n' ELSE '' END ||
                     'reaped: pending > 2h (drain nunca pegou)'
  WHERE status = 'pending'
    AND "createdAt" < now() - interval '2 hours';
  GET DIAGNOSTICS n_pend = ROW_COUNT;
  IF n_pend > 0 THEN
    RAISE WARNING 'reap_stale_granola_jobs: % pending job(s) reaped — o drain não está drenando (cheque GRANOLA_IMPORT_AUTH_TOKEN no env + secrets no Vault)', n_pend;
  END IF;

  RETURN n_run + n_pend;
END $$;

-- ─── 2. Reaper roda ANTES do enqueue no batch horário ───────────────────────
-- Auto-cura: se a fila travou desde o último ciclo, o reaper limpa e o enqueue
-- logo abaixo já consegue criar o job novo (o guard NOT EXISTS volta a passar).

CREATE OR REPLACE FUNCTION public.run_granola_auto_import_batch()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  PERFORM public.reap_stale_granola_jobs();
  n := public.enqueue_granola_auto_imports();
  IF n > 0 THEN
    PERFORM public.kick_granola_import_drain();
  END IF;
  RETURN n;
END $$;

-- ─── 3. Lockdown (espelha as demais funções do 20260521) ────────────────────

REVOKE EXECUTE ON FUNCTION public.reap_stale_granola_jobs()      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reap_stale_granola_jobs()      TO service_role;

COMMIT;
