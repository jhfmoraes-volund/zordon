-- ═══════════════════════════════════════════════════════════
-- Member: seniority + dedicationPercent
-- Inputs that feed the suggested capacity calculation.
-- The actual fpCapacity stays as the effective value (override).
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public."Member"
  ADD COLUMN IF NOT EXISTS "seniority" text
    CHECK ("seniority" IS NULL OR "seniority" IN ('junior','mid','senior','principal'));

ALTER TABLE public."Member"
  ADD COLUMN IF NOT EXISTS "dedicationPercent" integer NOT NULL DEFAULT 100
    CHECK ("dedicationPercent" BETWEEN 0 AND 100);

COMMENT ON COLUMN public."Member"."seniority" IS
  'Maturity level used to compute suggested capacity. Null = unset (defaults to mid in calculations).';

COMMENT ON COLUMN public."Member"."dedicationPercent" IS
  'How much of a full-time week the member dedicates to Volund. 100 = full-time.';
