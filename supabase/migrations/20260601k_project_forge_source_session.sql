-- Project.forgeSourceSessionId — qual DesignSession (tipo prd_session) alimenta
-- a Forja deste projeto. Null = nenhuma session carregada ainda.
--
-- O fluxo: PM marca uma Session como Main e clica "Carregar PRDs" na tab Forge
-- → seta forgeSourceSessionId. A Forja passa a snapshotar PRDs dessa session
-- pra dentro de ForgeRun.manifest no momento do run.
--
-- ON DELETE SET NULL: se a session for excluída, o projeto volta pro estado
-- "sem session carregada" mas runs antigos preservam o manifest (snapshot).

ALTER TABLE "Project"
  ADD COLUMN "forgeSourceSessionId" uuid
  REFERENCES "DesignSession"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_project_forge_source_session"
  ON "Project"("forgeSourceSessionId")
  WHERE "forgeSourceSessionId" IS NOT NULL;

COMMENT ON COLUMN "Project"."forgeSourceSessionId" IS
  'DesignSession (prd_session) que alimenta a Forja deste projeto. NULL = sem session carregada.';
