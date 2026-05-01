-- Uma sprint por semana por projeto.
-- Como sprint_week_invariant (CHECK) já garante startDate=segunda + 7 dias,
-- (projectId, startDate) único = (projectId, semana) único.

BEGIN;

-- Limpa duplicata conhecida (Sprint 6 vazio criado em teste no projeto Zordon).
DELETE FROM "Sprint"
WHERE id = 'ca4cf8bb-adc3-4ffb-9a08-1a3936332491';

ALTER TABLE "Sprint"
  ADD CONSTRAINT sprint_unique_week_per_project
  UNIQUE ("projectId", "startDate");

COMMIT;
