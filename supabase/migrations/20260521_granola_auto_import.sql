-- Granola auto-import (hourly cron)
--
-- Each member can opt-in to "scan my Granola every 1h and ingest new meetings
-- automatically as PRIVATE meetings". Mirrors the alpha-insights pipeline:
--
--   pg_cron (hourly)
--     └─→ run_granola_auto_import_batch()
--           ├─→ enqueue_granola_auto_imports()  (1 job per opted-in member,
--           │                                    skipping members with a
--           │                                    pending/running job)
--           └─→ kick_granola_import_drain()     (Vault → net.http_post →
--                                                /api/cron/run-granola-import)
--
-- Drain route is headless: each job claims, calls runAgent (alpha) once per
-- new Granola note, persists Meeting+Todos via Alpha's tools, advances the
-- per-member cursor, then marks the job done.
--
-- Vault entries expected (seed manually per environment, same pattern as
-- alpha-insights). The drain kick is a silent no-op when secrets are missing,
-- so local/CI keeps working without setup:
--   granola_import_url         e.g. https://volund.app/api/cron/run-granola-import
--   granola_import_auth_token  shared secret matching env GRANOLA_IMPORT_AUTH_TOKEN
--
-- Rollback: DROP TABLE "GranolaImportJob"; DROP COLUMNs autoImport* from
-- MemberIntegration; cron.unschedule('granola_auto_import_hourly'); drop the
-- three functions defined here.

BEGIN;

-- ─── 1. MemberIntegration: opt-in flag + cursor ────────────────────────────
--
-- autoImportEnabled       – the toggle
-- autoImportCursor        – next scan starts here (set to now() when toggle
--                           flips on, so backlog isn't imported by surprise)
-- autoImportLastRunAt     – last time a job finished (any status)
--
-- All three are no-ops for non-Granola providers — the columns are scoped to
-- the (memberId, provider) row, so Roam rows just keep them NULL.

ALTER TABLE public."MemberIntegration"
  ADD COLUMN IF NOT EXISTS "autoImportEnabled"   boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "autoImportCursor"    timestamptz,
  ADD COLUMN IF NOT EXISTS "autoImportLastRunAt" timestamptz;

-- ─── 2. GranolaImportJob (work queue, mirrors InsightJob) ──────────────────

CREATE TABLE IF NOT EXISTS public."GranolaImportJob" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "memberId"          uuid NOT NULL REFERENCES public."Member"(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','done','failed')),
  source              text NOT NULL CHECK (source IN ('cron','manual')),
  -- Window the job will/did scan. cursorFrom is captured at claim-time from
  -- MemberIntegration.autoImportCursor; cursorTo is set to the newest note
  -- created_at the job actually processed (used to advance the cursor).
  "cursorFrom"        timestamptz,
  "cursorTo"          timestamptz,
  "notesScanned"      int NOT NULL DEFAULT 0,
  "meetingsCreated"   int NOT NULL DEFAULT 0,
  "meetingsSkipped"   int NOT NULL DEFAULT 0,
  "startedAt"         timestamptz,
  "finishedAt"        timestamptz,
  error               text,
  "createdAt"         timestamptz NOT NULL DEFAULT now()
);

-- Drain query: oldest pending. Partial index keeps it tight as done/failed
-- rows accumulate.
CREATE INDEX IF NOT EXISTS "GranolaImportJob_pending_idx"
  ON public."GranolaImportJob" (status, "createdAt")
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS "GranolaImportJob_memberId_createdAt_idx"
  ON public."GranolaImportJob" ("memberId", "createdAt" DESC);

-- ─── 3. RLS ────────────────────────────────────────────────────────────────
--
-- Job rows are member-owned: a member sees only their own job history (UI
-- shows "last run / N meetings created"). Writes happen via service_role
-- (cron route + run-now endpoint), so no INSERT/UPDATE/DELETE policies for
-- authenticated.

ALTER TABLE public."GranolaImportJob" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_select" ON public."GranolaImportJob";
CREATE POLICY "owner_select" ON public."GranolaImportJob"
  FOR SELECT TO authenticated
  USING ("memberId" = public.get_my_member_id());

GRANT SELECT ON public."GranolaImportJob" TO authenticated;

-- ─── 4. Enqueue function ───────────────────────────────────────────────────
--
-- Inserts one pending job per opted-in Granola member, skipping anyone who
-- already has a pending/running job (keeps the queue idempotent across cron
-- ticks). Returns the number of jobs inserted.

CREATE OR REPLACE FUNCTION public.enqueue_granola_auto_imports()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  INSERT INTO public."GranolaImportJob" ("memberId", source, "cursorFrom")
  SELECT mi."memberId", 'cron', mi."autoImportCursor"
  FROM public."MemberIntegration" mi
  WHERE mi.provider = 'granola'
    AND mi."autoImportEnabled" = true
    AND NOT EXISTS (
      SELECT 1 FROM public."GranolaImportJob" j
      WHERE j."memberId" = mi."memberId"
        AND j.status IN ('pending','running')
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ─── 5. Drain kick via pg_net + Vault ──────────────────────────────────────
--
-- Pings the Next.js route so the queue drains immediately instead of waiting
-- for the next external trigger. Vault-driven (URL + bearer token) so we can
-- repoint per environment without code changes. Failures are swallowed: the
-- cron should never block on a transport hiccup — pending jobs sit and will
-- be picked up by the next tick (or the manual run-now endpoint).

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
  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets WHERE name = 'granola_import_auth_token';

  IF v_url IS NULL OR v_token IS NULL THEN
    -- Local/CI without secrets seeded: enqueue still happened, manual rerun
    -- endpoint or next cron+seeded env will drain it.
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

-- ─── 6. Combined batch (cron entry point) ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.run_granola_auto_import_batch()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  n := public.enqueue_granola_auto_imports();
  IF n > 0 THEN
    PERFORM public.kick_granola_import_drain();
  END IF;
  RETURN n;
END $$;

-- ─── 7. Schedule (hourly at minute 0) ──────────────────────────────────────
--
-- Idempotent: replaces the existing job if a previous version of this
-- migration ran. Re-uses the alpha-insights pattern of looking up the jobid
-- by name and unscheduling before re-creating.

DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'granola_auto_import_hourly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'granola_auto_import_hourly',
    '0 * * * *',
    $cmd$ SELECT public.run_granola_auto_import_batch(); $cmd$
  );
END $$;

-- ─── 8. Lock down EXECUTE on the new functions ─────────────────────────────

REVOKE EXECUTE ON FUNCTION public.enqueue_granola_auto_imports()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.kick_granola_import_drain()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_granola_auto_import_batch()      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enqueue_granola_auto_imports()       TO service_role;
GRANT  EXECUTE ON FUNCTION public.kick_granola_import_drain()          TO service_role;
GRANT  EXECUTE ON FUNCTION public.run_granola_auto_import_batch()      TO service_role;

COMMIT;
