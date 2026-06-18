-- Ritual Playbook: transporte dos params resolvidos do playbook (audienceFloor
-- + emphasisSections) request → daemon, por turn. O prepare-turn lê esta coluna
-- e injeta no agentContext; loadPMReviewContext aperta o filtro de audiência e
-- buildPMReviewPrompt anexa o bloco de ênfase (camada volátil).
-- Nullable/additivo: turns sem playbook (ou de outros agentes) ficam com o
-- comportamento de hoje. Espelha 20260617_chatturn_routepath.sql.
ALTER TABLE "ChatTurn" ADD COLUMN IF NOT EXISTS "turnParams" jsonb;
