-- Super Session: design sessions with custom step composition
-- selectedSteps holds the ordered step keys when type = 'super'.
-- For type IN ('inception', 'continuous_improvement') the column is NULL
-- and steps are derived from the preset in src/lib/design-session-steps.ts.

ALTER TABLE "DesignSession"
  ADD COLUMN IF NOT EXISTS "selectedSteps" text[];

COMMENT ON COLUMN "DesignSession"."selectedSteps" IS
  'Ordered step keys when type=super. NULL means preset-by-type. Validated app-side via validateSuperSteps().';
