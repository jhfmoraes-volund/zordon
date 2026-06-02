-- 20260602b_planning_session_prd_product_requirement.sql
-- Reconciliação de PRD no Release Planning.
--
-- Hoje PlanningSessionPRD é slug-based (cascata lê docs/prd/*.md → prdSlug).
-- O modo conversacional/manual vincula ProductRequirement (output do Vitor, DB).
-- Os dois caminhos COEXISTEM: uma row é backed por slug OU por productRequirementId.

BEGIN;

ALTER TABLE "PlanningSessionPRD"
  ADD COLUMN IF NOT EXISTS "productRequirementId" uuid
    REFERENCES "ProductRequirement"(id) ON DELETE CASCADE;

-- prdSlug deixa de ser obrigatório (rows entity-backed têm slug NULL)
ALTER TABLE "PlanningSessionPRD"
  ALTER COLUMN "prdSlug" DROP NOT NULL;

-- pelo menos uma fonte (slug ou entity)
ALTER TABLE "PlanningSessionPRD"
  DROP CONSTRAINT IF EXISTS "PlanningSessionPRD_source_chk";
ALTER TABLE "PlanningSessionPRD"
  ADD CONSTRAINT "PlanningSessionPRD_source_chk"
  CHECK ("prdSlug" IS NOT NULL OR "productRequirementId" IS NOT NULL);

-- o UNIQUE(planningSessionId, prdSlug) original não tolera slug NULL como
-- garantia de unicidade entity; troca por unique parcial por fonte.
ALTER TABLE "PlanningSessionPRD"
  DROP CONSTRAINT IF EXISTS "PlanningSessionPRD_planningSessionId_prdSlug_key";

CREATE UNIQUE INDEX IF NOT EXISTS "PlanningSessionPRD_session_slug_uq"
  ON "PlanningSessionPRD"("planningSessionId", "prdSlug")
  WHERE "prdSlug" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "PlanningSessionPRD_session_pr_uq"
  ON "PlanningSessionPRD"("planningSessionId", "productRequirementId")
  WHERE "productRequirementId" IS NOT NULL;

COMMIT;
