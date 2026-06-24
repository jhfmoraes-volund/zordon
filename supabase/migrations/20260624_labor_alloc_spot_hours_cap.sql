-- Spot agora é medido em HORAS (não dias) — ver 20260624_finance_labor_projection_and_spot_cost.sql.
-- A coluna física segue `days`, mas o teto passa de 60 (dias) para 160 (horas = 1 mês útil).
-- Recria só o CHECK de shape do kind, mantendo o resto da regra.

ALTER TABLE finance.labor_allocation DROP CONSTRAINT labor_alloc_kind_shape;

ALTER TABLE finance.labor_allocation ADD CONSTRAINT labor_alloc_kind_shape CHECK (
  (kind = 'standing' AND percent IS NOT NULL AND days IS NULL)
  OR
  (kind = 'spot' AND days IS NOT NULL AND days > 0 AND days <= 160 AND percent IS NULL)
);
