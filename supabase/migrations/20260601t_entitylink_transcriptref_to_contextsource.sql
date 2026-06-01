-- Fase 4 da unificação: reaponta a FK EntityLink.transcriptRefId de TranscriptRef
-- → ContextSource. Transcripts SÃO ContextSource (mesmos ids), então os valores
-- existentes continuam válidos. Mantém o NOME da constraint pra os embeds PostgREST
-- (hint `ContextSource!EntityLink_transcriptRefId_fkey`) seguirem resolvendo.
-- Coluna e CHECK (entitylink_one_ref) inalterados — só o alvo da FK muda.

ALTER TABLE "EntityLink" DROP CONSTRAINT "EntityLink_transcriptRefId_fkey";
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_transcriptRefId_fkey"
  FOREIGN KEY ("transcriptRefId") REFERENCES "ContextSource"(id) ON DELETE CASCADE;

-- Rollback: ALTER TABLE "EntityLink" DROP CONSTRAINT "EntityLink_transcriptRefId_fkey";
--   ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_transcriptRefId_fkey"
--   FOREIGN KEY ("transcriptRefId") REFERENCES "TranscriptRef"(id) ON DELETE CASCADE;
