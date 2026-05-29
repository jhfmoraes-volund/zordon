-- Migration: ProjectWikiSectionSource table
-- Description: Tracking table for wiki section source references (FK to ProjectWikiSection ON DELETE CASCADE)
-- Author: Ralph iteration 3
-- Date: 2026-05-30

CREATE TABLE "ProjectWikiSectionSource" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "wikiSectionId" uuid NOT NULL REFERENCES "ProjectWikiSection"(id) ON DELETE CASCADE,
  "bulletHash"    text NOT NULL,
  "sourceType"    text NOT NULL CHECK ("sourceType" IN
                    ('meeting','design_session','task','sprint','pm_review')),
  "sourceId"      uuid NOT NULL,
  "extractedAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_pwss_section ON "ProjectWikiSectionSource"("wikiSectionId");
CREATE INDEX ix_pwss_source  ON "ProjectWikiSectionSource"("sourceType","sourceId");

ALTER TABLE "ProjectWikiSectionSource" ENABLE ROW LEVEL SECURITY;

CREATE POLICY pwss_select ON "ProjectWikiSectionSource" FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "ProjectWikiSection" s
      WHERE s.id = "wikiSectionId"
        AND can_view_project(s."projectId")
    )
  );

-- INSERT/UPDATE/DELETE: só service role (compose Edge Function).
REVOKE INSERT, UPDATE, DELETE ON "ProjectWikiSectionSource" FROM authenticated;
