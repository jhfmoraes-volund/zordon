-- ═══════════════════════════════════════════════════════════
-- Fase 3 (RLS hardening) — Squad: fecha o caminho BROWSER (escrita).
--
-- squad.write = admin (D2: estrutura org). Hoje TODAS as policies = (true),
-- incl. SELECT. Esta migration fecha a ESCRITA (admin-only).
-- ⚠️ SELECT mantido permissivo de propósito: apertar p/ is_manager() pode
--    esconder squads de builders na UI (lista de squads, perfis). Validar a UI
--    antes de apertar leitura — adiado p/ Fase 4. Leitura de estrutura org é
--    baixa severidade vs risco de quebrar tela.
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated_insert" ON public."Squad";
CREATE POLICY "admin_insert" ON public."Squad"
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated_update" ON public."Squad";
CREATE POLICY "admin_update" ON public."Squad"
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated_delete" ON public."Squad";
CREATE POLICY "admin_delete" ON public."Squad"
  FOR DELETE TO authenticated USING (public.is_admin());

-- authenticated_select (true) MANTIDO — ver nota. Rollback: recriar writes com (true).
