-- =============================================================================
-- Zelar v2 — Schema para geração de tasks orientada a camadas
-- =============================================================================
-- Adiciona suporte a:
--   1. Camada técnica de cada task (DATA / API / REALTIME / UI / OPS) via enum TaskLayer
--   2. Flags de qualidade (RLS_REQUIRED, SECRET_HANDLING, RATE_LIMIT, ...)
--   3. M:N entre Task <-> AcceptanceCriterion (uma task pode cobrir N AC,
--      um AC pode precisar de N tasks em camadas diferentes)
--   4. Reuso da TaskDependency existente (taskId, dependsOn, kind) — sem recriar
--   5. View task_coverage_v para validação automática
--
-- Decisões de modelagem:
--   - Task.layer e Task.qualityFlags são colunas novas em Task. Não substituem
--     Task.type/scope (do método anterior, agora obsoletos para Zelar v2 mas
--     preservados para outras DSs/projetos).
--   - TaskDependency já existia no schema com formato (taskId, dependsOn, kind text).
--     Convenção: kind = 'BLOCKS' | 'RELATES' (validado em aplicação, não em DB).
--   - Tabelas de junção por extensibilidade: permitem rastrear cobertura completa
--     e gerar relatórios sem fazer parsing de JSON.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Enum TaskLayer (idempotente)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskLayer') THEN
    CREATE TYPE "TaskLayer" AS ENUM (
      'DATA',       -- schema, migrations, RLS policies, indices, triggers, jobs pg_cron
      'API',        -- Edge Functions, RPCs, server actions, validação Zod, integrações externas
      'REALTIME',   -- canais Supabase Realtime, broadcast, eventos, locks otimistas
      'UI',         -- telas, componentes, formulários, optimistic updates, navegação
      'OPS'         -- feature flags, parâmetros configuráveis, seeds, dashboards de operação
    );
  END IF;
END $$;

-- =============================================================================
-- 2. Colunas novas em Task (idempotente)
-- =============================================================================
ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS layer "TaskLayer",
  ADD COLUMN IF NOT EXISTS "qualityFlags" text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS "personaScope" text;

COMMENT ON COLUMN "Task".layer IS 'Camada técnica da task (Zelar v2): DATA/API/REALTIME/UI/OPS.';
COMMENT ON COLUMN "Task"."qualityFlags" IS 'Flags de qualidade: RLS_REQUIRED, SECRET_HANDLING, RATE_LIMIT, IDEMPOTENCY_KEY, AUDIT_LOG, RACE_CONDITION, REUSE_EXISTING_COMPONENT, REUSE_EXISTING_HOOK, OPTIMISTIC_UPDATE, REALTIME_CHANNEL, INDEX_REQUIRED, MATERIALIZED_VIEW, etc.';
COMMENT ON COLUMN "Task"."personaScope" IS 'Persona dominante para RLS/escopo da task (CLIENTE, PRESTADOR, ADMIN, SISTEMA, ANY). Opcional, usado em tasks DATA/API com policy específica.';

-- =============================================================================
-- 3. M:N Task <-> AcceptanceCriterion
-- =============================================================================
CREATE TABLE IF NOT EXISTS "TaskAcceptanceCriterion" (
  "taskId"                uuid NOT NULL REFERENCES "Task"(id) ON DELETE CASCADE,
  "acceptanceCriterionId" uuid NOT NULL REFERENCES "AcceptanceCriterion"(id) ON DELETE CASCADE,
  "createdAt"             timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("taskId", "acceptanceCriterionId")
);

CREATE INDEX IF NOT EXISTS "TaskAcceptanceCriterion_acceptanceCriterionId_idx"
  ON "TaskAcceptanceCriterion" ("acceptanceCriterionId");

COMMENT ON TABLE "TaskAcceptanceCriterion" IS 'Mapeamento M:N entre tasks e AC. Uma task pode cobrir múltiplos AC (especialmente quando a camada cobre vários comportamentos relacionados); um AC tipicamente tem várias tasks (DATA + API + UI).';

-- =============================================================================
-- 4. View de cobertura: para cada AC, quantas tasks por camada
-- =============================================================================
CREATE OR REPLACE VIEW task_coverage_v AS
SELECT
  s."designSessionId",
  s.reference        AS story_ref,
  s.title            AS story_title,
  ac.id              AS ac_id,
  ac."order"         AS ac_order,
  LEFT(ac.text, 120) AS ac_preview,
  COUNT(*) FILTER (WHERE t.layer = 'DATA')     AS data_tasks,
  COUNT(*) FILTER (WHERE t.layer = 'API')      AS api_tasks,
  COUNT(*) FILTER (WHERE t.layer = 'REALTIME') AS realtime_tasks,
  COUNT(*) FILTER (WHERE t.layer = 'UI')       AS ui_tasks,
  COUNT(*) FILTER (WHERE t.layer = 'OPS')      AS ops_tasks,
  COUNT(t.id)                                  AS total_tasks,
  ARRAY_AGG(DISTINCT t.layer::text ORDER BY t.layer::text)
    FILTER (WHERE t.layer IS NOT NULL)         AS layers_covered
FROM "AcceptanceCriterion" ac
JOIN "UserStory" s ON s.id = ac."userStoryId"
LEFT JOIN "TaskAcceptanceCriterion" tac ON tac."acceptanceCriterionId" = ac.id
LEFT JOIN "Task" t ON t.id = tac."taskId"
GROUP BY s."designSessionId", s.reference, s.title, ac.id, ac."order", ac.text;

COMMENT ON VIEW task_coverage_v IS 'Cobertura de cada AC pelas tasks geradas, segregada por camada. Use para validar que cada AC tem ao menos uma task em DATA/API e uma em UI (exceções: SISTEMA pode ficar só backend).';

COMMIT;
