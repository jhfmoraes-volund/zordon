-- View sprint_delivery_overview — base da métrica project.delivery_rate
-- ("entregou X% do planejado") e das cores da régua do Overview.
--
-- Por que não reaproveitar sprint_capacity_overview:
--   1. Ela passa por TaskAssignment — task na sprint SEM dono some do planned
--      (infla a % de entrega justamente no projeto desorganizado).
--   2. Multi-assignee duplica FP no agregado (view é por (sprint, member)).
--   3. Não filtra "dismissedAt" nem status draft.
-- Capacity (Σ fp_allocation) continua na view antiga — alocação é por membro
-- por natureza. Entrega é por task, e nasce aqui, direto da Task.

BEGIN;

CREATE VIEW sprint_delivery_overview AS
SELECT
  t."sprintId",
  COALESCE(SUM(t."functionPoints") FILTER (WHERE t.status NOT IN ('draft', 'backlog')), 0)::int AS planned,
  COALESCE(SUM(t."functionPoints") FILTER (WHERE t.status = 'done'), 0)::int                    AS done,
  COUNT(*) FILTER (
    WHERE t.status NOT IN ('draft', 'backlog') AND COALESCE(t."functionPoints", 0) = 0
  )::int AS tasks_sem_fp
FROM "Task" t
WHERE t."sprintId" IS NOT NULL
  AND t."dismissedAt" IS NULL
GROUP BY t."sprintId";

GRANT SELECT ON sprint_delivery_overview TO service_role, authenticated;

COMMENT ON VIEW sprint_delivery_overview IS
  'Entrega por sprint, direto da Task (sem join de assignment — sem furo de task-sem-dono nem double-count de multi-assignee). planned = Σ FP com status ∉ {draft, backlog}; done = Σ FP done; tasks_sem_fp = tasks planejadas sem FP estimado (sinal de calibração). Sempre dismissedAt IS NULL.';

COMMIT;
