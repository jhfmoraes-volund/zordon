-- ═══════════════════════════════════════════════════════════
-- Fase 3 (RLS hardening) — ProjectMember: fecha o caminho BROWSER.
--
-- Alocação/membership do projeto = manager+ (project.manage_access).
-- Hoje INSERT/UPDATE/DELETE = (true). O trigger sync_project_access_from_member
-- continua disparando no INSERT/UPDATE (mantém ProjectAccess sincronizado).
-- Aplicar supervisionado via psql.
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated_insert" ON public."ProjectMember";
CREATE POLICY "manager_insert" ON public."ProjectMember"
  FOR INSERT TO authenticated WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "authenticated_update" ON public."ProjectMember";
CREATE POLICY "manager_update" ON public."ProjectMember"
  FOR UPDATE TO authenticated
  USING (public.is_manager()) WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "authenticated_delete" ON public."ProjectMember";
CREATE POLICY "manager_delete" ON public."ProjectMember"
  FOR DELETE TO authenticated USING (public.is_manager());

-- SELECT (manager_or_viewer_select) já correta. Rollback: recriar writes com (true).
