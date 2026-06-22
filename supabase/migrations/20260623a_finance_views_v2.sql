-- finance views v2 — labor por membro (drill) + spine correto do v_project_month.
-- Fase 3 (margem com equipe via labor_allocation). Ver finance-app-plan.md §11.
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623a_finance_views_v2.sql

-- Custo de mão-de-obra por projeto/membro/mês = comp_mensal × percent vigente.
create view finance.v_project_member_labor_month with (security_invoker = true) as
select la.project_id, la.member_id, cm.month,
       (cm.comp_cents * la.percent / 100.0)::bigint as labor_cents
from finance.labor_allocation la
join finance.v_member_comp_month cm
  on cm.member_id = la.member_id
 and cm.month >= la.effective_from
 and (la.effective_to is null or cm.month <= la.effective_to);

-- v_project_labor_month agora deriva do member-level (DRY).
create or replace view finance.v_project_labor_month with (security_invoker = true) as
select project_id, month, sum(labor_cents)::bigint as labor_cents
from finance.v_project_member_labor_month
group by project_id, month;

-- v_project_month com spine = união de (project_id, month) de receita ∪ despesa ∪ labor.
-- Antes, projeto só com custo de equipe (sem receita/despesa) sumia.
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
spine as (
  select project_id, month from rev
  union select project_id, month from exp
  union select project_id, month from lab
)
select
  s.project_id,
  s.month,
  coalesce(rev.c, 0)           as revenue_cents,
  coalesce(exp.c, 0)           as expense_cents,
  coalesce(lab.labor_cents, 0) as labor_cents,
  coalesce(rev.c, 0) - coalesce(exp.c, 0)                              as margin_direct_cents,
  coalesce(rev.c, 0) - coalesce(exp.c, 0) - coalesce(lab.labor_cents, 0) as margin_team_cents
from spine s
left join rev on rev.project_id = s.project_id and rev.month = s.month
left join exp on exp.project_id = s.project_id and exp.month = s.month
left join lab on lab.project_id = s.project_id and lab.month = s.month;

grant select on finance.v_project_member_labor_month to authenticated;
