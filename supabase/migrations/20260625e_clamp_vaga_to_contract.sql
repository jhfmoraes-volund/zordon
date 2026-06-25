-- ═══════════════════════════════════════════════════════════════════════════
-- Normaliza vagas pra dentro da vigência do contrato (invariante vaga ⊆ contrato).
-- 1 vaga do 1º backfill (20260625a) ficou com início antes do contrato (usava o
-- effective_from da alocação sem clampar). Os backfills seguintes já clampavam;
-- isto cobre o resíduo. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

update finance.contract_vaga v
   set effective_from = greatest(v.effective_from, c.effective_from),
       effective_to   = case
                          when c.effective_to is not null and v.effective_to is not null
                          then least(v.effective_to, c.effective_to)
                          else v.effective_to
                        end,
       updated_at = now()
  from finance.contract c
 where c.id = v.contract_id
   and (v.effective_from < c.effective_from
        or (c.effective_to is not null and v.effective_to is not null and v.effective_to > c.effective_to));
