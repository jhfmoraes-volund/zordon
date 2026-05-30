-- 20260601a_planning_session.sql
-- PlanningSession: MVP cascata de Vitoria (PRDs → sprints + tasks)
-- § prd-planning-session.md §7 Migration 1

BEGIN;

-- Enable btree_gist extension for EXCLUDE constraint on uuid
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS "PlanningSession" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'orchestrating', 'in-review', 'approved', 'aborted', 'error'
  )),
  title text NOT NULL,
  "facilitatorId" uuid REFERENCES "Member"(id),
  "sprintCount" int NOT NULL DEFAULT 6 CHECK ("sprintCount" >= 1 AND "sprintCount" <= 12),
  "codebaseIndexSha" text,
  "prdIndexSha" text,
  "draftRoadmapJsonb" jsonb,
  "agentOutputsJsonb" jsonb,
  "orchestrateJobId" uuid,
  "tokensUsed" int NOT NULL DEFAULT 0,
  "costUsd" numeric(10,4) NOT NULL DEFAULT 0,
  "errorMessage" text,
  "approvedAt" timestamptz,
  "approvedBy" uuid REFERENCES "Member"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_active_planning_per_project EXCLUDE USING gist (
    "projectId" WITH =,
    status WITH <>
  ) WHERE (status IN ('draft', 'orchestrating', 'in-review'))
);

CREATE INDEX IF NOT EXISTS idx_planning_session_project
  ON "PlanningSession"("projectId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_planning_session_status
  ON "PlanningSession"("projectId", status)
  WHERE status IN ('approved', 'in-review');

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE "PlanningSession" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planning_session_read ON "PlanningSession";
CREATE POLICY planning_session_read ON "PlanningSession"
  FOR SELECT
  USING (can_view_project("projectId"));

DROP POLICY IF EXISTS planning_session_insert ON "PlanningSession";
CREATE POLICY planning_session_insert ON "PlanningSession"
  FOR INSERT
  WITH CHECK (can_edit_project("projectId"));

DROP POLICY IF EXISTS planning_session_update ON "PlanningSession";
CREATE POLICY planning_session_update ON "PlanningSession"
  FOR UPDATE
  USING (can_edit_project("projectId"));

-- ============================================================
-- Trigger updatedAt
-- ============================================================
CREATE OR REPLACE FUNCTION public.planning_session_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS planning_session_set_updated_at_trg ON "PlanningSession";
CREATE TRIGGER planning_session_set_updated_at_trg
  BEFORE UPDATE ON "PlanningSession"
  FOR EACH ROW
  EXECUTE FUNCTION public.planning_session_set_updated_at();

COMMIT;
