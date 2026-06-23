-- finance.contract.status — lifecycle do contrato/proposta.
--
-- Decisão D1 (plano project-contract-allocation-ssot): uma Proposta NÃO é tabela
-- nova — é um Contract em status='proposed'. Ganhar a proposta = flip pra
-- 'active'. Piloto/MVP = contrato curto. 'ended' = vigência encerrada;
-- 'declined' = proposta perdida.
--
-- Default 'active' mantém todos os contratos-semente atuais válidos (eles já
-- representam engajamentos vigentes; nenhum é proposta retroativa).
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624f_finance_contract_status.sql

BEGIN;

ALTER TABLE finance.contract
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('proposed','active','ended','declined'));

CREATE INDEX IF NOT EXISTS idx_contract_status ON finance.contract(status);

COMMIT;
