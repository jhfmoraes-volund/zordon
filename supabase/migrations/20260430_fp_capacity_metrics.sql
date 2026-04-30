-- Unifica métricas de capacity em sprint_member_capacity:
--   fp_planned (status <> 'backlog')          ← métrica primária
--   fp_done    (status = 'done')              ← entregue
--   fp_open    (status IN open_statuses)      ← carga em aberto (= antigo fp_used)
--
-- Invariante: fp_planned = fp_done + fp_open (assumindo todos os status em
-- {backlog, todo, in_progress, review, changes_requested, done}).
--
-- Reescreve com LATERAL + FILTER pra agregar num único scan por par (sprint, member),
-- em vez de 3 subselects correlacionados.

DROP VIEW IF EXISTS sprint_capacity_overview CASCADE;
DROP VIEW IF EXISTS sprint_member_capacity CASCADE;

CREATE VIEW sprint_member_capacity AS
SELECT
  s.id                                                AS "sprintId",
  pm."memberId",
  m.name                                              AS member_name,
  s."projectId",
  COALESCE(sm."fpAllocation", pm."fpAllocation")::int AS fp_allocation,
  COALESCE(agg.fp_planned, 0)::int                    AS fp_planned,
  COALESCE(agg.fp_done, 0)::int                       AS fp_done,
  COALESCE(agg.fp_open, 0)::int                       AS fp_open,
  (sm."fpAllocation" IS NOT NULL)                     AS has_sprint_override
FROM "Sprint" s
JOIN "ProjectMember" pm ON pm."projectId" = s."projectId"
JOIN "Member" m ON m.id = pm."memberId"
LEFT JOIN "SprintMember" sm
  ON sm."sprintId" = s.id AND sm."memberId" = pm."memberId"
LEFT JOIN LATERAL (
  SELECT
    SUM(t."functionPoints") FILTER (WHERE t.status <> 'backlog')                               AS fp_planned,
    SUM(t."functionPoints") FILTER (WHERE t.status = 'done')                                   AS fp_done,
    SUM(t."functionPoints") FILTER (
      WHERE t.status IN ('todo', 'in_progress', 'review', 'changes_requested')
    )                                                                                          AS fp_open
  FROM "Task" t
  JOIN "TaskAssignment" ta ON ta."taskId" = t.id
  WHERE t."sprintId" = s.id AND ta."memberId" = pm."memberId"
) agg ON true;

GRANT SELECT ON sprint_member_capacity TO service_role, authenticated;

COMMENT ON VIEW sprint_member_capacity IS
  'Capacity por (sprint, member). fp_planned = todos status exceto backlog. fp_done = done. fp_open = todo+in_progress+review+changes_requested. Invariante: fp_planned = fp_done + fp_open.';

-- sprint_capacity_overview: agrega por sprint a partir da view acima.
-- capacity = soma de fp_allocation (contrato efetivo dos membros do projeto, com override).
-- planned/done/open = soma das métricas correspondentes.
CREATE VIEW sprint_capacity_overview AS
SELECT
  "sprintId",
  SUM(fp_allocation)::int AS capacity,
  SUM(fp_planned)::int    AS planned,
  SUM(fp_done)::int       AS done,
  SUM(fp_open)::int       AS open
FROM sprint_member_capacity
GROUP BY "sprintId";

GRANT SELECT ON sprint_capacity_overview TO service_role, authenticated;

COMMENT ON VIEW sprint_capacity_overview IS
  'Agregação por sprint de sprint_member_capacity. capacity = Σ fp_allocation (contrato). planned/done/open = Σ das métricas correspondentes.';
