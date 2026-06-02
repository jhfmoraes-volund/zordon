-- AgentMode — preferência global por (user, agentSlug) entre 'openrouter' e
-- 'claude-daemon'. Decisão estável, não muda por thread.
--
-- Feature: chat-via-claude-local. UI mora em /settings/agents. Sem registro =
-- default 'openrouter'. Quando 'claude-daemon' e daemon offline, fallback
-- automático pra openrouter no próximo turn (logado via toast na UI).

BEGIN;

CREATE TABLE "AgentMode" (
  "userId" uuid NOT NULL REFERENCES "Member"(id) ON DELETE CASCADE,
  "agentSlug" text NOT NULL,
  "mode" text NOT NULL DEFAULT 'openrouter'
    CHECK ("mode" IN ('claude-daemon', 'openrouter')),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "agentSlug")
);

CREATE INDEX "AgentMode_userId_idx" ON "AgentMode" ("userId");

ALTER TABLE "AgentMode" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_mode_owner_all" ON "AgentMode"
  FOR ALL USING ("userId" = auth.uid())
  WITH CHECK ("userId" = auth.uid());

COMMIT;
