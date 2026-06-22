-- finance: preço/FP INVERTIDO (requisito #3 do dono).
-- O campo aberto da encomenda passa a ser o VALOR GLOBAL do contrato
-- (total_value_cents); o preço/FP vira coluna DERIVADA (GENERATED) =
-- valor_global ÷ FP_contratado. Single source, sem drift. Modelo PF Volund
-- (receita delivery-based, D6): v_fp_delivery_month segue = fp_delivered × preço/FP.
-- price_per_fp_cents é dependência real de v_fp_delivery_month → dropar+recriar
-- as 3 views (org/project dependem dela). Backfill = no-op (0 contratos com valor).
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623i_finance_contract_total_value.sql

begin;

-- 1. valor global (campo aberto)
alter table finance.contract
  add column total_value_cents bigint check (total_value_cents is null or total_value_cents >= 0);

-- 2. preço/FP vira derivado. Precisa dropar as 3 views antes (dependem da coluna).
drop view finance.v_org_month;
drop view finance.v_project_month;
drop view finance.v_fp_delivery_month;

alter table finance.contract drop column price_per_fp_cents;
alter table finance.contract
  add column price_per_fp_cents bigint
  generated always as (
    case
      when total_value_cents is not null and contracted_fp is not null and contracted_fp > 0
        then round(total_value_cents::numeric / contracted_fp)::bigint
      else null
    end
  ) stored;

-- 3. recriar as 3 views VERBATIM (referenciam price_per_fp_cents, agora gerada — SQL idêntico).
create view finance.v_fp_delivery_month with (security_invoker = true) as
select d.project_id,
       d.month,
       sum(d.fp_delivered)                                                          as fp_delivered,
       sum(d.fp_delivered * coalesce(c.price_per_fp_cents, 0::bigint)::numeric)::bigint as revenue_cents
from finance.fp_delivery d
left join lateral (
  select cc.price_per_fp_cents
  from finance.contract cc
  where cc.project_id = d.project_id
    and date_trunc('month', cc.effective_from::timestamptz) <= d.month
    and (cc.effective_to is null or d.month <= date_trunc('month', cc.effective_to::timestamptz))
  order by cc.effective_from desc
  limit 1
) c on true
group by d.project_id, d.month;
grant select on finance.v_fp_delivery_month to authenticated;

create view finance.v_project_month with (security_invoker = true) as
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
grant select on finance.v_project_month to authenticated;

create view finance.v_org_month with (security_invoker = true) as
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
grant select on finance.v_org_month to authenticated;

commit;
