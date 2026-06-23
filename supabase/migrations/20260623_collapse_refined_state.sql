-- Collapse UserStory.refinementStatus from 3 states (draft/refined/committed)
-- to 2 (draft/committed).
--
-- Rationale: 'refined' meant "detailed but not locked" — semantically identical
-- to the new 'draft' (work-in-progress, still editable). Mapping to 'draft'
-- (not 'committed') keeps stories consistent with their tasks, which were NOT
-- promoted to backlog (that only happens on DS complete / explicit commit).

BEGIN;

-- 1. Backfill: every 'refined' story becomes 'draft'.
UPDATE public."UserStory"
SET "refinementStatus" = 'draft', "updatedAt" = now()
WHERE "refinementStatus" = 'refined';

-- 2. Replace the inline (auto-named) CHECK constraint with a named 2-state one.
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'public."UserStory"'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%refinementStatus%';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public."UserStory" DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE public."UserStory"
  ADD CONSTRAINT "user_story_refinement_status_check"
  CHECK ("refinementStatus" IN ('draft','committed'));

COMMIT;
