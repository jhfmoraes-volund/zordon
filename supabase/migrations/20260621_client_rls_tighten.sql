-- Aperta a RLS da tabela Client.
--
-- Contexto: o dump da migração UUID (20260501_text_to_uuid.sql:1007-1014) deixou
-- a tabela Client com 4 policies `USING (true)` / `WITH CHECK (true)` pra role
-- `authenticated`. Resultado: QUALQUER usuário logado (incl. builder/guest com
-- ProjectAccess) podia listar, criar, editar e deletar QUALQUER cliente via o
-- browser client (ex.: src/components/clients/clients-table.tsx, página /clients
-- que o proxy só barra pra guest). Cliente = carteira comercial; é dado executivo.
--
-- Go-forward:
--   • WRITE (INSERT/UPDATE/DELETE) → só manager (PM) ou admin global.
--   • READ  (SELECT)              → manager/admin veem todos; demais veem só
--     clientes de projetos a que já têm acesso (ProjectAccess). Mantém o nome do
--     cliente na lista de projetos do builder (projects/page.tsx lê Client(id,name)
--     via RLS) sem permitir enumerar a carteira inteira.
--
-- Os endpoints /api/clients* usam service_role (bypass RLS), então ganham gate
-- de access_level no app layer (requireMinAccessLevelApi("manager")) em paralelo.
BEGIN;

ALTER TABLE public."Client" ENABLE ROW LEVEL SECURITY;

-- Derruba as policies abertas herdadas do dump UUID.
DROP POLICY IF EXISTS authenticated_select ON public."Client";
DROP POLICY IF EXISTS authenticated_insert ON public."Client";
DROP POLICY IF EXISTS authenticated_update ON public."Client";
DROP POLICY IF EXISTS authenticated_delete ON public."Client";

-- SELECT — manager/admin (carteira inteira) OU membro de um projeto do cliente.
CREATE POLICY "client_select" ON public."Client"
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1
      FROM public."Project" p
      WHERE p."clientId" = "Client".id
        AND public.can_view_project(p.id)
    )
  );

-- INSERT/UPDATE/DELETE — só manager (PM) ou admin global.
CREATE POLICY "client_insert" ON public."Client"
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager());

CREATE POLICY "client_update" ON public."Client"
  FOR UPDATE TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY "client_delete" ON public."Client"
  FOR DELETE TO authenticated
  USING (public.is_manager());

COMMIT;
