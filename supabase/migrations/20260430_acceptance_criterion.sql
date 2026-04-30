-- Story Hierarchy V2 — Wave 1.5
-- AcceptanceCriterion: critério de aceite, pertence a UserStory OU Task (mutex).
-- Story-level = aceitação de negócio. Task-level = aceitação técnica.

CREATE TABLE IF NOT EXISTS public."AcceptanceCriterion" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userStoryId" text REFERENCES public."UserStory"(id) ON DELETE CASCADE,
  "taskId"      text REFERENCES public."Task"(id) ON DELETE CASCADE,
  text          text NOT NULL,
  "order"       integer NOT NULL DEFAULT 0,
  "checkedAt"   timestamptz,
  "checkedBy"   text REFERENCES public."Member"(id),
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "ac_owner_exclusive" CHECK (
    ("userStoryId" IS NOT NULL AND "taskId" IS NULL) OR
    ("userStoryId" IS NULL AND "taskId" IS NOT NULL)
  ),
  CONSTRAINT "ac_check_consistent" CHECK (
    ("checkedAt" IS NULL  AND "checkedBy" IS NULL) OR
    ("checkedAt" IS NOT NULL AND "checkedBy" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "ac_user_story_idx" ON public."AcceptanceCriterion"("userStoryId") WHERE "userStoryId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ac_task_idx"       ON public."AcceptanceCriterion"("taskId")      WHERE "taskId"      IS NOT NULL;
