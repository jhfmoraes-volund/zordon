-- triggers desabilitados pra evitar side effects em UPDATEs
-- 2.3 Reescreve TODAS as colunas FK text via _id_map
-- FKs internas já dropadas em 2.2 (pra permitir UPDATE em PK depois)

BEGIN;
SET session_replication_role = replica;

-- AcceptanceCriterion
UPDATE public."AcceptanceCriterion" t SET "checkedBy"   = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."checkedBy"   AND t."checkedBy"   IS NOT NULL;
UPDATE public."AcceptanceCriterion" t SET "taskId"      = m.new_id::text FROM _id_map m WHERE m.table_name='Task'          AND m.old_id=t."taskId"      AND t."taskId"      IS NOT NULL;
UPDATE public."AcceptanceCriterion" t SET "userStoryId" = m.new_id::text FROM _id_map m WHERE m.table_name='UserStory'     AND m.old_id=t."userStoryId" AND t."userStoryId" IS NOT NULL;

-- AgentConfig / AgentHeuristic / AgentVersion
UPDATE public."AgentConfig"        t SET "agentId"      = m.new_id::text FROM _id_map m WHERE m.table_name='Agent'         AND m.old_id=t."agentId";
UPDATE public."AgentHeuristic"     t SET "agentId"      = m.new_id::text FROM _id_map m WHERE m.table_name='Agent'         AND m.old_id=t."agentId";
UPDATE public."AgentVersion"       t SET "agentId"      = m.new_id::text FROM _id_map m WHERE m.table_name='Agent'         AND m.old_id=t."agentId";

-- AgentUsage
UPDATE public."AgentUsage"         t SET "memberId"     = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."memberId"    AND t."memberId" IS NOT NULL;
UPDATE public."AgentUsage"         t SET "threadId"     = m.new_id::text FROM _id_map m WHERE m.table_name='ChatThread'    AND m.old_id=t."threadId"    AND t."threadId" IS NOT NULL;

-- ChatMessage
UPDATE public."ChatMessage"        t SET "threadId"     = m.new_id::text FROM _id_map m WHERE m.table_name='ChatThread'    AND m.old_id=t."threadId";

-- ChatThread (4 FKs)
UPDATE public."ChatThread"         t SET "agentId"        = m.new_id::text FROM _id_map m WHERE m.table_name='Agent'         AND m.old_id=t."agentId"        AND t."agentId" IS NOT NULL;
UPDATE public."ChatThread"         t SET "agentVersionId" = m.new_id::text FROM _id_map m WHERE m.table_name='AgentVersion'  AND m.old_id=t."agentVersionId" AND t."agentVersionId" IS NOT NULL;
UPDATE public."ChatThread"         t SET "createdBy"      = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."createdBy"      AND t."createdBy" IS NOT NULL;
UPDATE public."ChatThread"         t SET "sessionId"      = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId"      AND t."sessionId" IS NOT NULL;

-- DesignDecision
UPDATE public."DesignDecision"     t SET "projectId"    = m.new_id::text FROM _id_map m WHERE m.table_name='Project'        AND m.old_id=t."projectId";
UPDATE public."DesignDecision"     t SET "sessionId"    = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession'  AND m.old_id=t."sessionId";
UPDATE public."DesignDecision"     t SET "supersededBy" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignDecision' AND m.old_id=t."supersededBy" AND t."supersededBy" IS NOT NULL;

-- DesignOpenQuestion
UPDATE public."DesignOpenQuestion" t SET "projectId"    = m.new_id::text FROM _id_map m WHERE m.table_name='Project'       AND m.old_id=t."projectId";
UPDATE public."DesignOpenQuestion" t SET "sessionId"    = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";

-- DesignSession
UPDATE public."DesignSession"      t SET "createdBy"    = m.new_id::text FROM _id_map m WHERE m.table_name='Member'  AND m.old_id=t."createdBy" AND t."createdBy" IS NOT NULL;
UPDATE public."DesignSession"      t SET "projectId"    = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";

-- DesignSessionExportLog
UPDATE public."DesignSessionExportLog" t SET "memberId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."memberId" AND t."memberId" IS NOT NULL;
UPDATE public."DesignSessionExportLog" t SET "sessionId" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";

