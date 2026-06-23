-- finance: custo de mão-de-obra PRO-RATA POR DIAS (método de custeio preciso).
--
-- Decisão do dono (defensável p/ diretoria): o custo de um membro num período é
-- proporcional aos DIAS em que esteve alocado, não ao mês cheio. Ex.: alocação
-- 21/mai→12/jun de quem ganha R$12k/mês custa maio×11/31 + junho×12/30 =
-- R$9.058,06 — não R$24k (mês cheio) nem só 1 mês (bug do match por 1º-dia).
--
-- Antes: `v_project_member_labor_month` usava `comp × percent` em todo mês onde
-- a alocação estava ativa no 1º dia — (a) dropava o mês de início quando a
-- alocação começava depois do dia 1, (b) contava mês cheio nas bordas.
--
-- Agora: base única `v_allocation_labor_month` (1 linha por alocação×mês, com
-- fator de dias) da qual TUDO deriva — member/project/contract labor. Alocações
-- alinhadas ao mês (effective_from=1º dia, effective_to=último) têm fator 1 →
-- números já validados contra a planilha Hitz NÃO mudam; só meio-de-mês muda.
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623m_finance_labor_prorata.sql

begin;

-- 1. Base PRO-RATA: custo da alocação no mês = comp_mensal × % × (dias da
--    sobreposição da vigência da alocação dentro do mês ÷ dias do mês).
create view finance.v_allocation_labor_month with (security_invoker = true) as
with j as (
  select
    la.id          as allocation_id,
    la.contract_id,
    la.project_id,
    la.member_id,
    la.percent,
    cm.month,
    cm.comp_cents,
    (cm.month + interval '1 month' - interval '1 day')::date as month_end,
    greatest(la.effective_from, cm.month)                                                as ov_start,
    least(coalesce(la.effective_to, (cm.month + interval '1 month' - interval '1 day')::date),
          (cm.month + interval '1 month' - interval '1 day')::date)                      as ov_end
  from finance.labor_allocation la
  join finance.v_member_comp_month cm
    on cm.member_id = la.member_id
   and cm.month >= date_trunc('month', la.effective_from)::date
   and (la.effective_to is null or cm.month <= la.effective_to)
)
select
  allocation_id,
  contract_id,
  project_id,
  member_id,
  month,
  round(
    comp_cents
    * (percent / 100.0)
    * ((ov_end - ov_start + 1)::numeric / extract(day from month_end)::numeric)
  )::bigint as labor_cents
from j
where ov_end >= ov_start;

grant select on finance.v_allocation_labor_month to authenticated;

-- 2. v_project_member_labor_month deriva da base (mesmas colunas → dependentes
--    como v_project_labor_month seguem sem replace).
create or replace view finance.v_project_member_labor_month with (security_invoker = true) as
select project_id, member_id, month, sum(labor_cents)::bigint as labor_cents
from finance.v_allocation_labor_month
group by project_id, member_id, month;

-- 3. v_contract_month: receita/despesa inalteradas; equipe agora deriva da base
--    pro-rata (mesmas colunas/ordem → não dropa dependentes).
create or replace view finance.v_contract_month with (security_invoker = true) as
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
  select contract_id, project_id, month, sum(labor_cents)::bigint as labor_cents
  from finance.v_allocation_labor_month
  where contract_id is not null
  group by contract_id, project_id, month
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

commit;
