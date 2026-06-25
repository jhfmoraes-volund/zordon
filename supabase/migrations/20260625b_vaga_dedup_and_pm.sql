-- ═══════════════════════════════════════════════════════════════════════════
-- Limpeza estrutural pro modelo "vaga = fonte única":
--   1. DEDUP — remove ocupações standing ATIVAS que se sobrepõem ao mesmo
--      (contrato, membro). Ninguém ocupa a mesma função 2× ao mesmo tempo →
--      a sobreposição é erro (a duplicata do Guilherme/Brenda). HARD DELETE
--      (não é movimentação real → não vai pro log/histórico).
--   2. VAGA-IZA — toda ocupação standing ATIVA sem vaga vira uma vaga (incl. PM
--      como position='pm', sem caso especial). A vaga herda a vigência do
--      contrato (clamp do início ao contrato; fim = fim do contrato).
--
-- NÃO TOCA: alocações project-level (contract_id NULL) — são legítimas (pessoa
-- em N projetos), não duplicata. Nem períodos encerrados no passado (história).
--
-- Atômico, idempotente (re-rodar não recria nada — órfãos já têm vaga).
-- Rodar: psql "$DIRECT_URL" -f supabase/migrations/20260625b_vaga_dedup_and_pm.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. DEDUP — overlaps ativos do mesmo (contrato, membro) ──────────────────
with ranked as (
  select la.id, la.contract_id, la.member_id, la.effective_from, la.effective_to,
         row_number() over (
           partition by la.contract_id, la.member_id
           order by (la.effective_to is null) desc, la.effective_from, la.created_at
         ) as rn
  from finance.labor_allocation la
  where la.contract_id is not null
    and la.kind = 'standing'
    and la.voided_at is null
    and (la.effective_to is null or la.effective_to >= current_date)
),
keep as (select * from ranked where rn = 1),
dup as (
  select r.id
  from ranked r
  join keep k on k.contract_id = r.contract_id and k.member_id = r.member_id
  where r.rn > 1
    -- sobreposição de [from, to||∞): r.from ≤ k.to  AND  k.from ≤ r.to
    and r.effective_from <= coalesce(k.effective_to, 'infinity'::date)
    and k.effective_from <= coalesce(r.effective_to, 'infinity'::date)
)
delete from finance.labor_allocation where id in (select id from dup);

-- ── 2. VAGA-IZA — órfãos ativos viram vagas (incl. PM) ──────────────────────
with orphans as (
  select la.id as alloc_id, la.contract_id, m."position" as position, la.effective_from,
         row_number() over (
           partition by la.contract_id, m."position"
           order by la.effective_from, la.id
         ) as rn
  from finance.labor_allocation la
  join public."Member" m on m.id = la.member_id
  where la.contract_id is not null
    and la.kind = 'standing'
    and la.voided_at is null
    and la.vaga_id is null
    and (la.effective_to is null or la.effective_to >= current_date)
    and m."position" in ('ceo','cro','head-ops','pm','principal-engineer','product-builder')
),
seqd as (
  select o.*, coalesce(b.base_seq, 0) + o.rn as target_seq
  from orphans o
  left join (
    select contract_id, position, max(seq) as base_seq
    from finance.contract_vaga group by contract_id, position
  ) b on b.contract_id = o.contract_id and b.position = o.position
),
ins as (
  insert into finance.contract_vaga (contract_id, position, seq, effective_from, effective_to, created_by)
  select s.contract_id, s.position, s.target_seq,
         greatest(s.effective_from, c.effective_from), c.effective_to, null
  from seqd s
  join finance.contract c on c.id = s.contract_id
  returning id, contract_id, position, seq
)
update finance.labor_allocation la
   set vaga_id = ins.id
  from seqd s
  join ins on ins.contract_id = s.contract_id and ins.position = s.position and ins.seq = s.target_seq
 where la.id = s.alloc_id;

commit;

-- down (parcial — o dedup é destrutivo e não reverte):
--   update finance.labor_allocation set vaga_id = null
--     where vaga_id in (select id from finance.contract_vaga where created_by is null);
--   delete from finance.contract_vaga where created_by is null;
