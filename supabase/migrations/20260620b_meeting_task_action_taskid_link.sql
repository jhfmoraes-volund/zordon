-- 20260620b_meeting_task_action_taskid_link.sql
-- Permite que uma MeetingTaskAction type='create' carregue o taskId da task que
-- criou, UMA VEZ aplicada (execution='applied') — pra trilha de auditoria
-- proposta→task (AgentProposalOutcome, versionamento da planning).
--
-- A constraint original (`MeetingTaskAction_taskId_consistency`) exigia
-- `type='create' → taskId IS NULL` SEMPRE, então o link de taskId no fim de
-- applyCreate sempre violava o CHECK e falhava silencioso (erro engolido). Bug
-- latente desde que a constraint existe: create aplicado ficava com taskId null.
--
-- Reformulação (mais limpa, mesmo intento + escape pós-apply pra create):
--   • applied (qualquer type)        → taskId livre (linkagem já aconteceu)
--   • pending/etc create             → taskId NULL (proposta não referencia task)
--   • pending/etc update/move/delete → taskId NOT NULL (referencia task existente)
--
-- Seguro p/ dados existentes: todo create atual tem taskId NULL (a constraint
-- velha forçava) → satisfaz a nova (mais frouxa). Relaxar nunca quebra o que já está.

BEGIN;

ALTER TABLE "MeetingTaskAction"
  DROP CONSTRAINT IF EXISTS "MeetingTaskAction_taskId_consistency";

ALTER TABLE "MeetingTaskAction"
  ADD CONSTRAINT "MeetingTaskAction_taskId_consistency" CHECK (
    execution = 'applied'
    OR (type = 'create' AND "taskId" IS NULL)
    OR (type <> 'create' AND "taskId" IS NOT NULL)
  );

COMMIT;
