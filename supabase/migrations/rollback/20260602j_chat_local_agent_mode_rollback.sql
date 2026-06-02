-- Rollback: 20260602j_chat_local_agent_mode.sql
-- Drop AgentMode (sem dependências externas — isolado).

BEGIN;

DROP TABLE IF EXISTS "AgentMode";

COMMIT;
