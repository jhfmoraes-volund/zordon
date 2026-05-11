-- =============================================================================
-- Clone backup_zelar_20260509 -> Project visivel no UI
-- =============================================================================
-- Cria Project "Zelar (Backup 2026-05-09)" com referenceKey ZLAR_BAK e
-- duplica TODA estrutura do schema backup_zelar_20260509 com novos UUIDs.
--
-- Pra deletar dps:  DELETE FROM "Project" WHERE "referenceKey" = 'ZLAR_BAK';
-- (cascateia automaticamente em todas as filhas)
-- =============================================================================

BEGIN;

DELETE FROM "Project" WHERE "referenceKey" = 'ZLAR_BAK';

DO $clone$
DECLARE
  v_new_pid uuid := gen_random_uuid();
  v_count   int;
BEGIN

-- ===========================================================================
-- Project
-- ===========================================================================
INSERT INTO "Project" (
  id, name, "repoUrl", "startDate", "endDate", status,
  "createdAt", "updatedAt", "githubRepoOwner", "githubRepoName", "githubDefaultBranch",
  "clientId", "pmId", "memoryMd", "memoryUpdatedAt", "memoryVersion",
  "referenceKey", "definitionOfDone", "alphaHierarchyEnabled"
)
SELECT
  v_new_pid,
  name || ' (Backup 2026-05-09)',
  "repoUrl", "startDate", "endDate", status,
  NOW(), NOW(), "githubRepoOwner", "githubRepoName", "githubDefaultBranch",
  "clientId", "pmId", "memoryMd", "memoryUpdatedAt", "memoryVersion",
  'ZLAR_BAK', "definitionOfDone", "alphaHierarchyEnabled"
FROM backup_zelar_20260509."Project";

RAISE NOTICE 'Project clonado: %', v_new_pid;

