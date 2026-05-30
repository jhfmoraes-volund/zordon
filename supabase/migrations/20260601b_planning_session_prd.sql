-- 20260601b_planning_session_prd.sql
-- PlanningSessionPRD: M:N PRD-Sprint com ordenação e overrides do owner
-- § prd-planning-session.md §7 Migration 2

BEGIN;

CREATE TABLE IF NOT EXISTS "PlanningSessionPRD" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planningSessionId" uuid NOT NULL REFERENCES "PlanningSession"(id) ON DELETE CASCADE,
  "prdSlug" text NOT NULL,
  "sprintStart" int NOT NULL CHECK ("sprintStart" >= 1 AND "sprintStart" <= 12),
  "sprintCount" int NOT NULL DEFAULT 1 CHECK ("sprintCount" >= 1 AND "sprintCount" <= 6),
  "order" int NOT NULL,
  "assignedSquadId" uuid REFERENCES "Squad"(id),
  "agentJustification" text,
  "ownerOverride" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("planningSessionId", "prdSlug"),
  UNIQUE ("planningSessionId", "sprintStart", "order")
);

CREATE INDEX IF NOT EXISTS idx_planning_session_prd_session
  ON "PlanningSessionPRD"("planningSessionId", "sprintStart", "order");

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE "PlanningSessionPRD" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planning_session_prd_read ON "PlanningSessionPRD";
CREATE POLICY planning_session_prd_read ON "PlanningSessionPRD"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "PlanningSession" s
    WHERE s.id = "PlanningSessionPRD"."planningSessionId"
      AND can_view_project(s."projectId")
  ));

DROP POLICY IF EXISTS planning_session_prd_write ON "PlanningSessionPRD";
CREATE POLICY planning_session_prd_write ON "PlanningSessionPRD"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "PlanningSession" s
    WHERE s.id = "PlanningSessionPRD"."planningSessionId"
      AND can_edit_project(s."projectId")
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "PlanningSession" s
    WHERE s.id = "PlanningSessionPRD"."planningSessionId"
      AND can_edit_project(s."projectId")
  ));

COMMIT;
