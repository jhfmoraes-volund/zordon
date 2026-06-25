-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill: liga as alocações ATIVAS existentes a vagas inferidas (atômico,
-- idempotente, reversível).
--
-- Por contrato SEM vagas: agrupa as alocações standing ativas não-void pelo
-- Member.position do ocupante → cria 1 vaga por (contract, position, seq) →
-- seta vaga_id. seq = row_number por effective_from ("2 Builders" → seq 1,2).
--
-- EXCLUSÕES:
--   • a alocação do PM (member = Project.pmId) — o PM é vaga DERIVADA de pmId,
--     não contract_vaga (evita duplicar). O custo do PM continua via a própria
--     labor_allocation (achada por member_id=pmId em listVagas).
--   • contract_id NULL (vaga exige contrato), spot (pessoa-ad-hoc), voided.
--
-- created_by=null marca as vagas de backfill (reversibilidade).
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260625a_backfill_vagas.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

with active as (
  select la.id as alloc_id,
         la.contract_id,
         m."position" as position,
         la.effective_from,
         row_number() over (
           partition by la.contract_id, m."position"
           order by la.effective_from, la.id
         ) as seq
  from finance.labor_allocation la
  join public."Member" m on m.id = la.member_id
  where la.contract_id is not null
    and la.vaga_id is null
    and la.voided_at is null
    and la.kind = 'standing'
    and (la.effective_to is null or la.effective_to >= current_date)
    -- não cria vaga pro PM (derivado de pmId)
    and not exists (
      select 1 from public."Project" p
      where p.id = la.project_id and p."pmId" = la.member_id
    )
    -- só contratos que ainda não têm nenhuma vaga (idempotência)
    and not exists (
      select 1 from finance.contract_vaga v where v.contract_id = la.contract_id
    )
),
ins as (
  insert into finance.contract_vaga (contract_id, position, seq, effective_from, created_by)
  select contract_id, position, seq, effective_from, null
  from active
  returning id, contract_id, position, seq
)
update finance.labor_allocation la
   set vaga_id = ins.id
  from active a
  join ins on ins.contract_id = a.contract_id
          and ins.position = a.position
          and ins.seq = a.seq
 where la.id = a.alloc_id;

commit;

-- down:
--   update finance.labor_allocation set vaga_id = null
--     where vaga_id in (select id from finance.contract_vaga where created_by is null);
--   delete from finance.contract_vaga where created_by is null;
