-- Allow "briefing" as a ChatThread channel.
-- The Briefing step in design sessions uses its own dedicated chat channel
-- (separate from "web", "telegram", "trigger") so history is isolated per
-- conversation purpose.

ALTER TABLE "ChatThread" DROP CONSTRAINT IF EXISTS "ChatThread_channel_check";

ALTER TABLE "ChatThread"
  ADD CONSTRAINT "ChatThread_channel_check"
  CHECK (channel = ANY (ARRAY['web'::text, 'telegram'::text, 'trigger'::text, 'briefing'::text]));
