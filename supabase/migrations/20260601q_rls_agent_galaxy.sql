-- Fecha o gap de RLS do "agent galaxy" + SprintMember.
-- Contexto: essas tabelas estavam UNRESTRICTED (RLS off). Não expõem ao anon
-- (sem GRANT), MAS têm GRANT pra `authenticated` → qualquer usuário logado lia
-- tudo via REST API, contornando o app (acesso horizontal). O modelo canônico
-- do banco é GRANT amplo + RLS filtrando; essas só tinham a primeira metade.

-- ─── Service-role-only (5 tabelas) ────────────────────────────────────────
-- Confirmado: TODO acesso é via db() (service_role), zero leitura client-side.
-- ENABLE RLS sem policy permissiva = bloqueia anon/authenticated; service_role
-- bypassa RLS por design → app continua funcionando, gap fechado.
ALTER TABLE "ChatThread"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatMessage"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentConfig"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentHeuristic" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentVersion"   ENABLE ROW LEVEL SECURITY;

-- ─── SprintMember (lido client-side) ──────────────────────────────────────
-- O hook use-project-members lê SprintMember com o client authenticated, então
-- NÃO pode ser deny-all. Policy real: vê quem pode ver o projeto da sprint;
-- edita quem pode editar o projeto (ou manager).
ALTER TABLE "SprintMember" ENABLE ROW LEVEL SECURITY;

CREATE POLICY sprintmember_select ON "SprintMember" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "Sprint" s
    WHERE s.id = "SprintMember"."sprintId" AND can_view_project(s."projectId")
  ));

CREATE POLICY sprintmember_insert ON "SprintMember" FOR INSERT
  WITH CHECK (is_manager() OR EXISTS (
    SELECT 1 FROM "Sprint" s
    WHERE s.id = "SprintMember"."sprintId" AND can_edit_project(s."projectId")
  ));

CREATE POLICY sprintmember_update ON "SprintMember" FOR UPDATE
  USING (is_manager() OR EXISTS (
    SELECT 1 FROM "Sprint" s
    WHERE s.id = "SprintMember"."sprintId" AND can_edit_project(s."projectId")
  ))
  WITH CHECK (is_manager() OR EXISTS (
    SELECT 1 FROM "Sprint" s
    WHERE s.id = "SprintMember"."sprintId" AND can_edit_project(s."projectId")
  ));

CREATE POLICY sprintmember_delete ON "SprintMember" FOR DELETE
  USING (is_manager() OR EXISTS (
    SELECT 1 FROM "Sprint" s
    WHERE s.id = "SprintMember"."sprintId" AND can_edit_project(s."projectId")
  ));

-- NOTA: `Agent` (também UNRESTRICTED) ficou DE FORA de propósito — tem
-- systemPrompt (IP do agente) e é lido por builders via /agents (server
-- component authenticated). Travar exige decisão de produto: builder pode ver
-- systemPrompt? Endereçar separado.
--
-- Rollback: ALTER TABLE <t> DISABLE ROW LEVEL SECURITY; DROP POLICY ... ON "SprintMember";
