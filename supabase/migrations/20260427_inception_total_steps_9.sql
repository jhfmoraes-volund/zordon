-- Sync existing inception design sessions to the new totalSteps after adding
-- the "É / Não É / Faz / Não Faz" (scope_definition) step at index 2.
-- New sessions are created with totalSteps=9 by the API; this fixes pre-existing rows.

UPDATE "DesignSession"
SET "totalSteps" = 9
WHERE type = 'inception'
  AND "totalSteps" < 9;
