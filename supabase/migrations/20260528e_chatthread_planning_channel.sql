-- Add "planning" to ChatThread.channel check constraint so the
-- PlanningCeremony chat connector can create threads for planning rituals.
ALTER TABLE "ChatThread" DROP CONSTRAINT IF EXISTS "ChatThread_channel_check";

ALTER TABLE "ChatThread"
  ADD CONSTRAINT "ChatThread_channel_check"
  CHECK (channel = ANY (ARRAY[
    'web'::text,
    'telegram'::text,
    'trigger'::text,
    'briefing'::text,
    'planning'::text
  ]));
