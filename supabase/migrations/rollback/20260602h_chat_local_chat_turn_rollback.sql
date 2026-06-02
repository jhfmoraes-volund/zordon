-- Rollback: 20260602h_chat_local_chat_turn.sql
-- Drop ChatTurn (CASCADE remove dependentes — ChatTurnEvent + responseMessageId nullify).
--
-- Pré-requisito: rollback de 20260602i_chat_local_chat_turn_event antes (FK
-- referencia ChatTurn).

BEGIN;

DROP TABLE IF EXISTS "ChatTurn" CASCADE;

COMMIT;
