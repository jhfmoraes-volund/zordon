-- =============================================================================
-- Backup snapshot — projeto Zelar (pre-reorganizacao de modules)
-- =============================================================================
-- Cria schema `backup_zelar_20260509` com copia integra de todas as linhas
-- relacionadas ao projeto Zelar (e41c492e-7a14-44b2-83b9-b8e0f2b38e4c).
--
-- Inclui:
--   - Project + tabelas filhas diretas (Module, UserStory, Task, Sprint, etc)
--   - DesignSession + tabelas filhas (StepData, BrainstormFeature, Item, etc)
--   - AcceptanceCriterion (via story e via task)
--   - Task children (Dependency, TagAssignment)
--   - Runbook tables (task_anchor, story_coverage)
--   - Meta table com counts pra auditoria
--
-- Snapshot e read-only (CREATE TABLE AS, sem FKs/PKs/triggers).
-- Restore manual via INSERT...SELECT reverso se necessario.
-- =============================================================================

BEGIN;

DROP SCHEMA IF EXISTS backup_zelar_20260509 CASCADE;
CREATE SCHEMA backup_zelar_20260509;

DO $bk$
DECLARE
  v_pid uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_count int;
BEGIN

-- ===========================================================================
-- 1. Tabelas filhas diretas de Project
-- ===========================================================================
EXECUTE format('CREATE TABLE backup_zelar_20260509."Project" AS SELECT * FROM "Project" WHERE id = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'Project: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."Module" AS SELECT * FROM "Module" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'Module: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."ProjectPersona" AS SELECT * FROM "ProjectPersona" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'ProjectPersona: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."ProjectMember" AS SELECT * FROM "ProjectMember" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'ProjectMember: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."ProjectAccess" AS SELECT * FROM "ProjectAccess" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'ProjectAccess: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."ProjectSquad" AS SELECT * FROM "ProjectSquad" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'ProjectSquad: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."ProjectBusinessContext" AS SELECT * FROM "ProjectBusinessContext" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'ProjectBusinessContext: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."ProjectWikiSection" AS SELECT * FROM "ProjectWikiSection" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'ProjectWikiSection: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."Sprint" AS SELECT * FROM "Sprint" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'Sprint: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."TaskTag" AS SELECT * FROM "TaskTag" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'TaskTag: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."UserStory" AS SELECT * FROM "UserStory" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'UserStory: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."Task" AS SELECT * FROM "Task" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'Task: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."DesignSession" AS SELECT * FROM "DesignSession" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'DesignSession: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."DesignDecision" AS SELECT * FROM "DesignDecision" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'DesignDecision: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."DesignOpenQuestion" AS SELECT * FROM "DesignOpenQuestion" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'DesignOpenQuestion: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."DesignSessionResearch" AS SELECT * FROM "DesignSessionResearch" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'DesignSessionResearch: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."DesignSessionTranscript" AS SELECT * FROM "DesignSessionTranscript" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'DesignSessionTranscript: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."AgentQualityLog" AS SELECT * FROM "AgentQualityLog" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'AgentQualityLog: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."MeetingProjectLink" AS SELECT * FROM "MeetingProjectLink" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'MeetingProjectLink: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."MeetingProjectReview" AS SELECT * FROM "MeetingProjectReview" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'MeetingProjectReview: % rows', v_count;

EXECUTE format('CREATE TABLE backup_zelar_20260509."MeetingTaskAction" AS SELECT * FROM "MeetingTaskAction" WHERE "projectId" = %L', v_pid);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'MeetingTaskAction: % rows', v_count;

-- ===========================================================================
-- 2. Tabelas indiretas via Module
-- ===========================================================================
CREATE TABLE backup_zelar_20260509."ModuleActivity" AS
SELECT * FROM "ModuleActivity"
WHERE "moduleId" IN (SELECT id FROM backup_zelar_20260509."Module");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'ModuleActivity: % rows', v_count;

-- ===========================================================================
-- 3. Tabelas indiretas via UserStory
-- ===========================================================================
CREATE TABLE backup_zelar_20260509."AcceptanceCriterion" AS
SELECT * FROM "AcceptanceCriterion"
WHERE "userStoryId" IN (SELECT id FROM backup_zelar_20260509."UserStory")
   OR "taskId" IN (SELECT id FROM backup_zelar_20260509."Task");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'AcceptanceCriterion: % rows', v_count;

-- ===========================================================================
-- 4. Tabelas indiretas via Task
-- ===========================================================================
CREATE TABLE backup_zelar_20260509."TaskAssignment" AS
SELECT * FROM "TaskAssignment"
WHERE "taskId" IN (SELECT id FROM backup_zelar_20260509."Task");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'TaskAssignment: % rows', v_count;

CREATE TABLE backup_zelar_20260509."TaskActivity" AS
SELECT * FROM "TaskActivity"
WHERE "taskId" IN (SELECT id FROM backup_zelar_20260509."Task");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'TaskActivity: % rows', v_count;

CREATE TABLE backup_zelar_20260509."TaskComment" AS
SELECT * FROM "TaskComment"
WHERE "taskId" IN (SELECT id FROM backup_zelar_20260509."Task");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'TaskComment: % rows', v_count;

CREATE TABLE backup_zelar_20260509."TaskDependency" AS
SELECT * FROM "TaskDependency"
WHERE "taskId" IN (SELECT id FROM backup_zelar_20260509."Task")
   OR "dependsOn" IN (SELECT id FROM backup_zelar_20260509."Task");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'TaskDependency: % rows', v_count;

CREATE TABLE backup_zelar_20260509."TaskIteration" AS
SELECT * FROM "TaskIteration"
WHERE "taskId" IN (SELECT id FROM backup_zelar_20260509."Task");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'TaskIteration: % rows', v_count;

CREATE TABLE backup_zelar_20260509."TaskTagAssignment" AS
SELECT * FROM "TaskTagAssignment"
WHERE "taskId" IN (SELECT id FROM backup_zelar_20260509."Task");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'TaskTagAssignment: % rows', v_count;

-- ===========================================================================
-- 5. Tabelas indiretas via DesignSession
-- ===========================================================================
CREATE TABLE backup_zelar_20260509."DesignSessionParticipant" AS
SELECT * FROM "DesignSessionParticipant"
WHERE "sessionId" IN (SELECT id FROM backup_zelar_20260509."DesignSession");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'DesignSessionParticipant: % rows', v_count;

CREATE TABLE backup_zelar_20260509."DesignSessionStepData" AS
SELECT * FROM "DesignSessionStepData"
WHERE "sessionId" IN (SELECT id FROM backup_zelar_20260509."DesignSession");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'DesignSessionStepData: % rows', v_count;

CREATE TABLE backup_zelar_20260509."DesignSessionItem" AS
SELECT * FROM "DesignSessionItem"
WHERE "sessionId" IN (SELECT id FROM backup_zelar_20260509."DesignSession");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'DesignSessionItem: % rows', v_count;

CREATE TABLE backup_zelar_20260509."DesignSessionBrainstormFeature" AS
SELECT * FROM "DesignSessionBrainstormFeature"
WHERE "sessionId" IN (SELECT id FROM backup_zelar_20260509."DesignSession");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'DesignSessionBrainstormFeature: % rows', v_count;

CREATE TABLE backup_zelar_20260509."DesignSessionExportLog" AS
SELECT * FROM "DesignSessionExportLog"
WHERE "sessionId" IN (SELECT id FROM backup_zelar_20260509."DesignSession");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'DesignSessionExportLog: % rows', v_count;

CREATE TABLE backup_zelar_20260509."ChatThread" AS
SELECT * FROM "ChatThread"
WHERE "sessionId" IN (SELECT id FROM backup_zelar_20260509."DesignSession");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'ChatThread: % rows', v_count;

-- ===========================================================================
-- 6. ChatMessage (via threads salvos no backup)
-- ===========================================================================
CREATE TABLE backup_zelar_20260509."ChatMessage" AS
SELECT * FROM "ChatMessage"
WHERE "threadId" IN (SELECT id FROM backup_zelar_20260509."ChatThread");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'ChatMessage: % rows', v_count;

-- ===========================================================================
-- 7. Tabelas indiretas via Sprint
-- ===========================================================================
CREATE TABLE backup_zelar_20260509."SprintMember" AS
SELECT * FROM "SprintMember"
WHERE "sprintId" IN (SELECT id FROM backup_zelar_20260509."Sprint");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'SprintMember: % rows', v_count;

CREATE TABLE backup_zelar_20260509."SprintDeploy" AS
SELECT * FROM "SprintDeploy"
WHERE "sprintId" IN (SELECT id FROM backup_zelar_20260509."Sprint");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'SprintDeploy: % rows', v_count;

CREATE TABLE backup_zelar_20260509."SprintRetrospective" AS
SELECT * FROM "SprintRetrospective"
WHERE "sprintId" IN (SELECT id FROM backup_zelar_20260509."Sprint");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'SprintRetrospective: % rows', v_count;

-- ===========================================================================
-- 8. Tabelas runbook
-- ===========================================================================
CREATE TABLE backup_zelar_20260509."runbook_task_anchor" AS
SELECT * FROM runbook.task_anchor
WHERE "taskId" IN (SELECT id FROM backup_zelar_20260509."Task");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'runbook.task_anchor: % rows', v_count;

CREATE TABLE backup_zelar_20260509."runbook_story_coverage" AS
SELECT * FROM runbook.story_coverage
WHERE "storyId" IN (SELECT id FROM backup_zelar_20260509."UserStory");
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'runbook.story_coverage: % rows', v_count;

END $bk$;

-- =============================================================================
-- Meta table com counts e timestamp
-- =============================================================================
CREATE TABLE backup_zelar_20260509._meta (
  table_name text PRIMARY KEY,
  row_count  bigint NOT NULL,
  taken_at   timestamptz NOT NULL DEFAULT now(),
  notes      text
);

INSERT INTO backup_zelar_20260509._meta (table_name, row_count, notes) VALUES
('Project',                       (SELECT COUNT(*) FROM backup_zelar_20260509."Project"),                       'projeto Zelar'),
('Module',                        (SELECT COUNT(*) FROM backup_zelar_20260509."Module"),                        '12 modules pre-reorg'),
('ProjectPersona',                (SELECT COUNT(*) FROM backup_zelar_20260509."ProjectPersona"),                'personas v1+v2'),
('ProjectMember',                 (SELECT COUNT(*) FROM backup_zelar_20260509."ProjectMember"),                 NULL),
('ProjectAccess',                 (SELECT COUNT(*) FROM backup_zelar_20260509."ProjectAccess"),                 NULL),
('ProjectSquad',                  (SELECT COUNT(*) FROM backup_zelar_20260509."ProjectSquad"),                  NULL),
('ProjectBusinessContext',        (SELECT COUNT(*) FROM backup_zelar_20260509."ProjectBusinessContext"),        NULL),
('ProjectWikiSection',            (SELECT COUNT(*) FROM backup_zelar_20260509."ProjectWikiSection"),            NULL),
('Sprint',                        (SELECT COUNT(*) FROM backup_zelar_20260509."Sprint"),                        NULL),
('TaskTag',                       (SELECT COUNT(*) FROM backup_zelar_20260509."TaskTag"),                       NULL),
('UserStory',                     (SELECT COUNT(*) FROM backup_zelar_20260509."UserStory"),                     'v1+v2 stories'),
('Task',                          (SELECT COUNT(*) FROM backup_zelar_20260509."Task"),                          'v1 tasks (66 ZLAR-T)'),
('DesignSession',                 (SELECT COUNT(*) FROM backup_zelar_20260509."DesignSession"),                 'v1+v2 design sessions'),
('DesignDecision',                (SELECT COUNT(*) FROM backup_zelar_20260509."DesignDecision"),                NULL),
('DesignOpenQuestion',            (SELECT COUNT(*) FROM backup_zelar_20260509."DesignOpenQuestion"),            NULL),
('DesignSessionResearch',         (SELECT COUNT(*) FROM backup_zelar_20260509."DesignSessionResearch"),         NULL),
('DesignSessionTranscript',       (SELECT COUNT(*) FROM backup_zelar_20260509."DesignSessionTranscript"),       NULL),
('AgentQualityLog',               (SELECT COUNT(*) FROM backup_zelar_20260509."AgentQualityLog"),               NULL),
('MeetingProjectLink',            (SELECT COUNT(*) FROM backup_zelar_20260509."MeetingProjectLink"),            NULL),
('MeetingProjectReview',          (SELECT COUNT(*) FROM backup_zelar_20260509."MeetingProjectReview"),          NULL),
('MeetingTaskAction',             (SELECT COUNT(*) FROM backup_zelar_20260509."MeetingTaskAction"),             NULL),
('ModuleActivity',                (SELECT COUNT(*) FROM backup_zelar_20260509."ModuleActivity"),                NULL),
('AcceptanceCriterion',           (SELECT COUNT(*) FROM backup_zelar_20260509."AcceptanceCriterion"),           'AC via story + via task'),
('TaskAssignment',                (SELECT COUNT(*) FROM backup_zelar_20260509."TaskAssignment"),                NULL),
('TaskActivity',                  (SELECT COUNT(*) FROM backup_zelar_20260509."TaskActivity"),                  NULL),
('TaskComment',                   (SELECT COUNT(*) FROM backup_zelar_20260509."TaskComment"),                   NULL),
('TaskDependency',                (SELECT COUNT(*) FROM backup_zelar_20260509."TaskDependency"),                NULL),
('TaskIteration',                 (SELECT COUNT(*) FROM backup_zelar_20260509."TaskIteration"),                 NULL),
('TaskTagAssignment',             (SELECT COUNT(*) FROM backup_zelar_20260509."TaskTagAssignment"),             NULL),
('DesignSessionParticipant',      (SELECT COUNT(*) FROM backup_zelar_20260509."DesignSessionParticipant"),      NULL),
('DesignSessionStepData',         (SELECT COUNT(*) FROM backup_zelar_20260509."DesignSessionStepData"),         NULL),
('DesignSessionItem',             (SELECT COUNT(*) FROM backup_zelar_20260509."DesignSessionItem"),             NULL),
('DesignSessionBrainstormFeature',(SELECT COUNT(*) FROM backup_zelar_20260509."DesignSessionBrainstormFeature"),'SSOT brainstorm'),
('DesignSessionExportLog',        (SELECT COUNT(*) FROM backup_zelar_20260509."DesignSessionExportLog"),        NULL),
('ChatThread',                    (SELECT COUNT(*) FROM backup_zelar_20260509."ChatThread"),                    NULL),
('ChatMessage',                   (SELECT COUNT(*) FROM backup_zelar_20260509."ChatMessage"),                   NULL),
('SprintMember',                  (SELECT COUNT(*) FROM backup_zelar_20260509."SprintMember"),                  NULL),
('SprintDeploy',                  (SELECT COUNT(*) FROM backup_zelar_20260509."SprintDeploy"),                  NULL),
('SprintRetrospective',           (SELECT COUNT(*) FROM backup_zelar_20260509."SprintRetrospective"),           NULL),
('runbook_task_anchor',           (SELECT COUNT(*) FROM backup_zelar_20260509."runbook_task_anchor"),           'anchor das tasks v1'),
('runbook_story_coverage',        (SELECT COUNT(*) FROM backup_zelar_20260509."runbook_story_coverage"),        'cobertura entre stories');

COMMENT ON SCHEMA backup_zelar_20260509 IS
  'Snapshot completo do projeto Zelar (e41c492e-7a14-44b2-83b9-b8e0f2b38e4c) tirado em 2026-05-09 antes da reorganizacao de modules. Read-only.';

COMMIT;

-- Total esperado: ~2500 linhas em ~40 tabelas.
-- Para inspecionar:  SELECT * FROM backup_zelar_20260509._meta ORDER BY row_count DESC;
