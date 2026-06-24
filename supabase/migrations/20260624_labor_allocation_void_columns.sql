-- MAH-001: Adicionar colunas de void + closed_by em labor_allocation
-- Migration M1 — voided_at/voided_reason/voided_by + closed_by + índice parcial live.

ALTER TABLE finance.labor_allocation
  ADD COLUMN voided_at     timestamptz,
  ADD COLUMN voided_reason text,
  ADD COLUMN voided_by     uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  ADD COLUMN closed_by     uuid REFERENCES public."Member"(id) ON DELETE SET NULL;

-- Índice parcial para consultas de alocações ativas (não-void)
CREATE INDEX labor_alloc_live_idx ON finance.labor_allocation (contract_id)
  WHERE voided_at IS NULL;
