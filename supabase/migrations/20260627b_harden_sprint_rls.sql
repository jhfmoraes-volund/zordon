-- ═══════════════════════════════════════════════════════════
-- Fase 3 (RLS hardening) — Sprint: fecha o caminho BROWSER.
--
-- sprint.write = manager OU contributor+ no projeto; sprint.delete = manager+.
-- Espelha o gate TS (authz-catalog.ts: sprint.write / sprint.delete).
-- Hoje INSERT/UPDATE/DELETE = (true). can_edit_tasks(projectId) = role
-- IN (contributor,lead). Aplicar supervisionado via psql.
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated_insert" ON public."Sprint";
CREATE POLICY "manager_or_contributor_insert" ON public."Sprint"
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager() OR public.can_edit_tasks("projectId"));

DROP POLICY IF EXISTS "authenticated_update" ON public."Sprint";
CREATE POLICY "manager_or_contributor_update" ON public."Sprint"
  FOR UPDATE TO authenticated
  USING (public.is_manager() OR public.can_edit_tasks("projectId"))
  WITH CHECK (public.is_manager() OR public.can_edit_tasks("projectId"));

DROP POLICY IF EXISTS "authenticated_delete" ON public."Sprint";
CREATE POLICY "manager_delete" ON public."Sprint"
  FOR DELETE TO authenticated USING (public.is_manager());

-- SELECT (manager_or_viewer_select) já correta. Rollback: recriar com (true).
