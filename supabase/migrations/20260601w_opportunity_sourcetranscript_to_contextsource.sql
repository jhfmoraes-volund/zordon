-- PREP pro drop de TranscriptRef: repontar a FK de Opportunity.sourceTranscriptRefId
-- de TranscriptRef -> ContextSource (mesma estratégia da migration `t` pro EntityLink).
--
-- Contexto: ContextSource é o SSOT pós-cutover; TranscriptRef vai ser dropada.
-- A coluna está sempre NULL hoje (0 opportunities a usam) e o nome é mantido pra
-- ZERO mudança de código — só o alvo da FK muda. Renomear pra sourceContextSourceId
-- fica pra um passo cosmético futuro, se quiser.
--
-- Idempotente o suficiente pra rodar uma vez. Roda ANTES dos drops, com a app no ar.

ALTER TABLE "Opportunity"
  DROP CONSTRAINT IF EXISTS "Opportunity_sourceTranscriptRefId_fkey";

ALTER TABLE "Opportunity"
  ADD CONSTRAINT "Opportunity_sourceTranscriptRefId_fkey"
  FOREIGN KEY ("sourceTranscriptRefId")
  REFERENCES "ContextSource"(id)
  ON DELETE SET NULL;
