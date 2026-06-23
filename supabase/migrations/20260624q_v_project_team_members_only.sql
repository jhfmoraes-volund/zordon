-- Coerência do roster (decisão 2026-06-24): EQUIPE = PM (gestor) + Builders alocados
-- (executores). Guest/viewer (ProjectAccess) NÃO é membro — é só visibilidade, fica
-- FORA da equipe. Simplifica o modelo anterior (alocados ∪ acesso-only) e o do PM:
--   - PM entra DERIVADO de Project.pmId (sempre presente, sem depender de ProjectAccess).
--   - Builder entra por labor_allocation vigente (standing/spot).
--   - Sai a perna "access-only" e as colunas source/access_role.
-- Reverte o trigger sync_pm_project_access (PM não entra mais via ProjectAccess).
-- As 4 rows ProjectAccess('lead') de PM da backfill F2.7 ficam (grant de visibilidade
-- RLS, invisível ao roster; PM é manager e enxerga de qualquer jeito).
--
-- v_project_team é folha (0 dependentes) → DROP+CREATE seguro. Gate e escape de
-- service_role preservados.
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624q_v_project_team_members_only.sql

-- 1) Reverter o mecanismo "PM via ProjectAccess" (agora PM deriva na view)
DROP TRIGGER IF EXISTS trg_sync_pm_project_access ON "Project";
DROP FUNCTION IF EXISTS public.sync_pm_project_access();

-- 2) Redefinir a view: membros = PM ∪ builders alocados
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
)
SELECT * FROM team
WHERE auth.uid() IS NULL OR is_admin() OR can_view_project(project_id);

GRANT SELECT ON finance.v_project_team TO authenticated, service_role;
