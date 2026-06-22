-- ═══════════════════════════════════════════════════════════
-- ProjectWikiEmphasis: steer livre do PM que o composer honra em
-- TODA geração da Wiki (não é edição pontual → não fica estática
-- nem é sobrescrita pelo cron). 1 linha por projeto.
--
-- Escrita só via service role (tool set_wiki_emphasis da Vitoria,
-- no daemon). Leitura por quem vê o projeto. Espelha o padrão de
-- acesso de ProjectWikiSectionSource.
-- Runbook: docs/runbooks/wiki-copilot-runbook.md (WCP-001).
-- ═══════════════════════════════════════════════════════════

CREATE TABLE "ProjectWikiEmphasis" (
  "projectId" uuid PRIMARY KEY REFERENCES "Project"(id) ON DELETE CASCADE,
  emphasis    text NOT NULL DEFAULT '' CHECK (length(emphasis) <= 2000),
  "updatedBy" uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "ProjectWikiEmphasis" ENABLE ROW LEVEL SECURITY;

-- SELECT: quem vê o projeto (PM lê a ênfase vigente no sheet).
DROP POLICY IF EXISTS pwe_select ON public."ProjectWikiEmphasis";
CREATE POLICY pwe_select ON public."ProjectWikiEmphasis" FOR SELECT TO authenticated
  USING (public.can_view_project("projectId"));

-- INSERT/UPDATE/DELETE: só service role (tool da Vitoria / composer).
REVOKE INSERT, UPDATE, DELETE ON public."ProjectWikiEmphasis" FROM authenticated;
