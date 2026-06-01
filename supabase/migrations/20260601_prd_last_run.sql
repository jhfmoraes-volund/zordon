-- ProductRequirement: persistent last-run state
--
-- Bug B fix: kanban "esquece" PRDs concluídos quando um novo run não os inclui
-- no manifest. Solução: persistir lastRunId/lastRunStatus/lastRunFinishedAt em
-- ProductRequirement, mantido em sincronia por trigger AFTER UPDATE em
-- ForgeRun.status. ForgeRun continua canônico (event log imutável); estes
-- campos são uma projeção materializada pra consulta rápida e auditoria.

BEGIN;

-- 1. Colunas novas em ProductRequirement
ALTER TABLE "ProductRequirement"
  ADD COLUMN IF NOT EXISTS "lastRunId" uuid REFERENCES "ForgeRun"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "lastRunStatus" text
    CHECK ("lastRunStatus" IS NULL OR "lastRunStatus" IN ('done','error','aborted')),
  ADD COLUMN IF NOT EXISTS "lastRunFinishedAt" timestamptz;

CREATE INDEX IF NOT EXISTS "ProductRequirement_lastRunFinishedAt_idx"
  ON "ProductRequirement" ("lastRunFinishedAt" DESC);

-- 2. Função do trigger
CREATE OR REPLACE FUNCTION update_prd_last_run() RETURNS TRIGGER AS $$
BEGIN
  -- Só age na transição pra estado terminal.
  IF NEW.status IN ('done','error','aborted')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE "ProductRequirement" pr
    SET "lastRunId" = NEW.id,
        "lastRunStatus" = NEW.status,
        "lastRunFinishedAt" = COALESCE(NEW."endedAt", NOW())
    WHERE pr."projectId" = NEW."projectId"
      AND pr.reference IN (
        SELECT prd->>'reference'
        FROM jsonb_array_elements(NEW.manifest->'prds') AS prd
        WHERE prd ? 'reference'
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger AFTER UPDATE em ForgeRun.status
DROP TRIGGER IF EXISTS trg_forge_run_last_run ON "ForgeRun";
CREATE TRIGGER trg_forge_run_last_run
  AFTER UPDATE OF status ON "ForgeRun"
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION update_prd_last_run();

-- 4. Backfill: pra cada PRD, pega o run terminal mais recente que o cobriu.
WITH ranked AS (
  SELECT
    fr."projectId",
    p->>'reference' AS reference,
    fr.id AS run_id,
    fr.status AS run_status,
    fr."endedAt" AS ended_at,
    fr."createdAt" AS created_at,
    ROW_NUMBER() OVER (
      PARTITION BY fr."projectId", p->>'reference'
      ORDER BY fr."createdAt" DESC
    ) AS rn
  FROM "ForgeRun" fr
  CROSS JOIN LATERAL jsonb_array_elements(fr.manifest->'prds') AS p
  WHERE fr.status IN ('done','error','aborted')
    AND p ? 'reference'
)
UPDATE "ProductRequirement" pr
SET "lastRunId" = ranked.run_id,
    "lastRunStatus" = ranked.run_status,
    "lastRunFinishedAt" = COALESCE(ranked.ended_at, ranked.created_at)
FROM ranked
WHERE ranked.rn = 1
  AND pr."projectId" = ranked."projectId"
  AND pr.reference = ranked.reference;

COMMIT;
