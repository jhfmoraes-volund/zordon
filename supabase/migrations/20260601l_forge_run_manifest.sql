-- ForgeRun: snapshot imutável de PRDs + repo de destino.
--
-- Princípio: ForgeRun é o "frozen execution unit". Quando o usuário clica Run,
-- snapshotamos o estado atual dos PRDs aprovados da source session pra dentro
-- de `manifest`. Edições subsequentes nos PRDs (via Vitor) NÃO afetam runs em
-- curso ou concluídos. Isso dá replay, audit e segurança contra concorrência.
--
-- Colunas:
--   designSessionId  — qual DS foi snapshotada (referência, não fonte)
--   manifest         — snapshot dos PRDs+stories naquele instante (versionado)
--   repoUrl          — repo GitHub de destino (herda de Project.repoUrl no momento
--                       da criação do run; explicit aqui pra audit)
--   branchName       — branch criada/usada (preenchida pelo worker)
--
-- manifest shape:
-- {
--   "version": 1,
--   "snapshotAt": "ISO8601",
--   "sourceSessionId": "uuid",
--   "prds": [
--     {
--       "id", "reference", "title",
--       "problem", "goal", "oneLiner",
--       "acceptanceCriteria": [...],
--       "stories": [
--         { "id", "title", "ac": [...], "verifiable": [...], "dependsOn": [...], "touches": [...] }
--       ]
--     }
--   ]
-- }

ALTER TABLE "ForgeRun"
  ADD COLUMN "designSessionId" uuid REFERENCES "DesignSession"(id) ON DELETE SET NULL,
  ADD COLUMN "manifest" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "repoUrl" text,
  ADD COLUMN "branchName" text;

CREATE INDEX IF NOT EXISTS "idx_forge_run_design_session"
  ON "ForgeRun"("designSessionId")
  WHERE "designSessionId" IS NOT NULL;

COMMENT ON COLUMN "ForgeRun"."designSessionId" IS
  'DesignSession que originou este run (referência pra audit). Snapshot real fica em manifest.';
COMMENT ON COLUMN "ForgeRun"."manifest" IS
  'Snapshot imutável dos PRDs+stories executados neste run. Versionado (manifest.version).';
COMMENT ON COLUMN "ForgeRun"."repoUrl" IS
  'GitHub repo de destino — herda de Project.repoUrl no momento da criação do run.';
COMMENT ON COLUMN "ForgeRun"."branchName" IS
  'Branch criada pelo worker pra este run. Preenchida quando o worker inicia o clone.';
