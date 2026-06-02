-- ChatTurnEvent — stream de deltas (tokens, tool_use, tool_result) dentro de
-- 1 turn, pra alimentar UI em tempo real via Supabase Realtime.
--
-- Feature: chat-via-claude-local. exec-chat-turn.ts (daemon) faz POST por
-- delta vindo do `claude -p --output-format stream-json`. UI subscreve canal
-- postgres_changes filtrado por turnId.
--
-- PK composta (turnId, seq) — seq monotônico por turn, atribuído server-side
-- (MAX(seq)+1 dentro da transação) pra evitar colisão. Mesmo padrão do
-- ForgeEvent.

BEGIN;

CREATE TABLE "ChatTurnEvent" (
  "turnId" uuid NOT NULL REFERENCES "ChatTurn"(id) ON DELETE CASCADE,
  "seq" int NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb,
  "ts" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("turnId", "seq")
);

CREATE INDEX "ChatTurnEvent_turnId_ts_idx" ON "ChatTurnEvent" ("turnId", "ts");

-- Habilita Realtime publication pra a UI receber INSERTs em tempo real.
ALTER PUBLICATION supabase_realtime ADD TABLE "ChatTurnEvent";

ALTER TABLE "ChatTurnEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_turn_event_thread_member_read" ON "ChatTurnEvent"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "ChatTurn" ct
      JOIN "ChatThread" t ON t.id = ct."threadId"
      WHERE ct.id = "ChatTurnEvent"."turnId"
        AND t."createdBy" = auth.uid()
    )
  );

COMMIT;
