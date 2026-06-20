-- 20260620_planning_event_task.sql
-- Planning Vivo Versionado — snapshot COMPLETO de tasks por versão.
-- § docs/runbooks/planning-versioned-living-runbook.md §6 (D8)
--
-- Child table de PlanningEvent, SEM jsonb (padrão SQL-first do projeto). Uma
-- linha por Task do projeto no instante do "Aplicar" — o board exato daquela
-- versão. É o que o "canvas histórico" renderiza e o pré-requisito do futuro
-- "restaurar versão".
--
-- DENORMALIZADO de propósito: `title`/`status`/`sprintLabel`/`functionPoints`/
-- `assignees` são CÓPIAS imutáveis. Sobrevivem a delete/rename de Task e Sprint —
-- por isso `taskId` e `sprintId` NÃO têm FK (chip histórico nunca aponta pra FK
-- viva, senão "muda o passado", §5.3 do runbook).

BEGIN;

CREATE TABLE IF NOT EXISTS "PlanningEventTask" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planningEventId" uuid NOT NULL REFERENCES "PlanningEvent"(id) ON DELETE CASCADE,
  "taskId" uuid,                      -- snapshot, SEM FK (task pode ser deletada)
  "reference" text,
  "title" text NOT NULL,
  "status" text NOT NULL,
  "sprintId" uuid,                    -- snapshot, SEM FK (sprint pode mudar/sumir)
  "sprintLabel" text NOT NULL,        -- denormalizado, imutável
  "functionPoints" int,
  "assignees" text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_planning_event_task_event
  ON "PlanningEventTask"("planningEventId");

-- ============================================================
-- RLS — projectId vem via join PlanningEvent → PlanningSession.
-- Append-only: sem UPDATE/DELETE (CASCADE do PlanningEvent cuida do cleanup).
-- ============================================================
ALTER TABLE "PlanningEventTask" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planning_event_task_read ON "PlanningEventTask";
CREATE POLICY planning_event_task_read ON "PlanningEventTask"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "PlanningEvent" pe
      JOIN "PlanningSession" ps ON ps.id = pe."planningSessionId"
      WHERE pe.id = "PlanningEventTask"."planningEventId"
        AND can_view_project(ps."projectId")
    )
  );

DROP POLICY IF EXISTS planning_event_task_insert ON "PlanningEventTask";
CREATE POLICY planning_event_task_insert ON "PlanningEventTask"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "PlanningEvent" pe
      JOIN "PlanningSession" ps ON ps.id = pe."planningSessionId"
      WHERE pe.id = "PlanningEventTask"."planningEventId"
        AND can_edit_project(ps."projectId")
    )
  );

COMMIT;
