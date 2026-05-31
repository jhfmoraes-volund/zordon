-- ============================================================================
-- ForgeTask engine fields — specId, agentProfile, worktreePath, etc
--
-- Adiciona campos necessários para o Forge Engine executar tasks:
-- - specId: FK para ForgeSpec (de onde veio a task)
-- - agentProfile: db|api|ui|wiring|test|doc (qual subagent spawna)
-- - worktreePath: caminho do worktree isolado (.forge/<run>/tasks/<task>/worktree)
-- - dependsOn: array de task IDs (DAG de dependências)
-- - verifiable: array de checks automatizáveis (typecheck, sql, http, etc)
-- - passes: boolean, null até rodar verifiable checks
-- ============================================================================

BEGIN;

-- Adicionar colunas
ALTER TABLE "ForgeTask"
  ADD COLUMN "specId" uuid REFERENCES "ForgeSpec"(id) ON DELETE SET NULL,
  ADD COLUMN "agentProfile" text CHECK ("agentProfile" IN ('db','api','ui','wiring','test','doc')),
  ADD COLUMN "worktreePath" text,
  ADD COLUMN "dependsOn" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN verifiable jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN passes boolean;

-- Índice para lookup de tasks por spec
CREATE INDEX "ForgeTask_spec_idx" ON "ForgeTask"("specId");

COMMIT;
