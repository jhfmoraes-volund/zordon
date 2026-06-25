-- ═══════════════════════════════════════════════════════════════════════════
-- Camada de leitura das vagas (3 views): custo por vaga + previsto × preenchido.
--
-- NÃO recria nenhuma view de custo existente — só ADICIONA leafs que derivam
-- delas. v_vaga_labor_month herda pró-rata, projeção LOCF e exclusão de void de
-- graça (vem de v_allocation_labor_month). GRANT explícito em cada (o grant some
-- em DROP+CREATE; aqui é CREATE novo, então grant na hora).
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624z_vaga_views.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Custo por vaga·mês (agrupa o custo pró-rata existente por vaga_id)
create view finance.v_vaga_labor_month with (security_invoker = true) as
select la.vaga_id,
       alm.contract_id,
       alm.project_id,
       alm.member_id,
       alm.month,
       alm.labor_cents
from finance.v_allocation_labor_month alm
join finance.labor_allocation la on la.id = alm.allocation_id
where la.vaga_id is not null;

grant select on finance.v_vaga_labor_month to authenticated;

-- 2) Preenchimento por vaga: tem ocupação ATIVA (não-void, período vigente)?
create view finance.v_contract_vaga_fill with (security_invoker = true) as
with occ as (
  select vaga_id
  from finance.labor_allocation
  where vaga_id is not null
    and voided_at is null
    and (effective_to is null or effective_to >= current_date)
  group by vaga_id
)
select v.id          as vaga_id,
       v.contract_id,
       v.position,
       v.seq,
       v.label,
       (occ.vaga_id is not null) as filled
from finance.contract_vaga v
left join occ on occ.vaga_id = v.id
where v.effective_to is null or v.effective_to >= current_date;  -- vaga ainda demandada

grant select on finance.v_contract_vaga_fill to authenticated;

-- 3) Resumo por contrato (buraco de staffing pro head-ops). NÃO inclui o PM
--    (vaga derivada de Project.pmId, anexada na DAL/UI — não é contract_vaga).
create view finance.v_contract_vaga_summary with (security_invoker = true) as
select contract_id,
       count(*)                           as total_vagas,
       count(*) filter (where filled)      as filled_vagas,
       count(*) filter (where not filled)  as empty_vagas
from finance.v_contract_vaga_fill
group by contract_id;

grant select on finance.v_contract_vaga_summary to authenticated;
