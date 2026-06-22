-- finance: contrato TEMPORAL — N contratos por projeto, cada um com vigência.
-- Permite que sprints diferentes do mesmo projeto rodem sob contratos diferentes
-- (ex.: HITz sprints 1-3 sob contrato A, 4+ sob contrato B com outras condições:
-- mensalidade, composição de time, margem, preço/FP).
-- Substitui o modelo 1-contrato-por-projeto de 20260623c (tabela criada vazia,
-- então sem backfill de linhas). A fronteira entre contratos é autorada por
-- sprint na UI (effective_from = startDate da sprint) mas guardada por DATA, pra
-- que entries (faturamento, date-stamped) e fp_delivery (month) atribuam sozinhos
-- ao contrato vigente, sem FK cruzada public.Sprint → finance.
-- Ver docs/features/finance/pricing-pnl-model.md.
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623d_finance_contract_temporal.sql

begin;

-- 1. fim do "1 contrato por projeto" — agora N por projeto
alter table finance.contract drop constraint if exists contract_project_id_key;

-- 2. vigência + termos por contrato. billing_type pode mudar entre contratos
--    (squad → encomenda). monthly_fee_cents é informativo (mensalidade squad);
--    a receita realizada de squad continua vindo de entries (faturamento).
--    Tabela está vazia → NOT NULL direto, sem default transitório.
alter table finance.contract
  add column label             text   not null,
  add column seq               int    not null,
  add column effective_from    date   not null,
  add column effective_to      date,
  add column billing_type      text   not null,
  add column monthly_fee_cents bigint;

alter table finance.contract
  add constraint contract_billing_type_chk check (billing_type in ('squad', 'fixed_scope')),
  add constraint contract_period_chk       check (effective_to is null or effective_to >= effective_from),
  add constraint contract_monthly_fee_chk  check (monthly_fee_cents is null or monthly_fee_cents >= 0);

create index contract_project_period_idx on finance.contract (project_id, effective_from);

-- 3. v_fp_delivery_month: receita usa o preço/FP do contrato cuja vigência
--    contém o mês da entrega. O lateral pega exatamente UM contrato por linha
--    (o de effective_from mais recente que começa até o mês), evitando dupla
--    contagem se duas vigências encostarem no mesmo mês de calendário.
--    Mesmas colunas/ordem da view anterior → replace sem dropar dependentes
--    (v_project_month / v_org_month consomem esta).
create or replace view finance.v_fp_delivery_month with (security_invoker = true) as
select d.project_id,
       d.month,
       sum(d.fp_delivered)                                              as fp_delivered,
       sum(d.fp_delivered * coalesce(c.price_per_fp_cents, 0))::bigint  as revenue_cents
from finance.fp_delivery d
left join lateral (
  select cc.price_per_fp_cents
  from finance.contract cc
  where cc.project_id = d.project_id
    and date_trunc('month', cc.effective_from) <= d.month
    and (cc.effective_to is null or d.month <= date_trunc('month', cc.effective_to))
  order by cc.effective_from desc
  limit 1
) c on true
group by d.project_id, d.month;

commit;
