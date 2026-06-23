-- finance: (1) nº de mensalidades EXPLÍCITO no squad + (2) atribuição por contrato.
--
-- Dois bugs reportados (HITz) com a mesma raiz — receita reconhecida por mês de
-- calendário, não pela forma de cobrança:
--
--  (1) Squad cobrando mês a mais. v_contract_revenue_month gerava 1 cobrança por
--      mês de calendário TOCADO pela vigência (15/jun→20/set = jun,jul,ago,set = 4),
--      misturando DURAÇÃO da vigência com Nº DE COBRANÇAS. Agora a quantidade de
--      mensalidades é um campo próprio (contract.billing_count); a receita gera
--      exatamente billing_count meses a partir do mês de início. Sem o campo,
--      cai no fallback antigo (meses de calendário tocados) — retrocompatível.
--
--  (2) Escopo de contrato vazando receita de outro. O hub escopa por JANELA DE
--      MÊS (Contrato 1: mai–jun); como dois contratos encostam em junho, a
--      mensalidade do squad (Contrato 2) aparecia no escopo do Contrato 1.
--      Nova view finance.v_contract_month atribui receita/equipe/despesa POR
--      CONTRATO (não por janela), pro hub ler o contrato escopado sem vazar.
--      v_project_month/v_org_month (Global) seguem inalteradas em forma.
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623l_finance_billing_count_and_contract_attribution.sql

begin;

-- 1. Nº de mensalidades cobradas (squad). Separado da vigência: a vigência diz
--    QUANTO TEMPO o time roda; billing_count diz QUANTAS vezes se cobra.
alter table finance.contract
  add column billing_count int check (billing_count is null or billing_count > 0);

comment on column finance.contract.billing_count is
  'Squad: nº de mensalidades cobradas (separado da duração da vigência). NULL = fallback p/ meses de calendário tocados.';

-- 2. v_contract_revenue_month (Global): receita squad respeita billing_count.
--    Mesma forma (project_id, month, revenue_cents) → não dropa dependentes.
--    n_months = billing_count, senão meses de calendário entre início e fim
--    (coalesce(fim, hoje)), +1 inclusive — o comportamento legado.
create or replace view finance.v_contract_revenue_month with (security_invoker = true) as
with squad as (
  select id, project_id, effective_from, monthly_fee_cents,
         coalesce(
           billing_count,
           (extract(year  from age(date_trunc('month', coalesce(effective_to, now()::date)),
                                    date_trunc('month', effective_from))) * 12
          + extract(month from age(date_trunc('month', coalesce(effective_to, now()::date)),
                                    date_trunc('month', effective_from))))::int + 1
         ) as n_months
  from finance.contract
  where billing_type = 'squad'
),
months as (
  select s.id as contract_id, s.project_id, s.monthly_fee_cents,
         date_trunc('month', gs.gs)::date as month
  from squad s
  cross join lateral generate_series(
    date_trunc('month', s.effective_from),
    date_trunc('month', s.effective_from) + ((s.n_months - 1) || ' month')::interval,
    '1 month'::interval
  ) gs(gs)
)
select m.project_id,
       m.month,
       sum(coalesce(o.amount_cents, m.monthly_fee_cents))::bigint as revenue_cents
from months m
left join finance.contract_month_override o on o.contract_id = m.contract_id and o.month = m.month
where coalesce(o.amount_cents, m.monthly_fee_cents) is not null
group by m.project_id, m.month;

