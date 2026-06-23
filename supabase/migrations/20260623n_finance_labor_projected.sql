-- finance: custo de mão-de-obra PROJETADO (não só realizado-até-hoje).
--
-- Bug (HITz Contrato 2, squad jun→set): membros alocados em meses FUTUROS
-- apareciam R$0 porque `v_member_comp_month` materializa salário recorrente só
-- até `now()` (via v_entry_month → generate_series até now()). Alocação do Victor
-- (jul→set) não tinha salário nos meses futuros → pro-rata × 0 = R$0. Guilherme/
-- Brenda idem nas parcelas de jul/ago/set (só junho contava).
--
-- Decisão do dono: o contrato é um PLANO; o custo dos meses futuros é conhecido
-- (salário mensal vigente × dias planejados). Receita já é projetada (billing_count
-- meses), então o custo também deve ser. `v_allocation_labor_month` passa a
-- calcular a taxa salarial DIRETO das entries (projeta recorrentes pro futuro,
-- sem o teto de now()), gerando os meses a partir da PRÓPRIA alocação.
--
-- v_member_comp_month NÃO muda (segue = comp REALIZADO, usado no teamCost do
-- overview). São métricas distintas: comp pago (realizado) × custo de plano
-- (projetado). Tudo que deriva da base (member/project/contract labor) projeta.
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623n_finance_labor_projected.sql

begin;

create or replace view finance.v_allocation_labor_month with (security_invoker = true) as
with alloc_months as (
  -- cada alocação × cada mês da SUA vigência (não limitado por now()).
  -- Alocação aberta (sem fim) projeta só até now() — não dá pra projetar ∞.
  select
    la.id                                              as allocation_id,
    la.contract_id,
    la.project_id,
    la.member_id,
    la.percent,
    la.effective_from,
    la.effective_to,
    gs::date                                           as month,
    (gs + interval '1 month' - interval '1 day')::date as month_end
  from finance.labor_allocation la
  cross join lateral generate_series(
    date_trunc('month', la.effective_from),
    date_trunc('month', coalesce(la.effective_to, now()::date)),
    '1 month'::interval
  ) gs
),
rate as (
  -- taxa salarial mensal do membro NAQUELE mês, das entries feeds_labor.
  -- Projeta recorrentes pro futuro (ativo se a vigência da entry cobre o mês);
  -- pontual conta no mês do occurred_on. NÃO depende de now() (≠ v_member_comp_month).
  select
    am.allocation_id,
    am.month,
    sum(case when e.recurrence = 'annual' then e.amount_cents / 12 else e.amount_cents end)::bigint as comp_cents
  from alloc_months am
  join finance.entry e      on e.member_id = am.member_id
  join finance.category cat on cat.id = e.category_id and cat.feeds_labor
  where (
    (e.recurrence <> 'once'
      and e.effective_from <= am.month_end
      and (e.effective_to is null or e.effective_to >= am.month))
    or
    (e.recurrence = 'once' and e.occurred_on between am.month and am.month_end)
  )
  group by am.allocation_id, am.month
)
select
  am.allocation_id,
  am.contract_id,
  am.project_id,
  am.member_id,
  am.month,
  round(
    coalesce(r.comp_cents, 0)
    * (am.percent / 100.0)
    * ((least(coalesce(am.effective_to, am.month_end), am.month_end)
        - greatest(am.effective_from, am.month)
        + 1)::numeric / extract(day from am.month_end)::numeric)
  )::bigint as labor_cents
from alloc_months am
left join rate r on r.allocation_id = am.allocation_id and r.month = am.month
where coalesce(r.comp_cents, 0) > 0;

grant select on finance.v_allocation_labor_month to authenticated;

commit;
