-- PRD Quick-Ask Job — async job queue for generating PRDs from brief

BEGIN;

-- ─── 1. PrdQuickAskJob (job queue) ──────────────────────────────────────────
--
-- Status flow: queued → running → done | failed. Worker picks queued
-- rows (FOR UPDATE SKIP LOCKED) and drives them through.

CREATE TABLE IF NOT EXISTS public."PrdQuickAskJob" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId"              uuid NOT NULL REFERENCES public."DesignSession"(id) ON DELETE CASCADE,
  "projectId"              uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  brief                    text NOT NULL,
  status                   text NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued','running','done','failed')),
  "triggeredByMemberId"    uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "startedAt"              timestamptz,
  "finishedAt"             timestamptz,
  error                    text,
  "prdCount"               int,
  "createdAt"              timestamptz NOT NULL DEFAULT now()
);

-- Partial index for the drain query ("give me the oldest queued job").
CREATE INDEX IF NOT EXISTS "PrdQuickAskJob_queued_idx"
  ON public."PrdQuickAskJob" (status, "createdAt")
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS "PrdQuickAskJob_sessionId_idx"
  ON public."PrdQuickAskJob" ("sessionId");

-- ─── 2. RLS ──────────────────────────────────────────────────────────────────
--
-- Read: manager OR project contributor/lead
-- Write: none for authenticated users — API route uses service role

ALTER TABLE public."PrdQuickAskJob" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_member_select" ON public."PrdQuickAskJob";
CREATE POLICY "project_member_select" ON public."PrdQuickAskJob"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_edit_tasks("projectId"));

GRANT SELECT ON public."PrdQuickAskJob" TO authenticated;

COMMIT;
