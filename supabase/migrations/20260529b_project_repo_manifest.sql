-- Repo manifest pra Vitória (Camada E do intelligence-plan v2).
--
-- repoManifest = resumo curado do repo (AGENTS.md/README + file tree + package.json)
-- gerado UMA vez quando o PM linka o repo do projeto e cacheado em Project.repoManifest.
-- Vitória lê isso TODO turno (via prompt cache) → tem awareness estrutural do
-- código sem ingerir 1M tokens. Detalhe fino vai via tools GITHUB_* sob demanda.
--
-- TTL: 7 dias (validado em runtime). Botão "Atualizar manifest" força refresh
-- manual sem esperar TTL.

ALTER TABLE public."Project"
  ADD COLUMN IF NOT EXISTS "repoManifest" text,
  ADD COLUMN IF NOT EXISTS "repoManifestUpdatedAt" timestamptz;
