-- Project.engagementType — distingue projeto com fim esperado de projeto contínuo.
--
--   fixed_scope → tem prazo previsto de encerramento (endDate = estimativa de fim)
--   continuous  → engajamento contínuo / retainer, sem fim definido
--
-- Antes disso o tipo era só inferido (startDate/endDate null = "em andamento") via um
-- checkbox solto no edit sheet. Aqui vira coluna explícita, decidida pelo PM.

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "engagementType" text NOT NULL DEFAULT 'fixed_scope'
  CHECK ("engagementType" IN ('fixed_scope', 'continuous'));

-- Backfill: sem nenhuma data = contínuo (espelha o antigo checkbox `ongoing`).
UPDATE "Project"
SET "engagementType" = 'continuous'
WHERE "startDate" IS NULL AND "endDate" IS NULL;