-- DesignSessionItem / Participant / Research / StepData / Transcript
UPDATE public."DesignSessionItem"  t SET "sessionId" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";
UPDATE public."DesignSessionParticipant" t SET "memberId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."memberId" AND t."memberId" IS NOT NULL;
UPDATE public."DesignSessionParticipant" t SET "sessionId" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";
UPDATE public."DesignSessionResearch" t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project'       AND m.old_id=t."projectId";
UPDATE public."DesignSessionResearch" t SET "sessionId" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";
UPDATE public."DesignSessionStepData" t SET "sessionId" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";
UPDATE public."DesignSessionTranscript" t SET "importedByMemberId" = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."importedByMemberId" AND t."importedByMemberId" IS NOT NULL;
UPDATE public."DesignSessionTranscript" t SET "projectId"          = m.new_id::text FROM _id_map m WHERE m.table_name='Project'       AND m.old_id=t."projectId";
UPDATE public."DesignSessionTranscript" t SET "sessionId"          = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";

-- Meeting / MeetingAttendee / MeetingProjectLink / MeetingProjectReview / MeetingTaskAction
UPDATE public."Meeting"            t SET "createdById" = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."createdById" AND t."createdById" IS NOT NULL;
UPDATE public."Meeting"            t SET "sprintId"    = m.new_id::text FROM _id_map m WHERE m.table_name='Sprint' AND m.old_id=t."sprintId"    AND t."sprintId" IS NOT NULL;
UPDATE public."MeetingAttendee"    t SET "meetingId"   = m.new_id::text FROM _id_map m WHERE m.table_name='Meeting' AND m.old_id=t."meetingId";
UPDATE public."MeetingAttendee"    t SET "memberId"    = m.new_id::text FROM _id_map m WHERE m.table_name='Member'  AND m.old_id=t."memberId" AND t."memberId" IS NOT NULL;
UPDATE public."MeetingProjectLink" t SET "meetingId"   = m.new_id::text FROM _id_map m WHERE m.table_name='Meeting' AND m.old_id=t."meetingId";
UPDATE public."MeetingProjectLink" t SET "projectId"   = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."MeetingProjectReview" t SET "meetingId" = m.new_id::text FROM _id_map m WHERE m.table_name='Meeting' AND m.old_id=t."meetingId";
UPDATE public."MeetingProjectReview" t SET "memberId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Member'  AND m.old_id=t."memberId";
UPDATE public."MeetingProjectReview" t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."MeetingTaskAction"  t SET "decidedById"   = m.new_id::text FROM _id_map m WHERE m.table_name='Member'  AND m.old_id=t."decidedById"   AND t."decidedById" IS NOT NULL;
UPDATE public."MeetingTaskAction"  t SET "meetingId"     = m.new_id::text FROM _id_map m WHERE m.table_name='Meeting' AND m.old_id=t."meetingId";
UPDATE public."MeetingTaskAction"  t SET "projectId"     = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."MeetingTaskAction"  t SET "targetSprintId" = m.new_id::text FROM _id_map m WHERE m.table_name='Sprint' AND m.old_id=t."targetSprintId" AND t."targetSprintId" IS NOT NULL;
UPDATE public."MeetingTaskAction"  t SET "taskId"        = m.new_id::text FROM _id_map m WHERE m.table_name='Task'    AND m.old_id=t."taskId"        AND t."taskId" IS NOT NULL;

-- Member-related
UPDATE public."MemberAssessment"   t SET "memberId" = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";
UPDATE public."MemberIntegration"  t SET "memberId" = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";
UPDATE public."MemberPDI"          t SET "memberId" = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";
UPDATE public."MemberSkill"        t SET "memberId" = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";

-- Module / PDIAction
UPDATE public."Module"             t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project'   AND m.old_id=t."projectId";
UPDATE public."PDIAction"          t SET "pdiId"     = m.new_id::text FROM _id_map m WHERE m.table_name='MemberPDI' AND m.old_id=t."pdiId";

-- Project (clientId, pmId)
UPDATE public."Project"            t SET "clientId" = m.new_id::text FROM _id_map m WHERE m.table_name='Client' AND m.old_id=t."clientId";
UPDATE public."Project"            t SET "pmId"     = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."pmId" AND t."pmId" IS NOT NULL;

-- ProjectAccess (userId/grantedBy são uuid cross-schema, intactos; só projectId)
UPDATE public."ProjectAccess"      t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";

-- ProjectBusinessContext / ProjectMember / ProjectPersona / ProjectSquad / ProjectWikiSection
UPDATE public."ProjectBusinessContext" t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."ProjectMember"      t SET "memberId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Member'  AND m.old_id=t."memberId";
UPDATE public."ProjectMember"      t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."ProjectPersona"     t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."ProjectSquad"       t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."ProjectSquad"       t SET "squadId"   = m.new_id::text FROM _id_map m WHERE m.table_name='Squad'   AND m.old_id=t."squadId";
UPDATE public."ProjectWikiSection" t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";

