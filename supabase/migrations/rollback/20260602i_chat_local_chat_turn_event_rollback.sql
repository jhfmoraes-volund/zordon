-- Rollback: 20260602i_chat_local_chat_turn_event.sql
-- Drop ChatTurnEvent + remove da Realtime publication.

BEGIN;

ALTER PUBLICATION supabase_realtime DROP TABLE "ChatTurnEvent";

DROP TABLE IF EXISTS "ChatTurnEvent";

COMMIT;
