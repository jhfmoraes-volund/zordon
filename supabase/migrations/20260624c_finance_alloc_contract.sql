-- RB1 Fase 1.3 — finance.labor_allocation +contract_id (Slice 1).
-- A alocação passa a pertencer a um contrato (editável no sheet do contrato).
-- Resolve a sub-decisão do Batch D do épico (FK = SIM). SEM backfill: alocações
-- legadas ficam contract_id null (project-level), válidas.

alter table finance.labor_allocation
  add column if not exists contract_id uuid references finance.contract(id) on delete set null;
create index if not exists labor_alloc_contract_idx on finance.labor_allocation (contract_id);

-- down: alter table finance.labor_allocation drop column if exists contract_id;
