-- F2.10 RLS explícita admin-only em finance.labor_allocation (roster = SSOT, escrita
-- só por admin/head-of-ops — D6/D11). Hoje existe só a policy `admin_all` (cmd=ALL,
-- is_admin()), que JÁ trava escrita pra admin; mas a auditoria exige policy explícita
-- por comando. Substituo `admin_all` por 4 policies (SELECT/INSERT/UPDATE/DELETE),
-- todas is_admin() — semântica idêntica (admin-only em tudo), e admins seguem lendo
-- direto (checkAllocation faz SELECT). service_role (BYPASSRLS) não é afetado: o
-- helper getProjectTeam lê v_project_team (view postgres-owned), não a tabela.
-- Idempotente: DROP IF EXISTS antes de criar.
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624o_labor_allocation_rls.sql

ALTER TABLE finance.labor_allocation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all ON finance.labor_allocation;
DROP POLICY IF EXISTS labor_allocation_select_admin ON finance.labor_allocation;
DROP POLICY IF EXISTS labor_allocation_insert_admin ON finance.labor_allocation;
DROP POLICY IF EXISTS labor_allocation_update_admin ON finance.labor_allocation;
DROP POLICY IF EXISTS labor_allocation_delete_admin ON finance.labor_allocation;

CREATE POLICY labor_allocation_select_admin ON finance.labor_allocation
  FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY labor_allocation_insert_admin ON finance.labor_allocation
  FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY labor_allocation_update_admin ON finance.labor_allocation
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY labor_allocation_delete_admin ON finance.labor_allocation
  FOR DELETE TO authenticated USING (is_admin());
