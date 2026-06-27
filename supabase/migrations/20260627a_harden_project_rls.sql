-- ═══════════════════════════════════════════════════════════
-- Fase 3 (RLS hardening) — Project: fecha o caminho BROWSER.
--
-- Contexto: a API roda como service_role (bypassa RLS) e já é gateada por
-- requireCapabilityApi("project.create/edit/delete") (admin-only, D2). Mas o
-- project-edit-sheet escreve DIRETO pelo client anon (RLS é o único gate ali).
-- Hoje as policies de escrita são USING/CHECK (true) — qualquer autenticado
-- cria/edita/deleta projeto pela tela. Esta migration fecha isso.
--
-- D2: estrutura do projeto = admin-only.
-- ⚠️ MUDA COMPORTAMENTO: manager (PM) não-admin deixa de criar/editar/deletar
--    projeto pela TELA. A UI (project-edit-sheet) deve esconder/desabilitar p/
--    não-admin. Aplicar APÓS mapear escritas browser-direct e ajustar a UI.
-- Aplicar (supervisionado): psql "$DIRECT_URL" -f supabase/migrations/20260627a_harden_project_rls.sql
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated_insert" ON public."Project";
CREATE POLICY "admin_insert" ON public."Project"
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated_update" ON public."Project";
CREATE POLICY "admin_update" ON public."Project"
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated_delete" ON public."Project";
CREATE POLICY "admin_delete" ON public."Project"
  FOR DELETE TO authenticated USING (public.is_admin());

-- SELECT (manager_or_viewer_select, project_github_pat_select) já corretas — não tocadas.
-- Rollback: recriar authenticated_insert/update/delete com (true).
