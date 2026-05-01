-- Drop unused feature flag.
--
-- Context: `Project.useStoryHierarchy` was introduced in
-- 20260430_project_reference_key_and_dod.sql to gate the new UI per project.
-- During Wave 5 of the migration, the rollout went all-in (every project
-- shows the new UI directly), so the flag was never wired into the frontend
-- as a conditional. The column is deadweight — drop it.
--
-- Touch points cleaned up alongside this migration:
--   - src/app/(dashboard)/projects/[id]/page.tsx (type + SELECT + assign)
--   - src/lib/dal/story-hierarchy.ts (setProjectUseStoryHierarchy helper)
--   - regen of src/lib/supabase/database.types.ts

DROP INDEX IF EXISTS "project_use_story_hierarchy_idx";

ALTER TABLE "Project"
  DROP COLUMN IF EXISTS "useStoryHierarchy";
