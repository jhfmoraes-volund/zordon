-- ═══════════════════════════════════════════════════════════════════════════
-- Exclui membros DESATIVADOS (deactivatedAt IS NOT NULL) do roster do projeto.
--
-- Depende de 20260624r (colunas de desativação). Recria finance.v_project_team
-- idêntica à 20260624q, adicionando o filtro m."deactivatedAt" IS NULL no CTE
-- `team`. Não toca em labor_allocation: as rows ficam intactas, então REATIVAR
-- traz o membro de volta aos mesmos projetos (reversível).
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624s_v_project_team_exclude_inactive.sql
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS finance.v_project_team;

CREATE VIEW finance.v_project_team AS
WITH allocated AS (
  SELECT DISTINCT ON (la.project_id, la.member_id)
    la.project_id,
    la.member_id,
    la.contract_id,
    la.kind,
    la.percent,
    la.days
  FROM finance.labor_allocation la
  WHERE la.effective_to IS NULL OR la.effective_to >= current_date
  ORDER BY la.project_id, la.member_id, (la.kind = 'standing') DESC, la.effective_from DESC
),
member_ids AS (
  -- PM (gestor): sempre membro, derivado do projeto
  SELECT id AS project_id, "pmId" AS member_id FROM "Project" WHERE "pmId" IS NOT NULL
  UNION
  -- Builders (executores): membros por estarem alocados
  SELECT project_id, member_id FROM allocated
),
team AS (
  SELECT
    mi.project_id,
    mi.member_id,
    m."userId"            AS user_id,
    m.name,
    m.role,
    m."position",
    m."fpCapacity"        AS fp_capacity,
    m."dedicationPercent" AS dedication_percent,
    m."isExternal"        AS is_external,
    (mi.member_id = p."pmId") AS is_pm,
    pm."fpAllocation"     AS fp_allocation,
    a.kind,
    a.percent,
    a.days,
    a.contract_id
  FROM member_ids mi
    JOIN "Member" m  ON m.id = mi.member_id
    JOIN "Project" p ON p.id = mi.project_id
    LEFT JOIN allocated a       ON a.project_id = mi.project_id AND a.member_id = mi.member_id
    LEFT JOIN "ProjectMember" pm ON pm."projectId" = mi.project_id AND pm."memberId" = mi.member_id
  WHERE m."deactivatedAt" IS NULL   -- membro desativado sai do roster
)
SELECT * FROM team
WHERE auth.uid() IS NULL OR is_admin() OR can_view_project(project_id);

GRANT SELECT ON finance.v_project_team TO authenticated, service_role;
