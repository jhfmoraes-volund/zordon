-- ForgeJob.kind — extensão do daemon job para suportar 'chat' além de 'forge'.
--
-- Feature: chat-via-claude-local (Vitor/Vitoria/Alpha respondem via Claude CLI
-- local em vez de OpenRouter). Daemon claim loop filtra ?kind=forge|chat.

BEGIN;

ALTER TABLE "ForgeJob"
  ADD COLUMN "kind" text NOT NULL DEFAULT 'forge'
    CHECK ("kind" IN ('forge', 'chat'));

CREATE INDEX IF NOT EXISTS "ForgeJob_kind_status_idx"
  ON "ForgeJob" ("kind", "status");

COMMIT;
