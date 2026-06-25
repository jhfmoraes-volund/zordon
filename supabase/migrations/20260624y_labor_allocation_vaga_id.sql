-- ═══════════════════════════════════════════════════════════════════════════
-- Liga ocupação → vaga: labor_allocation.vaga_id (ADITIVO).
--
-- Ocupação = labor_allocation com vaga_id setado. Sucessão = várias linhas no
-- mesmo vaga_id ao longo do tempo (períodos sucessivos).
--
-- PROPRIEDADE DE SEGURANÇA: nenhuma view de custo (v_allocation_labor_month,
-- v_project_member_labor_month, v_contract_month, v_project_month, ...) lê vaga_id.
-- Adicionar a coluna é INERTE pro custo — zero recriação de view, zero regressão.
-- O custo segue fluindo ocupante (finance.entry) → contrato.
--
-- ON DELETE SET NULL: apagar uma vaga NÃO apaga a ocupação (o custo é sagrado);
-- a alocação sobrevive, só desliga do vaga_id.
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624y_labor_allocation_vaga_id.sql
-- ═══════════════════════════════════════════════════════════════════════════

alter table finance.labor_allocation
  add column vaga_id uuid references finance.contract_vaga(id) on delete set null;

create index labor_alloc_vaga_idx on finance.labor_allocation (vaga_id)
  where voided_at is null;

-- Spot fica pessoa-ad-hoc (não vaga): ajuda pontual em horas não é função durável.
alter table finance.labor_allocation
  add constraint labor_alloc_spot_no_vaga check (kind <> 'spot' or vaga_id is null);