-- 3. v_contract_month — fato mensal POR CONTRATO (receita + equipe + despesa).
--    Usado pelo hub quando um contrato está escopado (sem vazamento de janela).
--    - receita squad: mensalidade/override nos billing_count meses (mesma regra do #2);
--    - receita encomenda: FP entregue × preço/FP do contrato fixed_scope que cobre o mês;
--    - equipe: alocações que gravam contract_id (custo = comp × %);
--    - despesa: entry de despesa atribuída ao contrato vigente no mês (lateral pega 1).
create view finance.v_contract_month with (security_invoker = true) as
with squad as (
  select id, project_id, monthly_fee_cents, effective_from,
         coalesce(
           billing_count,
           (extract(year  from age(date_trunc('month', coalesce(effective_to, now()::date)),
                                    date_trunc('month', effective_from))) * 12
          + extract(month from age(date_trunc('month', coalesce(effective_to, now()::date)),
                                    date_trunc('month', effective_from))))::int + 1
         ) as n_months
  from finance.contract
  where billing_type = 'squad'
),
squad_rev as (
  select s.id as contract_id, s.project_id,
         date_trunc('month', gs.gs)::date as month,
         coalesce(o.amount_cents, s.monthly_fee_cents)::bigint as revenue_cents
  from squad s
  cross join lateral generate_series(
    date_trunc('month', s.effective_from),
    date_trunc('month', s.effective_from) + ((s.n_months - 1) || ' month')::interval,
    '1 month'::interval
  ) gs(gs)
  left join finance.contract_month_override o on o.contract_id = s.id and o.month = date_trunc('month', gs.gs)::date
  where coalesce(o.amount_cents, s.monthly_fee_cents) is not null
),
fp_rev as (
  select c.id as contract_id, c.project_id, d.month,
         sum(d.fp_delivered * coalesce(c.price_per_fp_cents, 0))::bigint as revenue_cents
  from finance.fp_delivery d
  join finance.contract c
    on c.project_id = d.project_id
   and c.billing_type = 'fixed_scope'
   and date_trunc('month', c.effective_from::timestamptz) <= d.month
   and (c.effective_to is null or d.month <= date_trunc('month', c.effective_to::timestamptz))
  group by c.id, c.project_id, d.month
),
rev as (
  select contract_id, project_id, month, revenue_cents from squad_rev
  union all
  select contract_id, project_id, month, revenue_cents from fp_rev
),
lab as (
  select la.contract_id, la.project_id, cm.month,
         sum(cm.comp_cents * la.percent / 100.0)::bigint as labor_cents
  from finance.labor_allocation la
  join finance.v_member_comp_month cm
    on cm.member_id = la.member_id
   and cm.month >= la.effective_from
   and (la.effective_to is null or cm.month <= la.effective_to)
  where la.contract_id is not null
  group by la.contract_id, la.project_id, cm.month
),
exp as (
  select c.contract_id, em.project_id, em.month,
         sum(em.amount_cents)::bigint as expense_cents
  from finance.v_entry_month em
  join finance.category cat on cat.id = em.category_id and cat.kind = 'expense'
  join lateral (
    select cc.id as contract_id
    from finance.contract cc
    where cc.project_id = em.project_id
      and date_trunc('month', cc.effective_from::timestamptz) <= em.month
      and (cc.effective_to is null or em.month <= date_trunc('month', cc.effective_to::timestamptz))
    order by cc.effective_from desc
    limit 1
  ) c on true
  where em.project_id is not null
  group by c.contract_id, em.project_id, em.month
),
spine as (
  select contract_id, project_id, month from rev
  union select contract_id, project_id, month from lab
  union select contract_id, project_id, month from exp
)
select s.contract_id,
       s.project_id,
       s.month,
       coalesce(rev.revenue_cents, 0)  as revenue_cents,
       coalesce(exp.expense_cents, 0)  as expense_cents,
       coalesce(lab.labor_cents, 0)    as labor_cents
from spine s
left join rev on rev.contract_id = s.contract_id and rev.month = s.month
left join lab on lab.contract_id = s.contract_id and lab.month = s.month
left join exp on exp.contract_id = s.contract_id and exp.month = s.month;

grant select on finance.v_contract_month to authenticated;

-- 4. Backfill: HITz Contrato 2 (squad) cobra 3× (15/jun→20/set é ~3 meses de
--    serviço — não 4). Demais squads ficam no fallback até o dono setar.
update finance.contract
set billing_count = 3
where id = 'd7ffaee9-81c7-4d4c-9d58-10fc98699056';

commit;
