-- ─── Super Planning Session ──────────────────────────────

CREATE TABLE public."SuperPlanningSession" (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sprintId"      TEXT NOT NULL REFERENCES public."Sprint"(id) ON DELETE CASCADE,

  -- Roam metadata
  "roamMeetingId"    TEXT NOT NULL,
  "roamMeetingTitle" TEXT,
  "roamMeetingDate"  TIMESTAMPTZ,
  "matchScore"       DOUBLE PRECISION,
  "matchMethod"      TEXT,  -- manual | auto_confirmed | auto_webhook

  -- Processing
  transcript      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, completed, partial_failure, failed

  -- Results
  "actionsPlanned"  JSONB,
  "actionsApplied"  JSONB,
  "actionsFailed"   JSONB,
  "actionsSummary"  TEXT,

  -- Metrics
  "tasksCreated"    INT NOT NULL DEFAULT 0,
  "tasksMoved"      INT NOT NULL DEFAULT 0,
  "tasksAssigned"   INT NOT NULL DEFAULT 0,
  "totalFpAdded"    INT NOT NULL DEFAULT 0,

  -- AI cost tracking
  "aiModel"         TEXT,
  "aiInputTokens"   INT NOT NULL DEFAULT 0,
  "aiOutputTokens"  INT NOT NULL DEFAULT 0,

  -- Error handling
  "errorLog"        TEXT,

  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "completedAt"     TIMESTAMPTZ,
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_super_planning_sprint ON public."SuperPlanningSession"("sprintId");
CREATE INDEX idx_super_planning_status ON public."SuperPlanningSession"(status);

-- RLS
ALTER TABLE public."SuperPlanningSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_select" ON public."SuperPlanningSession" FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON public."SuperPlanningSession" FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON public."SuperPlanningSession" FOR UPDATE TO authenticated USING (true);
CREATE POLICY "authenticated_delete" ON public."SuperPlanningSession" FOR DELETE TO authenticated USING (true);
