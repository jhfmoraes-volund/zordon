-- App Contratos (PM+) — expõe também o `status` na view PM-safe v_contract_period.
-- Status (proposed/active/ended/declined) NÃO é valor monetário: é seguro pra quem
-- vê o projeto, sob a mesma fronteira (can_view_project OR is_admin). Habilita o app
-- Contratos a renderizar o chip de estado sem abrir o Finanças (admin-only).
-- create or replace só amplia a projeção; consumidores antigos ignoram a coluna extra.
-- Valores (fee/total/preço) continuam fora — só via finance.contract (admin_all).
-- `status` vai no FIM do select: create or replace só permite ADICIONAR colunas ao
-- final (não reordenar/inserir no meio) sem dropar a view.

create or replace view finance.v_contract_period as
select
  c.id            as contract_id,
  c.project_id,
  c.label,
  c.seq,
  c.effective_from,
  c.effective_to,
  c.billing_type,
  c.status
from finance.contract c
where public.can_view_project(c.project_id) or public.is_admin();

grant select on finance.v_contract_period to authenticated;

-- down: recria sem `c.status` (ver 20260624e_finance_v_contract_period.sql).