-- ===========================================================================
-- Maps de UUIDs (1:1, novo gerado)
-- ===========================================================================
CREATE TEMP TABLE _map_module      (old_id uuid PRIMARY KEY, new_id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
CREATE TEMP TABLE _map_persona     (old_id uuid PRIMARY KEY, new_id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
CREATE TEMP TABLE _map_session     (old_id uuid PRIMARY KEY, new_id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
CREATE TEMP TABLE _map_userstory   (old_id uuid PRIMARY KEY, new_id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
CREATE TEMP TABLE _map_task        (old_id uuid PRIMARY KEY, new_id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
CREATE TEMP TABLE _map_sprint      (old_id uuid PRIMARY KEY, new_id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
CREATE TEMP TABLE _map_tasktag     (old_id uuid PRIMARY KEY, new_id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
CREATE TEMP TABLE _map_chatthread  (old_id uuid PRIMARY KEY, new_id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
CREATE TEMP TABLE _map_dsitem      (old_id uuid PRIMARY KEY, new_id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
CREATE TEMP TABLE _map_brainstorm  (old_session uuid NOT NULL, old_id text NOT NULL, new_id text NOT NULL, PRIMARY KEY (old_session, old_id)) ON COMMIT DROP;

INSERT INTO _map_module(old_id)     SELECT id FROM backup_zelar_20260509."Module";
INSERT INTO _map_persona(old_id)    SELECT id FROM backup_zelar_20260509."ProjectPersona";
INSERT INTO _map_session(old_id)    SELECT id FROM backup_zelar_20260509."DesignSession";
INSERT INTO _map_userstory(old_id)  SELECT id FROM backup_zelar_20260509."UserStory";
INSERT INTO _map_task(old_id)       SELECT id FROM backup_zelar_20260509."Task";
INSERT INTO _map_sprint(old_id)     SELECT id FROM backup_zelar_20260509."Sprint";
INSERT INTO _map_tasktag(old_id)    SELECT id FROM backup_zelar_20260509."TaskTag";
INSERT INTO _map_chatthread(old_id) SELECT id FROM backup_zelar_20260509."ChatThread";
INSERT INTO _map_dsitem(old_id)     SELECT id FROM backup_zelar_20260509."DesignSessionItem";
INSERT INTO _map_brainstorm(old_session, old_id, new_id)
SELECT "sessionId", id, id || '_bak' || substr(replace("sessionId"::text, '-', ''), 1, 6)
FROM backup_zelar_20260509."DesignSessionBrainstormFeature";

-- ===========================================================================
-- Module
-- ===========================================================================
INSERT INTO "Module" (id, "projectId", name, description, "createdAt", "updatedAt", "approvedAt", "approvedBy")
SELECT m.new_id, v_new_pid, b.name, b.description, b."createdAt", b."updatedAt", b."approvedAt", b."approvedBy"
FROM backup_zelar_20260509."Module" b
JOIN _map_module m ON m.old_id = b.id;
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'Module: %', v_count;

-- ===========================================================================
-- ProjectPersona
-- ===========================================================================
INSERT INTO "ProjectPersona" (id, "projectId", name, description, "createdAt", "updatedAt")
SELECT p.new_id, v_new_pid, b.name, b.description, b."createdAt", b."updatedAt"
FROM backup_zelar_20260509."ProjectPersona" b
JOIN _map_persona p ON p.old_id = b.id;
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'ProjectPersona: %', v_count;

-- ===========================================================================
-- ProjectMember
-- ===========================================================================
INSERT INTO "ProjectMember" (id, "projectId", "memberId", "createdAt", "fpAllocation")
SELECT gen_random_uuid(), v_new_pid, "memberId", "createdAt", "fpAllocation"
FROM backup_zelar_20260509."ProjectMember";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'ProjectMember: %', v_count;

-- ===========================================================================
-- ProjectAccess
-- ===========================================================================
INSERT INTO "ProjectAccess" (id, "userId", "projectId", role, "grantedBy", "grantedAt")
SELECT DISTINCT ON ("userId") gen_random_uuid(), "userId", v_new_pid, role, "grantedBy", "grantedAt"
FROM backup_zelar_20260509."ProjectAccess"
ORDER BY "userId", "grantedAt" DESC
ON CONFLICT ("userId", "projectId") DO NOTHING;
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'ProjectAccess: %', v_count;

-- ===========================================================================
-- ProjectSquad
-- ===========================================================================
INSERT INTO "ProjectSquad" (id, "projectId", "squadId")
SELECT gen_random_uuid(), v_new_pid, "squadId"
FROM backup_zelar_20260509."ProjectSquad";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'ProjectSquad: %', v_count;

-- ===========================================================================
-- ProjectWikiSection
-- ===========================================================================
INSERT INTO "ProjectWikiSection" (id, "projectId", "sectionKey", title, data, "order", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v_new_pid, "sectionKey", title, data, "order", "createdAt", "updatedAt"
FROM backup_zelar_20260509."ProjectWikiSection";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'ProjectWikiSection: %', v_count;

-- ===========================================================================
-- Sprint
-- ===========================================================================
INSERT INTO "Sprint" (
  id, name, "startDate", "endDate", status, "projectId",
  "deployedToStagingAt", "deployedToProductionAt", "createdAt", "updatedAt", goal
)
SELECT s.new_id, b.name, b."startDate", b."endDate", b.status, v_new_pid,
       b."deployedToStagingAt", b."deployedToProductionAt", b."createdAt", b."updatedAt", b.goal
FROM backup_zelar_20260509."Sprint" b
JOIN _map_sprint s ON s.old_id = b.id;
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'Sprint: %', v_count;

-- ===========================================================================
-- TaskTag
-- ===========================================================================
INSERT INTO "TaskTag" (id, "projectId", name, tone, "createdAt", "updatedAt")
SELECT t.new_id, v_new_pid, b.name, b.tone, b."createdAt", b."updatedAt"
FROM backup_zelar_20260509."TaskTag" b
JOIN _map_tasktag t ON t.old_id = b.id;
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'TaskTag: %', v_count;

-- ===========================================================================
-- DesignSession
-- ===========================================================================
INSERT INTO "DesignSession" (
  id, "projectId", type, status, title, description, "currentStep", "totalSteps",
  "scheduledAt", "completedAt", "actualDurationMin", "createdBy",
  "createdAt", "updatedAt", "memoryMd", "memoryAbstract", "memoryUpdatedAt",
  "memoryVersion", "selectedSteps"
)
SELECT s.new_id, v_new_pid, b.type, b.status, b.title || ' (Backup)', b.description,
       b."currentStep", b."totalSteps",
       b."scheduledAt", b."completedAt", b."actualDurationMin", b."createdBy",
       b."createdAt", b."updatedAt", b."memoryMd", b."memoryAbstract", b."memoryUpdatedAt",
       b."memoryVersion", b."selectedSteps"
FROM backup_zelar_20260509."DesignSession" b
JOIN _map_session s ON s.old_id = b.id;
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'DesignSession: %', v_count;

-- ===========================================================================
-- DesignSessionItem (mapeado pra remap de UserStory.designSessionItemId)
-- ===========================================================================
INSERT INTO "DesignSessionItem" (
  id, "sessionId", title, description, type, priority, "sourceStep", "aiGenerated", "orderIndex"
)
SELECT i.new_id, s.new_id, b.title, b.description, b.type, b.priority, b."sourceStep", b."aiGenerated", b."orderIndex"
FROM backup_zelar_20260509."DesignSessionItem" b
JOIN _map_session s ON s.old_id = b."sessionId"
JOIN _map_dsitem i ON i.old_id = b.id;
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'DesignSessionItem: %', v_count;

-- ===========================================================================
-- DesignSessionStepData
-- ===========================================================================
INSERT INTO "DesignSessionStepData" (id, "sessionId", "stepIndex", "stepKey", data, "updatedAt")
SELECT gen_random_uuid(), s.new_id, b."stepIndex", b."stepKey", b.data, b."updatedAt"
FROM backup_zelar_20260509."DesignSessionStepData" b
JOIN _map_session s ON s.old_id = b."sessionId";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'DesignSessionStepData: %', v_count;

-- ===========================================================================
-- DesignSessionBrainstormFeature (id text — usa _map_brainstorm com sufixo)
-- ===========================================================================
INSERT INTO "DesignSessionBrainstormFeature" (
  id, "sessionId", title, "howItSolves", "targetPersona", "keyScreens", "userFlows",
  "painPointRef", "technicalNotes", archived, "moduleHint", bucket, "orderIndex",
  "createdAt", "updatedAt"
)
SELECT m.new_id, s.new_id, b.title, b."howItSolves", b."targetPersona", b."keyScreens", b."userFlows",
       b."painPointRef", b."technicalNotes", b.archived, b."moduleHint", b.bucket, b."orderIndex",
       b."createdAt", b."updatedAt"
FROM backup_zelar_20260509."DesignSessionBrainstormFeature" b
JOIN _map_session s ON s.old_id = b."sessionId"
JOIN _map_brainstorm m ON m.old_session = b."sessionId" AND m.old_id = b.id;
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'DesignSessionBrainstormFeature: %', v_count;

-- ===========================================================================
-- DesignSessionExportLog
-- ===========================================================================
INSERT INTO "DesignSessionExportLog" (id, "sessionId", "memberId", "userId", format, "stepCount", "byteSize", "createdAt")
SELECT gen_random_uuid(), s.new_id, b."memberId", b."userId", b.format, b."stepCount", b."byteSize", b."createdAt"
FROM backup_zelar_20260509."DesignSessionExportLog" b
JOIN _map_session s ON s.old_id = b."sessionId";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'DesignSessionExportLog: %', v_count;

-- ===========================================================================
-- DesignDecision
-- ===========================================================================
INSERT INTO "DesignDecision" (
  id, "sessionId", "projectId", statement, rationale, confidence, status, "supersededBy",
  tags, "createdAt", "createdBy", "updatedAt"
)
SELECT gen_random_uuid(), s.new_id, v_new_pid, b.statement, b.rationale, b.confidence, b.status, NULL,
       b.tags, b."createdAt", b."createdBy", b."updatedAt"
FROM backup_zelar_20260509."DesignDecision" b
JOIN _map_session s ON s.old_id = b."sessionId";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'DesignDecision: %', v_count;

-- ===========================================================================
-- DesignOpenQuestion
-- ===========================================================================
INSERT INTO "DesignOpenQuestion" (id, "sessionId", "projectId", question, "blocksWhat", status, answer, "answeredAt", "createdAt")
SELECT gen_random_uuid(), s.new_id, v_new_pid, b.question, b."blocksWhat", b.status, b.answer, b."answeredAt", b."createdAt"
FROM backup_zelar_20260509."DesignOpenQuestion" b
JOIN _map_session s ON s.old_id = b."sessionId";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'DesignOpenQuestion: %', v_count;

-- ===========================================================================
-- UserStory (precisa de Module/Persona/DesignSession/DesignSessionItem maps)
-- ===========================================================================
INSERT INTO "UserStory" (
  id, "projectId", "moduleId", "proposedModuleName", reference, title, "personaId",
  want, "soThat", "refinementStatus", "acValidatedAt", "acValidatedBy",
  "designSessionId", "designSessionItemId", "createdByAgent", "createdById",
  "createdAt", "updatedAt"
)
SELECT
  u.new_id, v_new_pid,
  mm.new_id, b."proposedModuleName",
  b.reference || '_BAK', b.title,
  pp.new_id,
  b.want, b."soThat", b."refinementStatus", b."acValidatedAt", b."acValidatedBy",
  ss.new_id, di.new_id,
  b."createdByAgent", b."createdById",
  b."createdAt", b."updatedAt"
FROM backup_zelar_20260509."UserStory" b
JOIN _map_userstory u  ON u.old_id  = b.id
LEFT JOIN _map_module    mm ON mm.old_id = b."moduleId"
LEFT JOIN _map_persona   pp ON pp.old_id = b."personaId"
LEFT JOIN _map_session   ss ON ss.old_id = b."designSessionId"
LEFT JOIN _map_dsitem    di ON di.old_id = b."designSessionItemId";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'UserStory: %', v_count;

-- ===========================================================================
-- Task (depende de UserStory, DesignSession, Sprint maps)
-- ===========================================================================
INSERT INTO "Task" (
  id, title, description, reference, status, complexity, scope, priority,
  "functionPoints", type, "dueDate", "githubIssueNumber", "githubBranchName",
  "githubPrNumber", "githubPrUrl", "mergeAttempts", "lastMergeError", notes,
  "designSessionId", "projectId", "sprintId", "createdAt", "updatedAt",
  billable, "createdById", "createdByAgent", "userStoryId", "doneAt"
)
SELECT
  t.new_id, b.title, b.description,
  CASE WHEN b.reference IS NULL THEN NULL ELSE b.reference || '_BAK' END,
  b.status, b.complexity, b.scope, b.priority,
  b."functionPoints", b.type, b."dueDate", b."githubIssueNumber", b."githubBranchName",
  b."githubPrNumber", b."githubPrUrl", b."mergeAttempts", b."lastMergeError", b.notes,
  ss.new_id, v_new_pid, sp.new_id, b."createdAt", b."updatedAt",
  b.billable, b."createdById", b."createdByAgent", us.new_id, b."doneAt"
FROM backup_zelar_20260509."Task" b
JOIN _map_task        t  ON t.old_id  = b.id
LEFT JOIN _map_session    ss ON ss.old_id = b."designSessionId"
LEFT JOIN _map_sprint     sp ON sp.old_id = b."sprintId"
LEFT JOIN _map_userstory  us ON us.old_id = b."userStoryId";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'Task: %', v_count;

-- ===========================================================================
-- AcceptanceCriterion (via UserStory ou Task)
-- ===========================================================================
INSERT INTO "AcceptanceCriterion" (id, "userStoryId", "taskId", text, "order", "checkedAt", "checkedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid(), us.new_id, t.new_id, b.text, b."order", b."checkedAt", b."checkedBy", b."createdAt", b."updatedAt"
FROM backup_zelar_20260509."AcceptanceCriterion" b
LEFT JOIN _map_userstory us ON us.old_id = b."userStoryId"
LEFT JOIN _map_task      t  ON t.old_id  = b."taskId"
WHERE us.new_id IS NOT NULL OR t.new_id IS NOT NULL;
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'AcceptanceCriterion: %', v_count;

-- ===========================================================================
-- TaskDependency (PK composta — pula linhas onde nao achou ambos)
-- ===========================================================================
INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind, "createdAt")
SELECT t1.new_id, t2.new_id, b.kind, b."createdAt"
FROM backup_zelar_20260509."TaskDependency" b
JOIN _map_task t1 ON t1.old_id = b."taskId"
JOIN _map_task t2 ON t2.old_id = b."dependsOn";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'TaskDependency: %', v_count;

-- ===========================================================================
-- TaskTagAssignment
-- ===========================================================================
INSERT INTO "TaskTagAssignment" ("taskId", "tagId", "createdAt")
SELECT t.new_id, tg.new_id, b."createdAt"
FROM backup_zelar_20260509."TaskTagAssignment" b
JOIN _map_task t ON t.old_id = b."taskId"
JOIN _map_tasktag tg ON tg.old_id = b."tagId";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'TaskTagAssignment: %', v_count;

-- ===========================================================================
-- ChatThread (sessionId opcional, pode ser null)
-- ===========================================================================
INSERT INTO "ChatThread" (
  id, "sessionId", channel, title, "createdBy", "createdAt", "updatedAt",
  "agentId", "agentName", "agentVersionId"
)
SELECT ct.new_id, ss.new_id, b.channel, b.title, b."createdBy", b."createdAt", b."updatedAt",
       b."agentId", b."agentName", b."agentVersionId"
FROM backup_zelar_20260509."ChatThread" b
JOIN _map_chatthread ct ON ct.old_id = b.id
LEFT JOIN _map_session ss ON ss.old_id = b."sessionId";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'ChatThread: %', v_count;

-- ===========================================================================
-- ChatMessage
-- ===========================================================================
INSERT INTO "ChatMessage" (id, "threadId", role, content, "toolCalls", "toolResults", actions, "createdAt", feedback, parts)
SELECT gen_random_uuid(), ct.new_id, b.role, b.content, b."toolCalls", b."toolResults", b.actions, b."createdAt", b.feedback, b.parts
FROM backup_zelar_20260509."ChatMessage" b
JOIN _map_chatthread ct ON ct.old_id = b."threadId";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'ChatMessage: %', v_count;

-- ===========================================================================
-- AgentQualityLog
-- ===========================================================================
INSERT INTO "AgentQualityLog" (
  id, "agentSlug", "projectId", "memberId", "threadId", category, payload,
  "humanVerdict", "verdictAt", "verdictSource", "createdAt"
)
SELECT gen_random_uuid(), b."agentSlug", v_new_pid, b."memberId",
       COALESCE(ct.new_id, b."threadId"),  -- usa thread clonada se existir
       b.category, b.payload, b."humanVerdict", b."verdictAt", b."verdictSource", b."createdAt"
FROM backup_zelar_20260509."AgentQualityLog" b
LEFT JOIN _map_chatthread ct ON ct.old_id = b."threadId";
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'AgentQualityLog: %', v_count;

-- ===========================================================================
-- MeetingProjectReview (mantem meetingId/memberId apontando pros originais)
-- ===========================================================================
INSERT INTO "MeetingProjectReview" (
  id, "meetingId", "projectId", "memberId", "nextSteps", "sprintHealth",
  "attentionPoints", "additionalNotes", "order", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), b."meetingId", v_new_pid, b."memberId", b."nextSteps", b."sprintHealth",
       b."attentionPoints", b."additionalNotes", b."order", b."createdAt", b."updatedAt"
FROM backup_zelar_20260509."MeetingProjectReview" b;
GET DIAGNOSTICS v_count = ROW_COUNT; RAISE NOTICE 'MeetingProjectReview: %', v_count;

RAISE NOTICE '=== Clone concluido. Novo Project: % ===', v_new_pid;
RAISE NOTICE 'Ver no UI buscando referenceKey ZLAR_BAK ou nome "Zelar (Backup 2026-05-09)"';

END $clone$;

COMMIT;
