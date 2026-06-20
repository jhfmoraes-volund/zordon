-- 20260620a_planning_session_singleton.sql
-- Enforce TRUE singleton: 1 PlanningSession ATIVA por projeto.
--
-- A constraint original (`one_active_planning_per_project`, EXCLUDE gist em
-- projectId WITH =, status WITH <>) tinha um furo: ela só conflitava linhas com
-- status DIFERENTES (ex.: draft + in-review), deixando passar DUAS 'draft' no
-- mesmo projeto. Resultado prático: dava pra criar 2 Release Plannings vazias e
-- a 2ª ofuscava a real (bug observado na SILFAE, 2026-06-20).
--
-- Troca pela garantia certa: índice único PARCIAL em projectId nos status ativos
-- — impede QUALQUER 2ª planning viva, independente do status.
--
-- PRÉ-REQUISITO: violações já limpas (a SILFAE tinha 2 'draft'; a vazia foi
-- removida antes desta migration). CREATE UNIQUE INDEX falha se houver violação.

BEGIN;

ALTER TABLE "PlanningSession"
  DROP CONSTRAINT IF EXISTS one_active_planning_per_project;

CREATE UNIQUE INDEX IF NOT EXISTS planning_session_one_active_per_project
  ON "PlanningSession"("projectId")
  WHERE status IN ('draft', 'orchestrating', 'in-review');

COMMIT;
