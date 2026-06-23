-- labor_allocation: participação pontual (spot) medida em DIAS.
--
-- Decisão D11 (REVISADO 2026-06-23): spot = builder que ajuda pontualmente,
-- alocado em DIAS (1 dia = 8h, fracionável), SEM porcentagem. standing continua
-- em % (modelo atual). Teto 60 dias POR ENTRADA (D12). A "competência" (mês do
-- custo) é a `effective_from` da entrada.
--
-- Aditivo e retrocompatível: toda linha atual vira kind='standing' e satisfaz a
-- CHECK (percent NOT NULL, days NULL). Nenhum backfill necessário.
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624j_labor_allocation_spot.sql

BEGIN;

ALTER TABLE finance.labor_allocation
  ADD COLUMN kind text NOT NULL DEFAULT 'standing'
    CHECK (kind IN ('standing','spot')),
  ADD COLUMN days numeric;

-- spot não usa %; standing continua exigindo. percent passa a ser opcional.
ALTER TABLE finance.labor_allocation ALTER COLUMN percent DROP NOT NULL;

-- Forma por kind: standing = % (sem dias) · spot = dias 0<d<=60 (sem %).
ALTER TABLE finance.labor_allocation
  ADD CONSTRAINT labor_alloc_kind_shape CHECK (
    (kind = 'standing' AND percent IS NOT NULL AND days IS NULL)
    OR
    (kind = 'spot' AND days IS NOT NULL AND days > 0 AND days <= 60 AND percent IS NULL)
  );

CREATE INDEX idx_labor_alloc_kind ON finance.labor_allocation(kind);

COMMIT;
