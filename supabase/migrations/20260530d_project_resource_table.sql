-- Migration: ProjectResource table
-- Wiki v2 - Manual Resources (links, repos, sponsors, docs)

-- Helper function for edit permission (reuses pattern from can_edit_tasks)
CREATE OR REPLACE FUNCTION can_edit_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectAccess"
    WHERE "userId" = auth.uid()
      AND "projectId" = p_project_id
      AND role IN ('contributor','lead')
  )
$$;

CREATE TABLE "ProjectResource" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('link','repo','sponsor','doc')),
  title       text NOT NULL,
  url         text,
  notes       text,
  "order"     int  NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_project_resource_project ON "ProjectResource"("projectId", "order");

ALTER TABLE "ProjectResource" ENABLE ROW LEVEL SECURITY;

CREATE POLICY pr_select ON "ProjectResource" FOR SELECT
  USING (can_view_project("projectId"));

CREATE POLICY pr_modify ON "ProjectResource" FOR ALL
  USING (can_edit_project("projectId"))
  WITH CHECK (can_edit_project("projectId"));
