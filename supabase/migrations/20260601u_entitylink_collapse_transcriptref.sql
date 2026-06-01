-- Colapso da dualidade de ref no EntityLink: transcript e context-source passam a
-- usar UMA coluna só (contextSourceId); transcript vs planilha/github distingue-se
-- por ContextSource.kind. Transcripts JÁ são ContextSource (mesmos ids), então o
-- valor de transcriptRefId é válido como contextSourceId.
--
-- A coluna transcriptRefId fica (vazia) e é dropada na fase de drop, pós-teste.

-- 1. Dedup: se um host já tem um link via contextSourceId pro MESMO ContextSource
--    que um link via transcriptRefId aponta, o de transcriptRefId é duplicata
--    (ContextSource e TranscriptRef compartilham id) → remove. Senão o passo 2
--    violaria o unique (host, ref).
DELETE FROM "EntityLink" e1
WHERE e1."transcriptRefId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "EntityLink" e2
    WHERE e2.id <> e1.id
      AND e2."contextSourceId" = e1."transcriptRefId"
      AND e2."designSessionId"   IS NOT DISTINCT FROM e1."designSessionId"
      AND e2."pmReviewId"        IS NOT DISTINCT FROM e1."pmReviewId"
      AND e2."planningCeremonyId" IS NOT DISTINCT FROM e1."planningCeremonyId"
      AND e2."planningSessionId" IS NOT DISTINCT FROM e1."planningSessionId"
  );

-- 2. Move os sobreviventes: transcriptRefId → contextSourceId.
UPDATE "EntityLink"
SET "contextSourceId" = "transcriptRefId", "transcriptRefId" = NULL
WHERE "transcriptRefId" IS NOT NULL;

-- Rollback: não trivial (perde a distinção de coluna). Restaurar de backup se preciso.
-- Após validação, dropar a coluna: ALTER TABLE "EntityLink" DROP COLUMN "transcriptRefId";
