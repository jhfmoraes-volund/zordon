-- Slice 3 / Batch B (RB2 Fase 2.9) — período do contrato legível por quem vê o
-- projeto. Q3 (dono, 2026-06-23): EDIÇÃO continua admin-only (sem nova rota de
-- escrita — segue /api/finance/contract); aqui só a LEITURA do período abre.
--
-- Segurança: a view projeta APENAS período/identidade (label, seq, vigência,
-- tipo) — NUNCA valores (fee/total/preço). É uma view SECURITY DEFINER (default),
-- então roda como o owner e contorna a RLS admin_all de finance.contract; o
-- WHERE é a fronteira de visibilidade (can_view_project OR is_admin). Valores
-- continuam só via finance.contract (admin_all) / endpoints admin.

create or replace view finance.v_contract_period as
select
  c.id            as contract_id,
  c.project_id,
  c.label,
  c.seq,
  c.effective_from,
  c.effective_to,
  c.billing_type
from finance.contract c
where public.can_view_project(c.project_id) or public.is_admin();

grant select on finance.v_contract_period to authenticated;

-- down: drop view if exists finance.v_contract_period;
