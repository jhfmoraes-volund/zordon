-- Migration: MeetingTaskAction.meetingId tornar-se nullable
-- Necessário para ações criadas pelo contexto de PlanningCeremony,
-- onde a ação não está vinculada a uma Meeting específica.
-- Constraint NOT NULL -> NULL; FK permanece (ON DELETE SET NULL).

ALTER TABLE "MeetingTaskAction"
  DROP CONSTRAINT IF EXISTS "MeetingTaskAction_meetingId_fkey";

ALTER TABLE "MeetingTaskAction"
  ALTER COLUMN "meetingId" DROP NOT NULL;

ALTER TABLE "MeetingTaskAction"
  ADD CONSTRAINT "MeetingTaskAction_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES public."Meeting"(id) ON DELETE SET NULL;
