-- Sync existing inception design sessions to the new totalSteps after adding
-- the "Riscos & Lacunas" (risks_gaps) step at index 5, between brainstorm and prioritization.
-- New sessions are created with totalSteps=10 by the API; this fixes pre-existing rows.

UPDATE "DesignSession"
SET "totalSteps" = 10
WHERE type = 'inception'
  AND "totalSteps" < 10;
