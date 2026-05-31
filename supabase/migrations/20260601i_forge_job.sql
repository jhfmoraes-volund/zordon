-- Forge Job — async job queue for daemon-based PRD execution

BEGIN;

-- ─── 1. ForgeJob (daemon job queue) ──────────────────────────────────────────
--
-- Status flow: queued → claimed → running → done | failed | cancelled
-- Daemon picks queued rows (FOR UPDATE SKIP LOCKED), claims, and executes.
-- Heartbeat mechanism detects orphaned jobs (see orphan recovery migration).

CREATE TABLE IF NOT EXISTS public."ForgeJob" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "prdSlug"                text NOT NULL,
  "projectId"              uuid REFERENCES public."Project"(id) ON DELETE SET NULL,
  "ownerId"                uuid NOT NULL REFERENCES public."Member"(id) ON DELETE RESTRICT,
  status                   text NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued','claimed','running','done','failed','cancelled')),
  "claimedBy"              uuid,                          -- daemonId that claimed this job
  "claimedAt"              timestamptz,
  "heartbeatAt"            timestamptz,
  "runId"                  uuid REFERENCES public."ForgeRun"(id) ON DELETE SET NULL,
  "assignToAnyone"         boolean NOT NULL DEFAULT false,
  "maxStories"             integer DEFAULT 20,
  meta                     jsonb NOT NULL DEFAULT '{}',
  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedAt"              timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. Indexes ───────────────────────────────────────────────────────────────

-- Partial index for queue drain (daemon picks oldest queued/claimed/running jobs)
CREATE INDEX IF NOT EXISTS "ForgeJob_queue_idx"
  ON public."ForgeJob" (status, "createdAt")
  WHERE status IN ('queued','claimed','running');

-- Owner index for filtering jobs by owner
CREATE INDEX IF NOT EXISTS "ForgeJob_owner_idx"
  ON public."ForgeJob" ("ownerId", "createdAt" DESC);

-- Heartbeat index for orphan recovery (finds stale running jobs)
CREATE INDEX IF NOT EXISTS "ForgeJob_heartbeat_idx"
  ON public."ForgeJob" ("heartbeatAt")
  WHERE status = 'running';

-- ─── 3. RLS ───────────────────────────────────────────────────────────────────
--
-- Select: admin OR owner OR assignToAnyone=true
-- Insert: manager OR admin
-- Update: admin OR unclaimed job OR daemon that claimed it

ALTER TABLE public."ForgeJob" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_select" ON public."ForgeJob";
CREATE POLICY "job_select" ON public."ForgeJob"
  FOR SELECT TO authenticated
  USING (
    public.is_admin() OR
    "ownerId" = (SELECT id FROM public."Member" WHERE "userId" = auth.uid()) OR
    "assignToAnyone" = true
  );

DROP POLICY IF EXISTS "job_insert" ON public."ForgeJob";
CREATE POLICY "job_insert" ON public."ForgeJob"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_manager() OR public.is_admin()
  );

DROP POLICY IF EXISTS "job_update" ON public."ForgeJob";
CREATE POLICY "job_update" ON public."ForgeJob"
  FOR UPDATE TO authenticated
  USING (
    public.is_admin() OR
    "claimedBy" IS NULL OR
    "claimedBy" = current_setting('app.daemon_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE ON public."ForgeJob" TO authenticated;

COMMIT;
