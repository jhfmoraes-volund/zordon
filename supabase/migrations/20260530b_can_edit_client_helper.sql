-- ═══════════════════════════════════════════════════════════
-- can_edit_client: helper RLS pra Opportunity mutations
--
-- Retorna true se user é manager (bypass) OU tem
-- role IN (contributor, lead) em QUALQUER projeto do cliente.
--
-- Usado em RLS de Opportunity INSERT/UPDATE/DELETE.
-- Conforme PRD §7.2.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_edit_client(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_manager()
    OR EXISTS (
      SELECT 1
      FROM public."ProjectAccess" pa
      JOIN public."Project" p ON p.id = pa."projectId"
      WHERE pa."userId" = auth.uid()
        AND p."clientId" = p_client_id
        AND pa.role IN ('contributor', 'lead')
    )
$$;

GRANT EXECUTE ON FUNCTION public.can_edit_client(uuid) TO authenticated;
