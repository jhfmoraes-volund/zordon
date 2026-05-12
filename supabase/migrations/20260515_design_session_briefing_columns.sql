-- Briefing metadata: 3 colunas escalares em DesignSession
-- substituem DesignSessionStepData[stepKey=briefing].data.{subPhase,targetStoryId,firstMessageAt}.
-- Tabela legada permanece (escrita ainda pelo Vitor — migração separada).

BEGIN;

ALTER TABLE "DesignSession"
  ADD COLUMN "briefingSubPhase" text
    CHECK ("briefingSubPhase" IS NULL OR "briefingSubPhase" IN
      ('module_discovery','story_tree','story_detail','task_breakdown')),
  ADD COLUMN "briefingTargetStoryId" uuid
    REFERENCES "UserStory"(id) ON DELETE SET NULL,
  ADD COLUMN "briefingFirstMessageAt" timestamptz;

-- Backfill: extrai briefing metadata do JSON legado em rows existentes
UPDATE "DesignSession" ds
SET
  "briefingSubPhase" = NULLIF(sd.data->>'subPhase', ''),
  "briefingTargetStoryId" = CASE
    WHEN sd.data->>'targetStoryId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (sd.data->>'targetStoryId')::uuid
  END,
  "briefingFirstMessageAt" = NULLIF(sd.data->>'firstMessageAt','')::timestamptz
FROM "DesignSessionStepData" sd
WHERE sd."sessionId" = ds.id AND sd."stepKey" = 'briefing';

-- Assertion: a fonte JSON e o destino coluna devem casar em contagem
DO $$
DECLARE n_src int; n_dst int;
BEGIN
  SELECT COUNT(*) INTO n_src
    FROM "DesignSessionStepData"
    WHERE "stepKey"='briefing'
      AND (NULLIF(data->>'subPhase','') IS NOT NULL
        OR NULLIF(data->>'firstMessageAt','') IS NOT NULL
        OR NULLIF(data->>'targetStoryId','') IS NOT NULL);
  SELECT COUNT(*) INTO n_dst FROM "DesignSession"
    WHERE "briefingSubPhase" IS NOT NULL
       OR "briefingFirstMessageAt" IS NOT NULL
       OR "briefingTargetStoryId" IS NOT NULL;
  IF n_dst < n_src THEN
    RAISE EXCEPTION 'briefing backfill mismatch: src=% dst=%', n_src, n_dst;
  END IF;
END $$;

COMMIT;
