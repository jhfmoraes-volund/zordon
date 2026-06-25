-- ═══════════════════════════════════════════════════════════════════════════
-- Conserta DUPLO CUSTO: alocações standing que SE SOBREPÕEM no mesmo (contrato,
-- membro) — incl. as ENCERRADAS/sem-vaga que sobrevivem das antigas. Cada par
-- sobreposto cobra a mesma pessoa 2× no mesmo período → "Equipe" do DRE dobra.
--
-- A migração b só dedupou overlaps ATIVO-ATIVO; faltou o caso "ativa nova (com
-- vaga) × antiga encerrada (sem vaga)". Aqui pega QUALQUER overlap.
--
-- Canônica mantida = a com VAGA, depois aberta, depois início mais cedo. As
-- sobrepostas são apagadas (dup — não é sucessão; sucessão é NÃO-sobreposta).
-- NÃO apaga período passado que NÃO sobrepõe (história real preservada).
--
-- Rodar: psql "$DIRECT_URL" -f supabase/migrations/20260625d_dedup_overlapping_cost.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

with ranked as (
  select la.id, la.contract_id, la.member_id, la.effective_from, la.effective_to,
         row_number() over (
           partition by la.contract_id, la.member_id
           order by (la.vaga_id is not null) desc,   -- com vaga = canônica
                    (la.effective_to is null) desc,   -- aberta antes de encerrada
                    la.effective_from,                -- início mais cedo
                    la.created_at
         ) as rn
  from finance.labor_allocation la
  where la.contract_id is not null
    and la.kind = 'standing'
    and la.voided_at is null
),
keep as (select * from ranked where rn = 1),
dup as (
  select r.id
  from ranked r
  join keep k on k.contract_id = r.contract_id and k.member_id = r.member_id
  where r.rn > 1
    -- sobreposição de [from, to||∞)
    and r.effective_from <= coalesce(k.effective_to, 'infinity'::date)
    and k.effective_from <= coalesce(r.effective_to, 'infinity'::date)
)
delete from finance.labor_allocation where id in (select id from dup);

commit;
