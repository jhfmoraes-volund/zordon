-- ============================================================================
-- ForgeRun cost aggregation fields + specId FK
--
-- Adiciona campos agregados de custo em ForgeRun (somados via trigger de ForgeTask):
-- - costUsdTotal: soma de ForgeTask.costUsd para este run
-- - tokensInTotal: soma de ForgeTask.tokensIn
-- - tokensOutTotal: soma de ForgeTask.tokensOut
-- - specId: FK para ForgeSpec (de onde veio este run)
-- ============================================================================

BEGIN;

-- Adicionar colunas
ALTER TABLE "ForgeRun"
  ADD COLUMN "specId" uuid REFERENCES "ForgeSpec"(id) ON DELETE SET NULL,
  ADD COLUMN "costUsdTotal" numeric(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "tokensInTotal" int NOT NULL DEFAULT 0,
  ADD COLUMN "tokensOutTotal" int NOT NULL DEFAULT 0;

-- Índice para lookup de runs por spec
CREATE INDEX "ForgeRun_spec_idx" ON "ForgeRun"("specId", "createdAt" DESC);

COMMIT;
