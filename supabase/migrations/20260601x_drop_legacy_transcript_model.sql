-- DROP do modelo legado de transcript/link, pós-cutover pra ContextSource + EntityLink.
--
-- Pré-condições (verificadas read-only em 2026-06-01):
--   • EntityLink.transcriptRefId: 0 linhas em uso, 0 selects no código.
--   • 8 link-tables: dados migrados pro EntityLink, 0 refs de código (`from("...")`).
--   • TranscriptRef: 18 linhas, todas espelhadas em ContextSource (0 sem espelho);
--     nenhum `.from("TranscriptRef")` runtime. FKs que apontavam pra ela:
--       - 3 das link-tables abaixo (somem junto)
--       - Opportunity.sourceTranscriptRefId -> repontada pra ContextSource na migration `w`
--
-- Tudo numa transação: ou cai o modelo legado inteiro, ou nada.
-- Rodar SÓ depois do teste manual + da migration `w`.

BEGIN;

-- 1) Coluna legada do EntityLink (FK já aponta pra ContextSource desde a `t`; vazia).
ALTER TABLE "EntityLink" DROP COLUMN IF EXISTS "transcriptRefId";

-- 2) Link-tables legadas (substituídas por EntityLink polimórfico).
DROP TABLE IF EXISTS "DesignSessionContextLink";
DROP TABLE IF EXISTS "DesignSessionTranscriptLink";
DROP TABLE IF EXISTS "PlanningMeetingLink";
DROP TABLE IF EXISTS "PlanningSessionContextLink";
DROP TABLE IF EXISTS "PlanningTranscriptLink";
DROP TABLE IF EXISTS "PMReviewContextLink";
DROP TABLE IF EXISTS "PMReviewMeetingLink";
DROP TABLE IF EXISTS "PMReviewTranscriptLink";

-- 3) TranscriptRef (SSOT antigo) — agora sem nenhuma FK inbound.
DROP TABLE IF EXISTS "TranscriptRef";

COMMIT;
