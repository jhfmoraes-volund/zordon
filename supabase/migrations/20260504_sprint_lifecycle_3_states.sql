-- Sprint lifecycle: 3 estados (upcoming / active / completed) com 1 ativa por projeto
-- Plano: docs/sprint-lifecycle-plan.md

BEGIN;

-- 1. Rename planning -> upcoming (mesma semântica, vocabulário alinhado)
UPDATE "Sprint" SET status = 'upcoming' WHERE status = 'planning';

-- 2. Default novo
ALTER TABLE "Sprint" ALTER COLUMN status SET DEFAULT 'upcoming';

-- 3. CHECK: só os 3 valores válidos
ALTER TABLE "Sprint"
  ADD CONSTRAINT sprint_status_valid
  CHECK (status IN ('upcoming', 'active', 'completed'));

-- 4. UNIQUE parcial: no máximo uma active por projeto
CREATE UNIQUE INDEX sprint_one_active_per_project
  ON "Sprint" ("projectId")
  WHERE status = 'active';

COMMIT;
