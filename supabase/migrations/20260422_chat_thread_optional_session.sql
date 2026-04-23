-- ChatThread.sessionId must be nullable so agents like Zordon
-- can have threads without a DesignSession.
-- Also add an "agentName" column to identify which agent owns the thread.

ALTER TABLE "ChatThread"
  ALTER COLUMN "sessionId" DROP NOT NULL;

ALTER TABLE "ChatThread"
  ADD COLUMN IF NOT EXISTS "agentName" text;
