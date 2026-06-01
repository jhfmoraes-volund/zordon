-- Restaura a garantia de unicidade que as link-tables antigas tinham:
-- "no máximo 1 link de um host pra um ref específico".
--
-- NOTA: ContextSource e TranscriptRef COMPARTILHAM ids neste schema — um mesmo
-- host pode legitimamente ter um context link E um transcript link pro mesmo
-- uuid (são links distintos). Por isso a unicidade tem que ser por COLUNA de
-- ref, não por valor coalescido.
--
-- Solução: unique nas 7 colunas com NULLS NOT DISTINCT (PG15+). Como exatamente
-- 1 host e 1 ref estão preenchidos, dois rows só colidem se tiverem o MESMO host
-- E o mesmo ref NA MESMA COLUNA — exatamente a semântica das tabelas antigas.
-- Também habilita ON CONFLICT pra re-sync idempotente no deploy.
CREATE UNIQUE INDEX IF NOT EXISTS entitylink_unique_host_ref ON "EntityLink" (
  "designSessionId", "pmReviewId", "planningCeremonyId", "planningSessionId",
  "contextSourceId", "transcriptRefId", "meetingId"
) NULLS NOT DISTINCT;
-- Rollback: DROP INDEX IF EXISTS entitylink_unique_host_ref;
