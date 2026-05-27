-- Adiciona coluna `decision` ao Todo pra gating de sugestões da IA.
-- Padrão espelha MeetingTaskAction.decision (pending|approved|rejected).
--
-- Backfill: registros existentes ficam 'approved' (já estavam implicitamente
-- aceitos na lista). Só ToDos novos com source='ai' nascem 'pending'.

ALTER TABLE "Todo"
  ADD COLUMN "decision" text NOT NULL DEFAULT 'approved';

ALTER TABLE "Todo"
  ADD CONSTRAINT "Todo_decision_check"
  CHECK ("decision" IN ('pending', 'approved', 'rejected'));

COMMENT ON COLUMN "Todo"."decision" IS
  'Gating para sugestões da IA: pending (oculto), approved (visível), rejected (arquivado). ToDos manuais nascem approved.';

COMMENT ON COLUMN "Todo"."source" IS
  'Origem: meeting (criado manualmente em reunião) | ai (extraído pelo agente) | direct (criado fora de reunião).';

CREATE INDEX "Todo_pending_idx" ON "Todo" ("meetingId")
  WHERE "decision" = 'pending';
