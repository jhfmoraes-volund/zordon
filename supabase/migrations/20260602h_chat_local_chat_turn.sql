-- ChatTurn — uma "rodada" de chat (1 mensagem do user → 1 resposta do agente).
--
-- Feature: chat-via-claude-local. Quando mode='claude-daemon', o backend cria
-- ChatTurn(status=queued) + ForgeJob(kind=chat) e o daemon local pega o job,
-- spawn `claude -p`, streamea via ChatTurnEvent, e no `complete` cria
-- ChatMessage(role=assistant) populando responseMessageId.
--
-- systemPrompt é snapshotado aqui pra permitir versionar prompts sem afetar
-- turns em vôo.

BEGIN;

CREATE TABLE "ChatTurn" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "threadId" uuid NOT NULL REFERENCES "ChatThread"(id) ON DELETE CASCADE,
  "userMessageId" uuid NOT NULL REFERENCES "ChatMessage"(id) ON DELETE CASCADE,
  "agentSlug" text NOT NULL,
  "mode" text NOT NULL CHECK ("mode" IN ('claude-daemon', 'openrouter')),
  "systemPrompt" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued'
    CHECK ("status" IN ('queued', 'running', 'done', 'error', 'aborted')),
  "claimedBy" uuid REFERENCES "ForgeDaemon"("daemonId") ON DELETE SET NULL,
  "startedAt" timestamptz,
  "endedAt" timestamptz,
  "responseMessageId" uuid REFERENCES "ChatMessage"(id) ON DELETE SET NULL,
  "tokensIn" int,
  "tokensOut" int,
  "costUsd" numeric(10, 6),
  "errorReason" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "ChatTurn_status_idx" ON "ChatTurn" ("status");
CREATE INDEX "ChatTurn_threadId_idx" ON "ChatTurn" ("threadId");
CREATE INDEX "ChatTurn_agentSlug_status_idx" ON "ChatTurn" ("agentSlug", "status");

ALTER TABLE "ChatTurn" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_turn_thread_member_read" ON "ChatTurn"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "ChatThread" t
      WHERE t.id = "ChatTurn"."threadId"
        AND t."createdBy" = auth.uid()
    )
  );

COMMIT;
