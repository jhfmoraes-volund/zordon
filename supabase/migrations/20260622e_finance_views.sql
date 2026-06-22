-- finance views — security_invoker (herdam RLS base, D8). Recorrência expandida
-- por mês; annual amortizado /12. Margem por projeto direta e com equipe (D15).
-- NÃO aplicada ainda; ver docs/features/finance/finance-app-plan.md §7.5.

-- Expande cada entry em (id, category_id, project_id, member_id, month, amount_cents).
create view finance.v_entry_month with (security_invoker = true) as
select
  e.id, e.category_id, e.project_id, e.member_id,
  date_trunc('month', gs)::date as month,
  case when e.recurrence = 'annual' then e.amount_cents / 12 else e.amount_cents end as amount_cents
from finance.entry e
cross join lateral generate_series(
  case when e.recurrence = 'once' then e.occurred_on else e.effective_from end,
  case when e.recurrence = 'once' then e.occurred_on else coalesce(e.effective_to, now()::date) end,
  interval '1 month'
) gs;

-- Comp mensal por membro (entries de categorias feeds_labor).
create view finance.v_member_comp_month with (security_invoker = true) as
select em.member_id, em.month, sum(em.amount_cents) as comp_cents
from finance.v_entry_month em
join finance.category c on c.id = em.category_id and c.feeds_labor
where em.member_id is not null
group by em.member_id, em.month;

-- Custo de mão-de-obra por projeto/mês = comp × percent vigente naquele mês.
create view finance.v_project_labor_month with (security_invoker = true) as
select la.project_id, cm.month,
       sum(cm.comp_cents * la.percent / 100.0)::bigint as labor_cents
from finance.labor_allocation la
join finance.v_member_comp_month cm
  on cm.member_id = la.member_id
 and cm.month >= la.effective_from
 and (la.effective_to is null or cm.month <= la.effective_to)
group by la.project_id, cm.month;

-- Totais por categoria/mês (cards + drill).
create view finance.v_category_month with (security_invoker = true) as
select em.category_id, c.kind, c.name, c.slug, em.month, sum(em.amount_cents) as amount_cents
from finance.v_entry_month em
join finance.category c on c.id = em.category_id
group by em.category_id, c.kind, c.name, c.slug, em.month;

-- Margem por projeto/mês (direta e com equipe).
create view finance.v_project_month with (security_invoker = true) as
with rev as (
  select em.project_id, em.month, sum(em.amount_cents) c
  from finance.v_entry_month em join finance.category cat on cat.id = em.category_id
  where cat.kind = 'revenue' and em.project_id is not null group by 1, 2),
exp as (
  select em.project_id, em.month, sum(em.amount_cents) c
  from finance.v_entry_month em join finance.category cat on cat.id = em.category_id
  where cat.kind = 'expense' and em.project_id is not null group by 1, 2),
lab as (select project_id, month, labor_cents from finance.v_project_labor_month)
select
  coalesce(rev.project_id, exp.project_id, lab.project_id) as project_id,
  coalesce(rev.month, exp.month, lab.month)                as month,
  coalesce(rev.c, 0)           as revenue_cents,
  coalesce(exp.c, 0)           as expense_cents,
  coalesce(lab.labor_cents, 0) as labor_cents,
  coalesce(rev.c, 0) - coalesce(exp.c, 0)                              as margin_direct_cents,
  coalesce(rev.c, 0) - coalesce(exp.c, 0) - coalesce(lab.labor_cents, 0) as margin_team_cents
from rev
full join exp on exp.project_id = rev.project_id and exp.month = rev.month
full join lab on lab.project_id = coalesce(rev.project_id, exp.project_id)
             and lab.month      = coalesce(rev.month, exp.month);

-- Totais org/mês (inclui overhead sem projeto + comp total).
create view finance.v_org_month with (security_invoker = true) as
with rev as (
  select em.month, sum(em.amount_cents) c from finance.v_entry_month em
  join finance.category cat on cat.id = em.category_id where cat.kind = 'revenue' group by 1),
exp as (
  select em.month, sum(em.amount_cents) c from finance.v_entry_month em
  join finance.category cat on cat.id = em.category_id where cat.kind = 'expense' group by 1)
select coalesce(rev.month, exp.month) as month,
       coalesce(rev.c, 0) as revenue_cents,
       coalesce(exp.c, 0) as expense_cents,
       coalesce(rev.c, 0) - coalesce(exp.c, 0) as net_cents
from rev full join exp on exp.month = rev.month;

grant select on
  finance.v_entry_month, finance.v_member_comp_month, finance.v_project_labor_month,
  finance.v_category_month, finance.v_project_month, finance.v_org_month
to authenticated;
