-- ═══════════════════════════════════════════════════════════
-- Opportunity RLS policies
--
-- 4 policies conforme PRD §7.3:
--  • opp_select: qualquer ProjectAccess no mesmo clientId OU manager
--  • opp_insert/update/delete: can_edit_client(clientId)
-- ═══════════════════════════════════════════════════════════

-- RLS já habilitado em 20260530_opportunity_table.sql
-- Apenas criamos as policies aqui.

DROP POLICY IF EXISTS "opp_select" ON public."Opportunity";
DROP POLICY IF EXISTS "opp_insert" ON public."Opportunity";
DROP POLICY IF EXISTS "opp_update" ON public."Opportunity";
DROP POLICY IF EXISTS "opp_delete" ON public."Opportunity";

-- ─── SELECT: manager OU qualquer ProjectAccess no mesmo cliente ───

CREATE POLICY "opp_select" ON public."Opportunity"
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1
      FROM public."ProjectAccess" pa
      JOIN public."Project" p ON p.id = pa."projectId"
      WHERE pa."userId" = auth.uid()
        AND p."clientId" = "Opportunity"."clientId"
    )
  );

-- ─── INSERT/UPDATE/DELETE: can_edit_client ────────────────────────

CREATE POLICY "opp_insert" ON public."Opportunity"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_client("clientId"));

CREATE POLICY "opp_update" ON public."Opportunity"
  FOR UPDATE TO authenticated
  USING (public.can_edit_client("clientId"))
  WITH CHECK (public.can_edit_client("clientId"));

CREATE POLICY "opp_delete" ON public."Opportunity"
  FOR DELETE TO authenticated
  USING (public.can_edit_client("clientId"));
