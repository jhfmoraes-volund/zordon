-- ═══════════════════════════════════════════════════════════
-- Forge Runtime Target — Project.githubPat
--
-- Adiciona coluna githubPat (PAT para clone/push no repo-alvo).
-- RLS: SELECT restrito a admin OU pmId do projeto.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Adiciona coluna githubPat (nullable) ─────────────────

ALTER TABLE public."Project"
  ADD COLUMN IF NOT EXISTS "githubPat" text;

-- ─── 2. RLS policy: admin ou PM do projeto pode ler PAT ─────

ALTER TABLE public."Project" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_github_pat_select" ON public."Project"
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR "pmId" = (SELECT id FROM public."Member" WHERE "userId" = auth.uid())
  );
