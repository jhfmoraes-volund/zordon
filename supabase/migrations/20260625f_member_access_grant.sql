-- ═══════════════════════════════════════════════════════════
-- MemberAccessGrant: override de acesso por membro × capability (× projeto).
--
-- Terceira camada entre os dois eixos existentes:
--   1. access_level global (JWT)          → guest/builder/manager/admin
--   2. ProjectAccess por-projeto (tabela)  → viewer/.../lead
--   3. MemberAccessGrant (ESTA tabela)     → concede UMA capability a um user,
--      opcionalmente escopada a um projeto.
--
-- Caso de uso: liberar pra um builder (sem ProjectAccess) APENAS o ritual de
-- Planning de um projeto, revogável depois.
--
-- O catálogo de capabilityKey vive em TS (src/lib/access/capabilities.ts) —
-- o banco só guarda as linhas de grant. Precedente estrutural: ProjectAccess
-- (20260427_project_access.sql). projectId é uuid (Project.id virou uuid em
-- 20260501_text_to_uuid.sql). Revogação é SOFT (revokedAt) — preserva
-- auditoria; grant ativo = revokedAt IS NULL.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public."MemberAccessGrant" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "capabilityKey" text NOT NULL,
  scope           text NOT NULL CHECK (scope IN ('global','project')),
  "projectId"     uuid REFERENCES public."Project"(id) ON DELETE CASCADE,
  "grantedBy"     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "grantedAt"     timestamptz NOT NULL DEFAULT now(),
  "revokedAt"     timestamptz,
  "revokedBy"     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- project-scoped exige projectId; global não pode ter.
  CONSTRAINT "MemberAccessGrant_scope_project_chk" CHECK (
    (scope = 'project' AND "projectId" IS NOT NULL) OR
    (scope = 'global'  AND "projectId" IS NULL)
  )
);

-- Um grant ATIVO por (user, capability, projeto). Índices parciais separados
-- pra project-scoped e global (COALESCE em uuid não tem sentinela limpa).
-- Re-conceder após revogar gera linha nova — sem colisão com a revogada.
CREATE UNIQUE INDEX IF NOT EXISTS "MemberAccessGrant_active_project_uniq"
  ON public."MemberAccessGrant" ("userId", "capabilityKey", "projectId")
  WHERE "revokedAt" IS NULL AND "projectId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "MemberAccessGrant_active_global_uniq"
  ON public."MemberAccessGrant" ("userId", "capabilityKey")
  WHERE "revokedAt" IS NULL AND "projectId" IS NULL;

-- Lookups quentes: grants ativos por usuário (DAL) e por projeto (RLS helper).
CREATE INDEX IF NOT EXISTS "MemberAccessGrant_user_active_idx"
  ON public."MemberAccessGrant" ("userId") WHERE "revokedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "MemberAccessGrant_project_active_idx"
  ON public."MemberAccessGrant" ("projectId") WHERE "revokedAt" IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."MemberAccessGrant" TO anon, authenticated;
