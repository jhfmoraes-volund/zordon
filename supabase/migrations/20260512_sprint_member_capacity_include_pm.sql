-- Inclui PMs na view sprint_member_capacity.
--
-- Contexto: a view antiga só fazia JOIN com ProjectMember, então PMs (que
-- normalmente NÃO têm linha em ProjectMember — a relação vem de Project.pmId)
-- ficavam invisíveis nas métricas por (sprint, member). Resultado: PM com
-- tasks atribuídas via TaskAssignment não aparecia em sprint_member_capacity,
-- e o widget de capacity / WeeklyAllocation / "Por projeto" no /profile e
-- /members/[id] mostrava 0 mesmo com trabalho atribuído.
--
-- Estratégia: UNION ALL.
--   1. Linhas vindas de ProjectMember (comportamento antigo, intacto).
--   2. Linhas vindas de Project.pmId, restritas a PMs que NÃO têm linha em
--      ProjectMember pra evitar duplicação.
--
-- Pra membro PM-only, fp_allocation cai pra Member.fpCapacity (full battery)
-- — mesma cascata usada na página do projeto pra exibir capacity do PM.
-- Quando há SprintMember.fpAllocation explícito pro PM nesse sprint, esse
-- valor ainda tem precedência (override).
--
-- DDL é transacional no Postgres — BEGIN/COMMIT garante que o DROP e o CREATE
-- aconteçam atomicamente, sem janela onde a view "não existe" pra queries
-- concorrentes.

BEGIN;

DROP VIEW IF EXISTS sprint_capacity_overview CASCADE;
DROP VIEW IF EXISTS sprint_member_capacity CASCADE;

CREATE VIEW sprint_member_capacity AS
-- Builders (e qualquer PM que também esteja explícito em ProjectMember).
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
) agg ON true

UNION ALL

-- PMs do projeto SEM ProjectMember explícito. Allocation cai pra fpCapacity.
SELECT
  s.id                                                       AS "sprintId",
  p."pmId"                                                   AS "memberId",
  m.name                                                     AS member_name,
  s."projectId",
  COALESCE(sm."fpAllocation", m."fpCapacity", 0)::int        AS fp_allocation,
  COALESCE(agg.fp_planned, 0)::int                           AS fp_planned,
  COALESCE(agg.fp_done, 0)::int                              AS fp_done,
  COALESCE(agg.fp_open, 0)::int                              AS fp_open,
  (sm."fpAllocation" IS NOT NULL)                            AS has_sprint_override
FROM "Sprint" s
JOIN "Project" p ON p.id = s."projectId"
JOIN "Member" m ON m.id = p."pmId"
LEFT JOIN "SprintMember" sm
  ON sm."sprintId" = s.id AND sm."memberId" = p."pmId"
LEFT JOIN LATERAL (
  SELECT
    SUM(t."functionPoints") FILTER (WHERE t.status <> 'backlog')                               AS fp_planned,
    SUM(t."functionPoints") FILTER (WHERE t.status = 'done')                                   AS fp_done,
    SUM(t."functionPoints") FILTER (
      WHERE t.status IN ('todo', 'in_progress', 'review', 'changes_requested')
    )                                                                                          AS fp_open
  FROM "Task" t
  JOIN "TaskAssignment" ta ON ta."taskId" = t.id
  WHERE t."sprintId" = s.id AND ta."memberId" = p."pmId"
) agg ON true
WHERE p."pmId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ProjectMember" pm
    WHERE pm."projectId" = s."projectId" AND pm."memberId" = p."pmId"
  );

GRANT SELECT ON sprint_member_capacity TO service_role, authenticated;

COMMENT ON VIEW sprint_member_capacity IS
  'Capacity por (sprint, member). Cobre ProjectMember ∪ Project.pmId (PMs sem ProjectMember herdam fpAllocation = Member.fpCapacity). fp_planned = todos status exceto backlog. fp_done = done. fp_open = todo+in_progress+review+changes_requested. Invariante: fp_planned = fp_done + fp_open.';

-- Recria sprint_capacity_overview em cima da view nova.
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

COMMIT;
