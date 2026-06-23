-- RB1 Fase 1.1 — finance.contract +metadados de agent-fill (Slice 1 MVP).
-- warranty/proposal_ref = campos preenchíveis pelo agente (B6); provenance = mapa
-- de procedência por campo (P1: { campo: { source, at, runId?, confidence? } }).
-- Aditivo, baixo risco. Down abaixo.

alter table finance.contract
  add column if not exists warranty      text,
  add column if not exists proposal_ref  text,
  add column if not exists provenance    jsonb not null default '{}'::jsonb;

-- down (idempotente):
-- alter table finance.contract
--   drop column if exists warranty,
--   drop column if exists proposal_ref,
--   drop column if exists provenance;
