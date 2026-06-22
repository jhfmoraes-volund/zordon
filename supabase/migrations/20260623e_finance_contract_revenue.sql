-- finance: receita do contrato squad = SSOT da receita recorrente.
-- Mensalidade (contract.monthly_fee_cents) × meses da vigência, com OVERRIDE por
-- mês (contract_month_override) pra meses com valor especial. Vira a receita do
-- projeto na DRE — simétrico ao FP da encomenda. A partir daqui, receita
-- recorrente de squad mora SÓ no contrato; entries de Faturamento ficam pra
-- one-offs (a conversão do HITz vem em 20260623f). Ver pricing-pnl-model.md.
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623e_finance_contract_revenue.sql

begin;

-- 1. Override de valor por mês (condição especial de um mês). Substitui a
--    mensalidade base só naquele mês. UNIQUE (contract, month).
create table finance.contract_month_override (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references finance.contract(id) on delete cascade,
  month        date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  note         text,
  created_by   uuid references public."Member"(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint contract_month_override_first_day check (date_trunc('month', month) = month),
  unique (contract_id, month)
);
alter table finance.contract_month_override enable row level security;
create policy admin_all on finance.contract_month_override as permissive for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on finance.contract_month_override to authenticated;

-- 2. Receita do contrato por mês = override do mês, senão a mensalidade base.
--    Só contratos squad com algum valor. Expande a vigência mês a mês (mirror
--    do v_entry_month: COALESCE(effective_to, now) pro caso vigente).
create view finance.v_contract_revenue_month with (security_invoker = true) as
with squad as (
  select id, project_id, effective_from, effective_to, monthly_fee_cents
  from finance.contract
  where billing_type = 'squad'
),
months as (
  select s.id as contract_id, s.project_id, s.monthly_fee_cents,
         date_trunc('month', gs.gs)::date as month
  from squad s
  cross join lateral generate_series(
    date_trunc('month', s.effective_from),
    date_trunc('month', coalesce(s.effective_to, now()::date)),
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

grant select on finance.v_contract_revenue_month to authenticated;

-- 3. v_project_month: receita = entries + FP entregue + receita de contrato squad.
create or replace view finance.v_project_month with (security_invoker = true) as
with rev as (
  select em.project_id, em.month, sum(em.amount_cents) c
  from finance.v_entry_month em join finance.category cat on cat.id = em.category_id
  where cat.kind = 'revenue' and em.project_id is not null group by 1, 2),
exp as (
  select em.project_id, em.month, sum(em.amount_cents) c
  from finance.v_entry_month em join finance.category cat on cat.id = em.category_id
  where cat.kind = 'expense' and em.project_id is not null group by 1, 2),
lab as (select project_id, month, labor_cents from finance.v_project_labor_month),
fpr as (select project_id, month, revenue_cents from finance.v_fp_delivery_month),
crev as (select project_id, month, revenue_cents from finance.v_contract_revenue_month),
spine as (
  select project_id, month from rev
  union select project_id, month from exp
  union select project_id, month from lab
  union select project_id, month from fpr
  union select project_id, month from crev
)
select
  s.project_id,
  s.month,
  coalesce(rev.c, 0) + coalesce(fpr.revenue_cents, 0) + coalesce(crev.revenue_cents, 0) as revenue_cents,
  coalesce(exp.c, 0) as expense_cents,
  coalesce(lab.labor_cents, 0) as labor_cents,
  (coalesce(rev.c, 0) + coalesce(fpr.revenue_cents, 0) + coalesce(crev.revenue_cents, 0)) - coalesce(exp.c, 0) as margin_direct_cents,
  (coalesce(rev.c, 0) + coalesce(fpr.revenue_cents, 0) + coalesce(crev.revenue_cents, 0)) - coalesce(exp.c, 0) - coalesce(lab.labor_cents, 0) as margin_team_cents
from spine s
left join rev on rev.project_id = s.project_id and rev.month = s.month
left join exp on exp.project_id = s.project_id and exp.month = s.month
left join lab on lab.project_id = s.project_id and lab.month = s.month
left join fpr on fpr.project_id = s.project_id and fpr.month = s.month
left join crev on crev.project_id = s.project_id and crev.month = s.month;

-- 4. v_org_month: idem, org-wide.
create or replace view finance.v_org_month with (security_invoker = true) as
with rev as (
  select em.month, sum(em.amount_cents) c from finance.v_entry_month em
  join finance.category cat on cat.id = em.category_id where cat.kind = 'revenue' group by 1),
exp as (
  select em.month, sum(em.amount_cents) c from finance.v_entry_month em
  join finance.category cat on cat.id = em.category_id where cat.kind = 'expense' group by 1),
fpr as (select month, sum(revenue_cents) c from finance.v_fp_delivery_month group by 1),
crev as (select month, sum(revenue_cents) c from finance.v_contract_revenue_month group by 1)
select
  m.month,
  coalesce(rev.c, 0) + coalesce(fpr.c, 0) + coalesce(crev.c, 0) as revenue_cents,
  coalesce(exp.c, 0) as expense_cents,
  (coalesce(rev.c, 0) + coalesce(fpr.c, 0) + coalesce(crev.c, 0)) - coalesce(exp.c, 0) as net_cents
from (select month from rev union select month from exp union select month from fpr union select month from crev) m
left join rev on rev.month = m.month
left join exp on exp.month = m.month
left join fpr on fpr.month = m.month
left join crev on crev.month = m.month;

commit;