-- Sprint / SprintDeploy / SprintMember / SquadMember
UPDATE public."Sprint"             t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."SprintDeploy"       t SET "sprintId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Sprint'  AND m.old_id=t."sprintId";
UPDATE public."SprintMember"       t SET "memberId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";
UPDATE public."SprintMember"       t SET "sprintId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Sprint' AND m.old_id=t."sprintId";
UPDATE public."SquadMember"        t SET "memberId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";
UPDATE public."SquadMember"        t SET "squadId"   = m.new_id::text FROM _id_map m WHERE m.table_name='Squad'  AND m.old_id=t."squadId";

-- Task (5 FKs)
UPDATE public."Task"               t SET "createdById"     = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."createdById"     AND t."createdById" IS NOT NULL;
UPDATE public."Task"               t SET "designSessionId" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."designSessionId" AND t."designSessionId" IS NOT NULL;
UPDATE public."Task"               t SET "projectId"       = m.new_id::text FROM _id_map m WHERE m.table_name='Project'       AND m.old_id=t."projectId";
UPDATE public."Task"               t SET "sprintId"        = m.new_id::text FROM _id_map m WHERE m.table_name='Sprint'        AND m.old_id=t."sprintId"        AND t."sprintId" IS NOT NULL;
UPDATE public."Task"               t SET "userStoryId"     = m.new_id::text FROM _id_map m WHERE m.table_name='UserStory'     AND m.old_id=t."userStoryId"     AND t."userStoryId" IS NOT NULL;

-- TaskAssignment / TaskIteration
UPDATE public."TaskAssignment"     t SET "designSessionItemId" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSessionItem' AND m.old_id=t."designSessionItemId" AND t."designSessionItemId" IS NOT NULL;
UPDATE public."TaskAssignment"     t SET "memberId"            = m.new_id::text FROM _id_map m WHERE m.table_name='Member'            AND m.old_id=t."memberId"            AND t."memberId" IS NOT NULL;
UPDATE public."TaskAssignment"     t SET "taskId"              = m.new_id::text FROM _id_map m WHERE m.table_name='Task'              AND m.old_id=t."taskId";
UPDATE public."TaskIteration"      t SET "taskId" = m.new_id::text FROM _id_map m WHERE m.table_name='Task' AND m.old_id=t."taskId";

-- Todo (4 FKs)
UPDATE public."Todo"               t SET "assigneeId"     = m.new_id::text FROM _id_map m WHERE m.table_name='Member'              AND m.old_id=t."assigneeId";
UPDATE public."Todo"               t SET "createdById"    = m.new_id::text FROM _id_map m WHERE m.table_name='Member'              AND m.old_id=t."createdById";
UPDATE public."Todo"               t SET "meetingId"      = m.new_id::text FROM _id_map m WHERE m.table_name='Meeting'             AND m.old_id=t."meetingId"      AND t."meetingId" IS NOT NULL;
UPDATE public."Todo"               t SET "sourceReviewId" = m.new_id::text FROM _id_map m WHERE m.table_name='MeetingProjectReview' AND m.old_id=t."sourceReviewId" AND t."sourceReviewId" IS NOT NULL;

-- UserStory (7 FKs)
UPDATE public."UserStory"          t SET "acValidatedBy"        = m.new_id::text FROM _id_map m WHERE m.table_name='Member'            AND m.old_id=t."acValidatedBy"        AND t."acValidatedBy" IS NOT NULL;
UPDATE public."UserStory"          t SET "createdById"          = m.new_id::text FROM _id_map m WHERE m.table_name='Member'            AND m.old_id=t."createdById"          AND t."createdById" IS NOT NULL;
UPDATE public."UserStory"          t SET "designSessionId"      = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession'     AND m.old_id=t."designSessionId"      AND t."designSessionId" IS NOT NULL;
UPDATE public."UserStory"          t SET "designSessionItemId"  = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSessionItem' AND m.old_id=t."designSessionItemId"  AND t."designSessionItemId" IS NOT NULL;
UPDATE public."UserStory"          t SET "moduleId"             = m.new_id::text FROM _id_map m WHERE m.table_name='Module'            AND m.old_id=t."moduleId"             AND t."moduleId" IS NOT NULL;
UPDATE public."UserStory"          t SET "personaId"            = m.new_id::text FROM _id_map m WHERE m.table_name='ProjectPersona'    AND m.old_id=t."personaId"            AND t."personaId" IS NOT NULL;
UPDATE public."UserStory"          t SET "projectId"            = m.new_id::text FROM _id_map m WHERE m.table_name='Project'           AND m.old_id=t."projectId";

COMMIT;
