-- ═══════════════════════════════════════════════════════════
-- MemberAccessGrant: helpers de authz + RLS.
--
-- has_access_grant / has_any_project_grant espelham can_view_project:
-- SECURITY DEFINER, auth.uid(), só linhas ativas (revokedAt IS NULL).
-- Um grant global (projectId IS NULL) vale para qualquer projeto.
-- ═══════════════════════════════════════════════════════════

-- O user ACTING tem grant ativo desta capability (neste projeto)?
CREATE OR REPLACE FUNCTION public.has_access_grant(p_capability text, p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."MemberAccessGrant"
    WHERE "userId" = auth.uid()
      AND "capabilityKey" = p_capability
      AND "revokedAt" IS NULL
      AND ("projectId" = p_project_id OR (scope = 'global' AND "projectId" IS NULL))
  )
$$;

-- Qualquer grant ativo neste projeto? (usado pelo OR-in de can_view_project —
-- a visibilidade mínima que faz o projeto aparecer pro membro concedido.)
CREATE OR REPLACE FUNCTION public.has_any_project_grant(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."MemberAccessGrant"
    WHERE "userId" = auth.uid()
      AND "projectId" = p_project_id
      AND "revokedAt" IS NULL
  )
$$;

ALTER TABLE public."MemberAccessGrant" ENABLE ROW LEVEL SECURITY;

-- Membro lê os PRÓPRIOS grants; admin lê todos. Escrita é admin-only
-- (decisão de produto: o app Acessos é admin-only).
CREATE POLICY "self_or_admin_select" ON public."MemberAccessGrant"
  FOR SELECT TO authenticated
  USING ("userId" = auth.uid() OR public.is_admin());

CREATE POLICY "admin_insert" ON public."MemberAccessGrant"
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "admin_update" ON public."MemberAccessGrant"
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "admin_delete" ON public."MemberAccessGrant"
  FOR DELETE TO authenticated USING (public.is_admin());
