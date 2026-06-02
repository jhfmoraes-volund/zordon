-- 20260602a_planning_session_scheduled_for.sql
-- Release Planning command center: data agendada de 1ª classe.
-- Antes a rituals route fakeava scheduledFor = createdAt; agora é coluna real,
-- editável pelo ReleasePlanningSheet.

BEGIN;

ALTER TABLE "PlanningSession"
  ADD COLUMN IF NOT EXISTS "scheduledFor" timestamptz;

COMMIT;
