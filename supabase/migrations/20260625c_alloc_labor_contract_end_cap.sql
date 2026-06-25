-- ═══════════════════════════════════════════════════════════════════════════
-- Conserta vazamento de custo no ÚLTIMO mês do contrato.
--
-- Bug: pro-rata diário usava COALESCE(effective_to, fim_do_mês) como teto. Numa
-- alocação ABERTA (effective_to null) num contrato que encerra no meio do mês
-- (ex.: 14/jun), cobrava o mês inteiro (até 30/jun) em vez de parar em 14/jun.
-- A seleção de MESES já respeitava o contrato (horizon_end), só o pro-rata DIÁRIO
-- não — daí "tudo vigente" e custo inflado no fechamento.
--
-- Fix: teto diário = COALESCE(horizon_end, fim_do_mês), onde
--   horizon_end = COALESCE(la.effective_to, contract.effective_to).
-- Em alocação encerrada o número não muda (horizon_end = effective_to). Só muda
-- a aberta sobre contrato com fim — passa a parar na data do contrato.
--
-- CREATE OR REPLACE (mesmas colunas) → PRESERVA grants e dependentes (não é o
-- DROP que derrubou grant na MAH-002). Mesmo assim re-grant defensivo no fim.
-- Rodar: psql "$DIRECT_URL" -f supabase/migrations/20260625c_alloc_labor_contract_end_cap.sql
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view finance.v_allocation_labor_month as
with alloc as (
  select la.id as allocation_id, la.contract_id, la.project_id, la.member_id,
         la.percent, la.days, la.kind, la.effective_from, la.effective_to,
         coalesce(la.effective_to, ct.effective_to) as horizon_end
  from finance.labor_allocation la
    left join finance.contract ct on ct.id = la.contract_id
  where la.voided_at is null
), comp_latest as (
  select distinct on (v.member_id) v.member_id, v.month as last_month, v.comp_cents as last_comp
  from finance.v_member_comp_month v
  order by v.member_id, v.month desc
), months as (
  select a.allocation_id, cm.month, cm.comp_cents
  from alloc a
    join finance.v_member_comp_month cm on cm.member_id = a.member_id
     and cm.month >= date_trunc('month', a.effective_from::timestamptz)::date
     and cm.month <= coalesce(a.horizon_end, cm.month)
  union
  select a.allocation_id, gs.gs::date as month, cl.last_comp as comp_cents
  from alloc a
    join comp_latest cl on cl.member_id = a.member_id
    cross join lateral generate_series(
      greatest(date_trunc('month', a.effective_from::timestamptz)::date,
               (date_trunc('month', cl.last_month::timestamptz) + interval '1 mon')::date)::timestamptz,
      date_trunc('month', a.horizon_end::timestamptz)::date::timestamptz,
      interval '1 mon') gs(gs)
  where a.horizon_end is not null
)
select a.allocation_id, a.contract_id, a.project_id, a.member_id, m.month,
  case
    when a.kind = 'spot' then round(m.comp_cents * (coalesce(a.days, 0::numeric) / 160.0))::bigint
    else round(m.comp_cents * (a.percent / 100.0) * (
      (least(coalesce(a.horizon_end, (m.month + interval '1 mon' - interval '1 day')::date),
             (m.month + interval '1 mon' - interval '1 day')::date)
       - greatest(a.effective_from, m.month) + 1)::numeric
      / extract(day from (m.month + interval '1 mon' - interval '1 day')::date)))::bigint
  end as labor_cents
from alloc a
  join months m on m.allocation_id = a.allocation_id
where
  case
    when a.kind = 'spot' then m.month = date_trunc('month', a.effective_from::timestamptz)::date
    else least(coalesce(a.horizon_end, (m.month + interval '1 mon' - interval '1 day')::date),
               (m.month + interval '1 mon' - interval '1 day')::date)
         >= greatest(a.effective_from, m.month)
  end;

-- re-grant defensivo (lição MAH-002 — não confiar que o REPLACE manteve)
grant select on finance.v_allocation_labor_month to authenticated;
