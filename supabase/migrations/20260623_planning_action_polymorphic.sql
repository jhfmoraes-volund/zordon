-- Generalize MeetingTaskAction from a task-only staging table into a
-- polymorphic "planning action" staging table that can also stage STORY and
-- MODULE proposals. The lifecycle columns (decision/execution/source/
-- aiReasoning/sourceNoteIds/planningCeremonyId) are already entity-agnostic;
-- we only add a discriminator + nullable FKs and relax the task-only CHECKs.
--
-- entityType='task'   → taskId (existing behavior, untouched)
-- entityType='story'  → storyId (create: null until applied; update: required)
-- entityType='module' → moduleId (approve: null until applied — module is
--                        materialized from payload.proposedName on apply)
--
-- NOTE: UserStory.id and Module.id are `uuid` (PKs converted in the
-- 2026-04-30 UUID migration), so storyId/moduleId are uuid columns.

BEGIN;

-- 1. Discriminator. Default 'task' keeps every existing row valid.
ALTER TABLE public."MeetingTaskAction"
  ADD COLUMN IF NOT EXISTS "entityType" text NOT NULL DEFAULT 'task';

ALTER TABLE public."MeetingTaskAction"
  ADD CONSTRAINT "MeetingTaskAction_entityType_check"
  CHECK ("entityType" IN ('task','story','module'));

-- 2. Polymorphic target FKs (nullable; exactly one is meaningful per row).
ALTER TABLE public."MeetingTaskAction"
  ADD COLUMN IF NOT EXISTS "storyId" uuid
  REFERENCES public."UserStory"(id) ON DELETE CASCADE;

ALTER TABLE public."MeetingTaskAction"
  ADD COLUMN IF NOT EXISTS "moduleId" uuid
  REFERENCES public."Module"(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "meeting_task_action_story_idx"
  ON public."MeetingTaskAction"("storyId") WHERE "storyId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "meeting_task_action_module_idx"
  ON public."MeetingTaskAction"("moduleId") WHERE "moduleId" IS NOT NULL;

-- 3. Relax the task-only consistency CHECKs so they only apply to tasks.
ALTER TABLE public."MeetingTaskAction"
  DROP CONSTRAINT IF EXISTS "MeetingTaskAction_taskId_consistency";
ALTER TABLE public."MeetingTaskAction"
  ADD CONSTRAINT "MeetingTaskAction_taskId_consistency" CHECK (
    "entityType" <> 'task'
    OR execution = 'applied'
    OR (type = 'create' AND "taskId" IS NULL)
    OR (type <> 'create' AND "taskId" IS NOT NULL)
  );

ALTER TABLE public."MeetingTaskAction"
  DROP CONSTRAINT IF EXISTS "MeetingTaskAction_move_consistency";
ALTER TABLE public."MeetingTaskAction"
  ADD CONSTRAINT "MeetingTaskAction_move_consistency" CHECK (
    "entityType" <> 'task'
    OR (type = 'move' AND "targetSprintId" IS NOT NULL)
    OR type <> 'move'
  );

-- 4. Story consistency: mirror the task rule (create has no storyId until
--    applied; update/delete reference an existing story).
ALTER TABLE public."MeetingTaskAction"
  ADD CONSTRAINT "MeetingTaskAction_storyId_consistency" CHECK (
    "entityType" <> 'story'
    OR execution = 'applied'
    OR (type = 'create' AND "storyId" IS NULL)
    OR (type <> 'create' AND "storyId" IS NOT NULL)
  );

COMMIT;
