-- Otimização: remove índices redundantes (duplicados ou cobertos por UNIQUE constraint).
-- Cada DROP abaixo é coberto por outro índice idêntico ou por uma constraint UNIQUE nas
-- mesmas colunas — zero impacto de leitura, elimina custo de escrita dobrado + espaço.
-- CONCURRENTLY pra não pegar ACCESS EXCLUSIVE em tabelas quentes (ProjectAccess).
-- NÃO envolver em BEGIN/COMMIT — DROP INDEX CONCURRENTLY não roda em transação.
--
-- Rollback (recriar) está no fim do arquivo, comentado.

-- ProjectAccess: idx (userId,projectId) idêntico à UNIQUE _key. 727k scans migram p/ a unique.
DROP INDEX CONCURRENTLY IF EXISTS "ProjectAccess_userId_projectId_idx";

-- AgentUsage: dois pares idênticos — mantém o índice mais usado de cada par.
DROP INDEX CONCURRENTLY IF EXISTS "idx_agent_usage_thread";          -- == AgentUsage_threadId_idx
DROP INDEX CONCURRENTLY IF EXISTS "idx_agent_usage_agent_created";   -- == AgentUsage_agentName_createdAt_idx

-- Agent: plain slug coberto pela UNIQUE Agent_slug_key.
DROP INDEX CONCURRENTLY IF EXISTS "idx_agent_slug";

-- PMReview: plain (project,week) coberto pela UNIQUE PMReview_project_week_key.
DROP INDEX CONCURRENTLY IF EXISTS "PMReview_project_week_idx";

-- PlanningSessionPRD: single-col (planningSessionId) coberto por UNIQUE composta com leading col igual.
DROP INDEX CONCURRENTLY IF EXISTS "idx_planning_session_prd_session";

-- SprintRetrospective: plain (sprintId) coberto pela UNIQUE sprint_retrospective_one_per_sprint.
DROP INDEX CONCURRENTLY IF EXISTS "sprint_retrospective_sprint_idx";

-- ============================================================================
-- ROLLBACK (descomentar e rodar pra reverter):
-- CREATE INDEX CONCURRENTLY "ProjectAccess_userId_projectId_idx" ON public."ProjectAccess" ("userId","projectId");
-- CREATE INDEX CONCURRENTLY "idx_agent_usage_thread" ON public."AgentUsage" ("threadId");
-- CREATE INDEX CONCURRENTLY "idx_agent_usage_agent_created" ON public."AgentUsage" ("agentName","createdAt" DESC);
-- CREATE INDEX CONCURRENTLY "idx_agent_slug" ON public."Agent" (slug);
-- CREATE INDEX CONCURRENTLY "PMReview_project_week_idx" ON public."PMReview" ("projectId","referenceWeek" DESC);
-- CREATE INDEX CONCURRENTLY "idx_planning_session_prd_session" ON public."PlanningSessionPRD" ("planningSessionId","sprintStart","order");
-- CREATE INDEX CONCURRENTLY "sprint_retrospective_sprint_idx" ON public."SprintRetrospective" ("sprintId");
