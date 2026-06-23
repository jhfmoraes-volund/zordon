-- finance.v_project_team: leitor canônico do roster do projeto (F2.6).
-- Colapsa os 3 UNIONs divergentes (api members, vitoria, alpha) numa fonte só.
-- Duas pernas (D6–D9):
--   allocated = membros com labor_allocation vigente (effective_to null ou >= hoje),
--               incl. contract_id null (internos); 1 linha por (project, member) via
--               DISTINCT ON (representante: standing > spot, mais recente).
--   access    = ProjectAccess cujo Member.userId NÃO está nos allocated do projeto
--               (guests/viewers + PMs/órfãos backfilled na F2.7). source='access' + role.
-- is_pm derivado (member_id = Project.pmId). fp_allocation = teto PFV (ProjectMember),
-- separado do percent (custo) — D10, não fundir.
-- Squad NÃO entra (pool/contexto, não roster — D9).
--
-- Gating: espelha v_contract_roster (can_view_project OR is_admin) + escape
-- `auth.uid() IS NULL` pro service_role — os 3 readers rodam service_role (sem JWT),
-- e service_role é backend confiável (RLS-bypass, como em src/lib/db.ts). Sem o
-- escape, auth.uid() null ⇒ is_admin()=false e can_view_project()=false ⇒ 0 linhas.
-- service_role não tem USAGE em finance por default; concedido aqui (só esta view).
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624m_v_project_team.sql

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
team AS (
  -- perna allocated (roster de record)
  SELECT
    a.project_id,
    a.member_id,
    m."userId"            AS user_id,
    'allocated'::text     AS source,
    m.name,
    m.role,
    m."position",
    m."fpCapacity"        AS fp_capacity,
    m."dedicationPercent" AS dedication_percent,
    m."isExternal"        AS is_external,
    (a.member_id = p."pmId") AS is_pm,
    pm."fpAllocation"     AS fp_allocation,
    a.kind,
    a.percent,
    a.days,
    a.contract_id,
    NULL::text            AS access_role
  FROM allocated a
    JOIN "Member" m  ON m.id = a.member_id
    JOIN "Project" p ON p.id = a.project_id
    LEFT JOIN "ProjectMember" pm ON pm."projectId" = a.project_id AND pm."memberId" = a.member_id

  UNION ALL

  -- perna access-only (acesso sem alocação: guest/viewer/PM backfilled)
  SELECT
    pa."projectId"        AS project_id,
    m.id                  AS member_id,
    pa."userId"           AS user_id,
    'access'::text        AS source,
    m.name,
    m.role,
    m."position",
    m."fpCapacity"        AS fp_capacity,
    m."dedicationPercent" AS dedication_percent,
    m."isExternal"        AS is_external,
    (m.id = p."pmId")     AS is_pm,
    pm."fpAllocation"     AS fp_allocation,
    NULL::text            AS kind,
    NULL::numeric         AS percent,
    NULL::numeric         AS days,
    NULL::uuid            AS contract_id,
    pa.role               AS access_role
  FROM "ProjectAccess" pa
    JOIN "Project" p ON p.id = pa."projectId"
    LEFT JOIN "Member" m ON m."userId" = pa."userId"
    LEFT JOIN "ProjectMember" pm ON pm."projectId" = pa."projectId" AND pm."memberId" = m.id
  WHERE NOT EXISTS (
    SELECT 1 FROM allocated a2
      JOIN "Member" am ON am.id = a2.member_id
    WHERE a2.project_id = pa."projectId" AND am."userId" = pa."userId"
  )
)
SELECT * FROM team
WHERE auth.uid() IS NULL OR is_admin() OR can_view_project(project_id);

GRANT USAGE ON SCHEMA finance TO service_role;
GRANT SELECT ON finance.v_project_team TO authenticated, service_role;
