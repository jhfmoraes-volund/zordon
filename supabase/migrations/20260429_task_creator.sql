-- Track who created each Task: a Member directly, or Alpha (the AI agent)
-- acting on behalf of a Member. Pre-existing rows stay NULL on createdById
-- (unknown) and false on createdByAgent.

ALTER TABLE "Task"
  ADD COLUMN "createdById" text REFERENCES "Member"("id") ON DELETE SET NULL,
  ADD COLUMN "createdByAgent" boolean NOT NULL DEFAULT false;

CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");

COMMENT ON COLUMN "Task"."createdById" IS
  'Member who created the task (or on whose behalf an agent created it). NULL for legacy rows.';
COMMENT ON COLUMN "Task"."createdByAgent" IS
  'TRUE when an AI agent (Alpha, Vitor, ...) created the task on behalf of createdById.';
