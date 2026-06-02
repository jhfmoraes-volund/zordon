-- 20260602c_chatthread_release_planning_channel.sql
-- Permite 'release_planning' como ChatThread.channel — o chat da Vitoria no
-- command center de Release Planning usa agentName=sessionId + channel=release_planning.

BEGIN;

ALTER TABLE public."ChatThread" DROP CONSTRAINT IF EXISTS "ChatThread_channel_check";
ALTER TABLE public."ChatThread"
  ADD CONSTRAINT "ChatThread_channel_check"
  CHECK (channel = ANY (ARRAY[
    'web'::text,
    'telegram'::text,
    'trigger'::text,
    'briefing'::text,
    'planning'::text,
    'pm_review'::text,
    'release_planning'::text
  ]));

COMMIT;
