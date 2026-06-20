-- 20260619b_planning_event_sprint.sql
-- Planning Vivo Versionado — Fase 1 (Log): snapshot de FP por sprint.
-- § docs/runbooks/planning-versioned-living-runbook.md §6 (D8)
--
-- Child table de PlanningEvent, SEM jsonb (padrão SQL-first do projeto).
-- Snapshot CUMULATIVO (não delta): o estado do plano no instante do apply —
-- soma de FP das Task do projeto agrupadas por sprint.
--
-- sprintLabel é DENORMALIZADO de propósito: sobrevive a delete/rename do Sprint
-- (FK ON DELETE SET NULL). Chip histórico = texto imutável; nunca aponta pra FK
-- viva (senão "muda o passado", §5.3 do runbook).

BEGIN;

CREATE TABLE IF NOT EXISTS "PlanningEventSprint" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planningEventId" uuid NOT NULL REFERENCES "PlanningEvent"(id) ON DELETE CASCADE,
  "sprintId" uuid REFERENCES "Sprint"(id) ON DELETE SET NULL, -- null = backlog/não-agendado
  "sprintLabel" text NOT NULL,
  "fpTotal" int NOT NULL DEFAULT 0,
  "taskCount" int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_planning_event_sprint_event
  ON "PlanningEventSprint"("planningEventId");

-- ============================================================
-- RLS — projectId vem via join PlanningEvent → PlanningSession.
-- Append-only: sem UPDATE/DELETE (CASCADE do PlanningEvent cuida do cleanup).
-- ============================================================
ALTER TABLE "PlanningEventSprint" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planning_event_sprint_read ON "PlanningEventSprint";
CREATE POLICY planning_event_sprint_read ON "PlanningEventSprint"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "PlanningEvent" pe
      JOIN "PlanningSession" ps ON ps.id = pe."planningSessionId"
      WHERE pe.id = "PlanningEventSprint"."planningEventId"
        AND can_view_project(ps."projectId")
    )
  );

DROP POLICY IF EXISTS planning_event_sprint_insert ON "PlanningEventSprint";
CREATE POLICY planning_event_sprint_insert ON "PlanningEventSprint"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "PlanningEvent" pe
      JOIN "PlanningSession" ps ON ps.id = pe."planningSessionId"
      WHERE pe.id = "PlanningEventSprint"."planningEventId"
        AND can_edit_project(ps."projectId")
    )
  );

COMMIT;
