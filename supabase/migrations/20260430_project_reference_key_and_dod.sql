-- Story Hierarchy V2 — Wave 1.1
-- Adiciona referenceKey, definitionOfDone e useStoryHierarchy ao Project.
-- Forward-only. Tudo nullable / com default → código antigo continua funcionando.

ALTER TABLE public."Project"
  ADD COLUMN IF NOT EXISTS "referenceKey"      text,
  ADD COLUMN IF NOT EXISTS "definitionOfDone"  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "useStoryHierarchy" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "project_use_story_hierarchy_idx"
  ON public."Project"("useStoryHierarchy")
  WHERE "useStoryHierarchy" = true;
