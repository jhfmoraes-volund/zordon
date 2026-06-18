-- Companion PlanningCeremony para um Release Planning (PlanningSession).
--
-- Unifica o /planning: a sessão de Release Planning (board de PRDs) passa a
-- hospedar TAMBÉM staging de tasks/stories. Em vez de ensinar PlanningSession a
-- gerir MeetingTaskAction/PlanningContextNote, ligamos cada sessão a uma
-- PlanningCeremony "headless" (sprintId NULL — multi-sprint via targetSprintId
-- por ação) e reusamos toda a máquina já testada da Sprint Planning
-- (propose_task_action, notas, apply via task-action-executor, endpoints de
-- approve/complete). 1 sessão → 0/1 cerimônia companion.
--
-- A cerimônia companion não aparece como Sprint Planning na UI (sprintId NULL).
-- O UNIQUE (projectId, sprintId) trata NULLs como distintos, então várias
-- companions sprint-less coexistem sem colidir.

ALTER TABLE "PlanningSession"
  ADD COLUMN IF NOT EXISTS "planningCeremonyId" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PlanningSession_planningCeremonyId_fkey'
  ) THEN
    ALTER TABLE "PlanningSession"
      ADD CONSTRAINT "PlanningSession_planningCeremonyId_fkey"
      FOREIGN KEY ("planningCeremonyId")
      REFERENCES "PlanningCeremony"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- 1 cerimônia companion por sessão (e vice-versa).
CREATE UNIQUE INDEX IF NOT EXISTS "PlanningSession_planningCeremonyId_key"
  ON "PlanningSession" ("planningCeremonyId")
  WHERE "planningCeremonyId" IS NOT NULL;
