-- finance: receita de FP atribui SÓ a contrato fixed_scope (encomenda).
-- Bug (reproduzido HITz): em meses onde um contrato squad e um fixed_scope se
-- tocam no granular de mês (Op Especial termina 14/jun, Squad começa 15/jun →
-- ambos "cobrem" junho), o lateral pegava o de effective_from mais recente (o
-- squad, sem preço/FP) e ZERAVA a receita da entrega de FP. Squad não gera
-- receita por FP (gera mensalidade via v_contract_revenue_month), então o FP
-- deve atribuir só ao contrato encomenda que cobre o mês.
-- Colunas inalteradas → create or replace sem dropar v_project_month/v_org_month.
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623k_finance_fp_revenue_fixed_scope_only.sql

begin;

create or replace view finance.v_fp_delivery_month with (security_invoker = true) as
select d.project_id,
       d.month,
       sum(d.fp_delivered)                                                          as fp_delivered,
       sum(d.fp_delivered * coalesce(c.price_per_fp_cents, 0::bigint)::numeric)::bigint as revenue_cents
from finance.fp_delivery d
left join lateral (
  select cc.price_per_fp_cents
  from finance.contract cc
  where cc.project_id = d.project_id
    and cc.billing_type = 'fixed_scope'
    and date_trunc('month', cc.effective_from::timestamptz) <= d.month
    and (cc.effective_to is null or d.month <= date_trunc('month', cc.effective_to::timestamptz))
  order by cc.effective_from desc
  limit 1
) c on true
group by d.project_id, d.month;

commit;
