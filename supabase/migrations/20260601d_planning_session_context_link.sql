-- Migration: PlanningSessionContextLink table
-- M:N relationship between PlanningSession and ContextSource
-- RLS inherits via planningSessionId

CREATE TABLE "PlanningSessionContextLink" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planningSessionId" uuid NOT NULL REFERENCES "PlanningSession"(id) ON DELETE CASCADE,
  "contextSourceId" uuid NOT NULL REFERENCES "ContextSource"(id) ON DELETE CASCADE,
  "linkedAt" timestamptz NOT NULL DEFAULT now(),
  "linkedBy" uuid NOT NULL REFERENCES "Member"(id),
  UNIQUE("planningSessionId", "contextSourceId")
);

-- Index for fast lookup by planning session
CREATE INDEX "PlanningSessionContextLink_planningSessionId_idx"
  ON "PlanningSessionContextLink"("planningSessionId");

-- Index for fast lookup by context source
CREATE INDEX "PlanningSessionContextLink_contextSourceId_idx"
  ON "PlanningSessionContextLink"("contextSourceId");

-- Enable RLS
ALTER TABLE "PlanningSessionContextLink" ENABLE ROW LEVEL SECURITY;

-- RLS policies: inherit from PlanningSession's project via can_edit_project
CREATE POLICY "PlanningSessionContextLink SELECT policy"
  ON "PlanningSessionContextLink"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "PlanningSession" ps
      WHERE ps.id = "PlanningSessionContextLink"."planningSessionId"
      AND can_edit_project(ps."projectId")
    )
  );

CREATE POLICY "PlanningSessionContextLink INSERT policy"
  ON "PlanningSessionContextLink"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "PlanningSession" ps
      WHERE ps.id = "PlanningSessionContextLink"."planningSessionId"
      AND can_edit_project(ps."projectId")
    )
  );

CREATE POLICY "PlanningSessionContextLink DELETE policy"
  ON "PlanningSessionContextLink"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "PlanningSession" ps
      WHERE ps.id = "PlanningSessionContextLink"."planningSessionId"
      AND can_edit_project(ps."projectId")
    )
  );
