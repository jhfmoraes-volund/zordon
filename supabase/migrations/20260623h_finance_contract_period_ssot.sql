-- finance: contrato = SSOT do PERÍODO do projeto.
-- Trigger sincroniza public.Project.startDate/endDate = span dos contratos
-- (min start; max end, ou NULL se algum contrato é vigente/aberto). Os ~66
-- dependentes + geração de sprint continuam lendo Project.* (projeção), sem
-- quebra. Backfill cria 1 contrato-semente por projeto que tem prazo e ainda
-- não tem contrato (HITz excluído — já tem 2). billing_type vem do engagementType.
-- SECURITY DEFINER porque Project tem RLS. Ver pricing-pnl-model.md.
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623h_finance_contract_period_ssot.sql

begin;

create or replace function finance.sync_project_dates_from_contracts()
returns trigger
language plpgsql
security definer
set search_path = public, finance
as $$
declare
  pid uuid := coalesce(new.project_id, old.project_id);
begin
  update public."Project" p
  set "startDate" = sub.mn, "endDate" = sub.mx, "updatedAt" = now()
  from (
    select min(effective_from)::timestamp as mn,
           case when bool_or(effective_to is null) then null
                else max(effective_to)::timestamp end as mx
    from finance.contract
    where project_id = pid
  ) sub
  where p.id = pid
    and exists (select 1 from finance.contract where project_id = pid)
    and (p."startDate" is distinct from sub.mn or p."endDate" is distinct from sub.mx);
  return coalesce(new, old);
end;
$$;

create trigger contract_sync_project_dates
  after insert or update or delete on finance.contract
  for each row execute function finance.sync_project_dates_from_contracts();

-- Backfill: 1 contrato-semente por projeto com prazo e sem contrato.
-- effective_from/to = prazo atual → o trigger ressincroniza pro MESMO valor (no-op).
insert into finance.contract (project_id, label, seq, effective_from, effective_to, billing_type)
select p.id, 'Contrato 1', 1, p."startDate"::date, p."endDate"::date,
       case when p."engagementType" = 'fixed_scope' then 'fixed_scope' else 'squad' end
from public."Project" p
where p."startDate" is not null
  and p."endDate" is not null
  and not exists (select 1 from finance.contract c where c.project_id = p.id);

commit;
