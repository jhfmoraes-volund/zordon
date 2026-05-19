-- Alpha Project Insights
--
-- Daily curated read of a project's health, split in two LLM-produced blocks:
--   * Relational  → from meeting transcripts/notes (non-private only)
--   * Technical   → from sprint velocity, allocations, deploy gates, task mix
--
-- Pipeline:
--   pg_cron (07:00 BRT) → enqueue_project_insight_jobs() → InsightJob rows
--                       ↘ then net.http_post → edge function run-alpha-insights
--                                              → calls OpenRouter 2x
--                                              → upserts ProjectInsight
--
-- PRD: docs/prd-alpha-project-insights.md
--
-- Audience: internal (contributor+). Client (viewer/session_participant) does
-- not read these rows. Private meetings never enter the LLM context.

BEGIN;

-- ─── 1. ProjectInsight (latest snapshot per project) ──────────────────────
--
-- v1 keeps only the most recent snapshot per project (UNIQUE on projectId).
-- v1.1 will drop the UNIQUE and turn this into a timeline; the audit columns
-- (generatedAt, modelRelational, modelTechnical) already support that.

CREATE TABLE IF NOT EXISTS public."ProjectInsight" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"              uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,

  "generatedAt"            timestamptz NOT NULL DEFAULT now(),
  "generatedBy"            text NOT NULL CHECK ("generatedBy" IN ('cron','manual')),
  "triggeredByMemberId"    uuid REFERENCES public."Member"(id) ON DELETE SET NULL,

  -- Relational block
  "relationalHealth"       text CHECK ("relationalHealth" IN ('healthy','watch','at_risk','critical')),
  "relationalSummary"      text,
  "relationalSignals"      jsonb NOT NULL DEFAULT '[]'::jsonb,
  "relationalWatch"        jsonb NOT NULL DEFAULT '[]'::jsonb,
  "errorRelational"        text,

  -- Technical block
  "technicalHealth"        text CHECK ("technicalHealth" IN ('healthy','watch','at_risk','critical')),
  "technicalSummary"       text,
  "technicalRisks"         jsonb NOT NULL DEFAULT '[]'::jsonb,
  "technicalWatch"         jsonb NOT NULL DEFAULT '[]'::jsonb,
  "errorTechnical"         text,

  -- Audit
  "modelRelational"        text,
  "modelTechnical"         text,
  "inputMeetingsCount"     int NOT NULL DEFAULT 0,
  "inputSprintId"          uuid REFERENCES public."Sprint"(id) ON DELETE SET NULL,
  "costUsdCents"           int NOT NULL DEFAULT 0,

  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedAt"              timestamptz NOT NULL DEFAULT now(),

  UNIQUE ("projectId")
);

CREATE INDEX IF NOT EXISTS "ProjectInsight_generatedAt_idx"
  ON public."ProjectInsight" ("generatedAt" DESC);

-- ─── 2. InsightJob (simple work queue) ────────────────────────────────────
--
-- Status flow: pending → running → done | failed. Edge function picks pending
-- rows (FOR UPDATE SKIP LOCKED) and drives them through. Idempotency: enqueue
-- skips projects that already have a pending/running job.

CREATE TABLE IF NOT EXISTS public."InsightJob" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"              uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  status                   text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','running','done','failed')),
  source                   text NOT NULL CHECK (source IN ('cron','manual')),
  "triggeredByMemberId"    uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "startedAt"              timestamptz,
  "finishedAt"             timestamptz,
  error                    text,
  "createdAt"              timestamptz NOT NULL DEFAULT now()
);

-- Partial index for the drain query ("give me the oldest pending job").
CREATE INDEX IF NOT EXISTS "InsightJob_pending_idx"
  ON public."InsightJob" (status, "createdAt")
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS "InsightJob_projectId_createdAt_idx"
  ON public."InsightJob" ("projectId", "createdAt" DESC);

-- ─── 3. RLS ───────────────────────────────────────────────────────────────
--
-- ProjectInsight read: manager OR contributor/lead on the project.
-- ProjectInsight write: none for authenticated users — service role only
--                       (edge function uses service key, bypasses RLS).
-- InsightJob: manager only for read; manual reruns go through API route
--             which uses the service key to insert.

ALTER TABLE public."ProjectInsight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."InsightJob"     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manager_or_editor_select" ON public."ProjectInsight";
CREATE POLICY "manager_or_editor_select" ON public."ProjectInsight"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_edit_tasks("projectId"));

-- No INSERT/UPDATE/DELETE policies on ProjectInsight for authenticated:
-- writes happen via service role (edge function) only.

DROP POLICY IF EXISTS "manager_select" ON public."InsightJob";
CREATE POLICY "manager_select" ON public."InsightJob"
  FOR SELECT TO authenticated
  USING (public.is_manager());

GRANT SELECT ON public."ProjectInsight" TO authenticated;
GRANT SELECT ON public."InsightJob"     TO authenticated;

-- ─── 4. updatedAt trigger on ProjectInsight ──────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_project_insight_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_insight_touch_updated_at ON public."ProjectInsight";
CREATE TRIGGER project_insight_touch_updated_at
  BEFORE UPDATE ON public."ProjectInsight"
  FOR EACH ROW EXECUTE FUNCTION public.touch_project_insight_updated_at();

-- ─── 5. Enqueue function ─────────────────────────────────────────────────
--
-- Called by pg_cron once a day. Inserts one pending job per active project
-- that doesn't already have a pending/running one. Returns the number of
-- jobs inserted, so the caller can decide whether to kick the drain.

CREATE OR REPLACE FUNCTION public.enqueue_project_insight_jobs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  INSERT INTO public."InsightJob" ("projectId", source)
  SELECT p.id, 'cron'
  FROM public."Project" p
  WHERE p.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public."InsightJob" j
      WHERE j."projectId" = p.id
        AND j.status IN ('pending','running')
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ─── 6. Drain trigger via pg_net ─────────────────────────────────────────
--
-- After enqueueing, we ping the edge function so it drains immediately
-- instead of waiting for its own internal heartbeat (we don't have one in v1).
--
-- The base URL and service role key are read from Postgres-level config that
-- Supabase sets automatically via `app.settings.supabase_url` and
-- `app.settings.service_role_key`. If those are unavailable (e.g. local), the
-- function is a no-op — the next manual rerun will still work.

CREATE OR REPLACE FUNCTION public.kick_project_insight_drain()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url  text;
  v_key  text;
BEGIN
  -- These settings are populated by Supabase in hosted projects.
  -- See https://supabase.com/docs/guides/database/extensions/pg_net
  BEGIN
    v_url := current_setting('app.settings.supabase_url', true);
    v_key := current_setting('app.settings.service_role_key', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/run-alpha-insights',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
END $$;

-- ─── 7. Combined: enqueue + kick ─────────────────────────────────────────
--
-- One callable for the cron job. Splits responsibility (enqueue is testable
-- standalone, kick is best-effort).

CREATE OR REPLACE FUNCTION public.run_project_insight_batch()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  n := public.enqueue_project_insight_jobs();
  IF n > 0 THEN
    PERFORM public.kick_project_insight_drain();
  END IF;
  RETURN n;
END $$;

-- ─── 8. Schedule ────────────────────────────────────────────────────────
--
-- 07:00 America/Sao_Paulo == 10:00 UTC (BRT is fixed -03:00 since 2019).
-- Replace existing job if any (idempotent migration).

DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'project_insights_daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'project_insights_daily',
    '0 10 * * *',
    $cmd$ SELECT public.run_project_insight_batch(); $cmd$
  );
END $$;

COMMIT;
