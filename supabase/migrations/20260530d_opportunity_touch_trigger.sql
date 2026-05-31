-- ============================================================================
-- Opportunity — updatedAt trigger
--
-- Trigger BEFORE UPDATE para manter Opportunity.updatedAt sempre fresh.
-- Segue padrão estabelecido em ClientInsight, CsatResponse, etc.
-- ============================================================================

BEGIN;

-- ─── updatedAt trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_opportunity_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END$$;

CREATE TRIGGER trg_opportunity_touch_updated_at
  BEFORE UPDATE ON "Opportunity"
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_opportunity_updated_at();

COMMIT;
