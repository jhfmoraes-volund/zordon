-- Alpha Client Insights
--
-- Mirrors ProjectInsight at the *client* scope. The client page is where
-- ops/managers want a synthesized view across all projects of a client, plus
-- per-project drill-down chips. We keep ProjectInsight intact (drill-down
-- reuses it as-is) and add a new ClientInsight table for the aggregate.
--
-- InsightJob is widened: a single queue serves both project and client jobs,
-- driven by `kind`. The cron route in /api/cron/run-alpha-insights branches
-- on kind to call the right runner.
--
-- RLS: ClientInsight is manager-only. Per-client ProjectAccess does not exist
-- in our access model — clients are an ops-level concept — so any contributor
-- with project access can still see the per-project drill-down (ProjectInsight
-- policy stays), but only managers see the aggregate.

BEGIN;

-- ─── 1. ClientInsight ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public."ClientInsight" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId"               uuid NOT NULL REFERENCES public."Client"(id) ON DELETE CASCADE,

  "generatedAt"            timestamptz NOT NULL DEFAULT now(),
  "generatedBy"            text NOT NULL CHECK ("generatedBy" IN ('cron','manual')),
  "triggeredByMemberId"    uuid REFERENCES public."Member"(id) ON DELETE SET NULL,

  -- Relational block (across all projects with this client)
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
  "inputProjectsCount"     int NOT NULL DEFAULT 0,
  "inputMeetingsCount"     int NOT NULL DEFAULT 0,
  "costUsdCents"           int NOT NULL DEFAULT 0,

  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedAt"              timestamptz NOT NULL DEFAULT now(),

  UNIQUE ("clientId")
);

CREATE INDEX IF NOT EXISTS "ClientInsight_generatedAt_idx"
  ON public."ClientInsight" ("generatedAt" DESC);

-- updatedAt trigger
CREATE OR REPLACE FUNCTION public.touch_client_insight_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS client_insight_touch_updated_at ON public."ClientInsight";
CREATE TRIGGER client_insight_touch_updated_at
  BEFORE UPDATE ON public."ClientInsight"
  FOR EACH ROW EXECUTE FUNCTION public.touch_client_insight_updated_at();

-- ─── 2. Widen InsightJob to carry both scopes ────────────────────────────

ALTER TABLE public."InsightJob"
  ADD COLUMN IF NOT EXISTS "clientId" uuid REFERENCES public."Client"(id) ON DELETE CASCADE;

ALTER TABLE public."InsightJob"
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'project'
    CHECK (kind IN ('project','client'));

-- projectId is no longer mandatory (client jobs leave it null). Drop the NOT
-- NULL safely — there is no production data to backfill yet for client kind.
ALTER TABLE public."InsightJob"
  ALTER COLUMN "projectId" DROP NOT NULL;

-- XOR: exactly one of projectId/clientId based on kind.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'insightjob_kind_target_xor'
  ) THEN
    ALTER TABLE public."InsightJob"
      ADD CONSTRAINT insightjob_kind_target_xor CHECK (
        (kind = 'project' AND "projectId" IS NOT NULL AND "clientId" IS NULL)
        OR
        (kind = 'client' AND "clientId" IS NOT NULL AND "projectId" IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "InsightJob_clientId_createdAt_idx"
  ON public."InsightJob" ("clientId", "createdAt" DESC)
  WHERE "clientId" IS NOT NULL;

-- ─── 3. RLS: ClientInsight (manager-only) ────────────────────────────────

ALTER TABLE public."ClientInsight" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manager_select" ON public."ClientInsight";
CREATE POLICY "manager_select" ON public."ClientInsight"
  FOR SELECT TO authenticated
  USING (public.is_manager());

GRANT SELECT ON public."ClientInsight" TO authenticated;

-- ─── 4. Enqueue + batch (now covers both scopes) ─────────────────────────

CREATE OR REPLACE FUNCTION public.enqueue_client_insight_jobs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  -- One job per client that has at least one active project, skipping clients
  -- with a pending/running client-kind job already in flight.
  INSERT INTO public."InsightJob" ("clientId", kind, source)
  SELECT DISTINCT c.id, 'client', 'cron'
  FROM public."Client" c
  JOIN public."Project" p ON p."clientId" = c.id
  WHERE p.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public."InsightJob" j
      WHERE j."clientId" = c.id
        AND j.kind = 'client'
        AND j.status IN ('pending','running')
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Extend the cron batch: enqueue projects AND clients, kick the drain once.
CREATE OR REPLACE FUNCTION public.run_project_insight_batch()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_project int;
  n_client  int;
  total     int;
BEGIN
  n_project := public.enqueue_project_insight_jobs();
  n_client  := public.enqueue_client_insight_jobs();
  total     := n_project + n_client;
  IF total > 0 THEN
    PERFORM public.kick_project_insight_drain();
  END IF;
  RETURN total;
END $$;

COMMIT;
