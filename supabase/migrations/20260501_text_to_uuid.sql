-- ═══════════════════════════════════════════════════════════════════════════
-- Migra todos PKs/FKs internos de text → uuid.
-- Estratégia: wipe (TRUNCATE) + reseed posterior. Dados atuais usam CUID2
-- legado do Prisma; conversão direta com ::uuid não funciona.
--
-- Counts esperados (verificados em 2026-04-30):
--   - 42 user tables com PK 'id' text (5 outras têm PK composto, sem coluna id)
--   - 47 user tables total
--   - 86 FKs internas (drop+recreate idênticas)
--   - 82 colunas FK text → uuid
--   - 133 RLS policies (drop+recreate idênticas)
--   -   8 views (drop+recreate idênticas)
--   -  16 funções (drop+recreate, 1 com mudança de body)
--   -   1 função obsoleta dropada permanente
--   -   1 trigger recriado (sync_project_access_from_member)
--   -   2 FKs novas pra auth.users (Member.userId, DesignSessionExportLog.userId)
--   -   3 FKs cross-schema MANTIDAS intactas (AgentVersion.createdBy,
--        ProjectAccess.grantedBy, ProjectAccess.userId — todas pra auth.users)
--   -   5 colunas text whitelisted (ficam text):
--        Agent.modelId, AgentVersion.modelId, AgentUsage.modelId,
--        AgentUsage.generationId, DesignSessionTranscript.roamTranscriptId
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Pre-flight
-- ═════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF current_database() NOT IN ('postgres') THEN
    RAISE EXCEPTION 'Migration deve rodar contra DB nomeado postgres. Atual: %', current_database();
  END IF;
  RAISE NOTICE 'Pre-flight OK. Procedendo com wipe+migrate em %', current_database();
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. DROP views (8) — recriadas no step 15
-- ═════════════════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.sprint_capacity_overview;
DROP VIEW IF EXISTS public.sprint_member_capacity;
DROP VIEW IF EXISTS public.client_summary;
DROP VIEW IF EXISTS public.design_session_summary;
DROP VIEW IF EXISTS public.member_capacity_overview;
DROP VIEW IF EXISTS public.member_commitment_overview;
DROP VIEW IF EXISTS public.member_summary;
DROP VIEW IF EXISTS public.user_story_overview;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. DROP RLS policies (133) — recriadas no step 14
-- ═════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS ac_select ON public."AcceptanceCriterion";
DROP POLICY IF EXISTS ac_write ON public."AcceptanceCriterion";
DROP POLICY IF EXISTS authenticated_delete ON public."Client";
DROP POLICY IF EXISTS authenticated_insert ON public."Client";
DROP POLICY IF EXISTS authenticated_select ON public."Client";
DROP POLICY IF EXISTS authenticated_update ON public."Client";
DROP POLICY IF EXISTS manager_or_editor_delete ON public."DesignDecision";
DROP POLICY IF EXISTS manager_or_editor_insert ON public."DesignDecision";
DROP POLICY IF EXISTS manager_or_editor_update ON public."DesignDecision";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."DesignDecision";
DROP POLICY IF EXISTS manager_or_editor_delete ON public."DesignOpenQuestion";
DROP POLICY IF EXISTS manager_or_editor_insert ON public."DesignOpenQuestion";
DROP POLICY IF EXISTS manager_or_editor_update ON public."DesignOpenQuestion";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."DesignOpenQuestion";
DROP POLICY IF EXISTS manager_or_editor_delete ON public."DesignSession";
DROP POLICY IF EXISTS manager_or_editor_insert ON public."DesignSession";
DROP POLICY IF EXISTS manager_or_editor_update ON public."DesignSession";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."DesignSession";
DROP POLICY IF EXISTS "managers can read export log" ON public."DesignSessionExportLog";
DROP POLICY IF EXISTS manager_or_editor_delete ON public."DesignSessionItem";
DROP POLICY IF EXISTS manager_or_editor_insert ON public."DesignSessionItem";
DROP POLICY IF EXISTS manager_or_editor_update ON public."DesignSessionItem";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."DesignSessionItem";
DROP POLICY IF EXISTS manager_or_editor_delete ON public."DesignSessionParticipant";
DROP POLICY IF EXISTS manager_or_editor_insert ON public."DesignSessionParticipant";
DROP POLICY IF EXISTS manager_or_editor_update ON public."DesignSessionParticipant";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."DesignSessionParticipant";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."DesignSessionResearch";
DROP POLICY IF EXISTS manager_or_editor_delete ON public."DesignSessionStepData";
DROP POLICY IF EXISTS manager_or_editor_insert ON public."DesignSessionStepData";
DROP POLICY IF EXISTS manager_or_editor_update ON public."DesignSessionStepData";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."DesignSessionStepData";
DROP POLICY IF EXISTS manager_or_editor_delete ON public."DesignSessionTranscript";
DROP POLICY IF EXISTS manager_or_editor_insert ON public."DesignSessionTranscript";
DROP POLICY IF EXISTS manager_or_editor_update ON public."DesignSessionTranscript";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."DesignSessionTranscript";
DROP POLICY IF EXISTS creator_or_admin_delete ON public."Meeting";
DROP POLICY IF EXISTS creator_or_admin_update ON public."Meeting";
DROP POLICY IF EXISTS manager_insert ON public."Meeting";
DROP POLICY IF EXISTS tier_select ON public."Meeting";
DROP POLICY IF EXISTS creator_or_admin_delete ON public."MeetingAttendee";
DROP POLICY IF EXISTS creator_or_admin_insert ON public."MeetingAttendee";
DROP POLICY IF EXISTS creator_or_admin_update ON public."MeetingAttendee";
DROP POLICY IF EXISTS tier_select ON public."MeetingAttendee";
DROP POLICY IF EXISTS creator_or_admin_delete ON public."MeetingProjectLink";
DROP POLICY IF EXISTS creator_or_admin_insert ON public."MeetingProjectLink";
DROP POLICY IF EXISTS creator_or_admin_update ON public."MeetingProjectLink";
DROP POLICY IF EXISTS tier_select ON public."MeetingProjectLink";
DROP POLICY IF EXISTS creator_or_admin_delete ON public."MeetingProjectReview";
DROP POLICY IF EXISTS creator_or_admin_insert ON public."MeetingProjectReview";
DROP POLICY IF EXISTS creator_or_admin_update ON public."MeetingProjectReview";
DROP POLICY IF EXISTS tier_select ON public."MeetingProjectReview";
DROP POLICY IF EXISTS creator_or_admin_delete ON public."MeetingTaskAction";
DROP POLICY IF EXISTS creator_or_admin_insert ON public."MeetingTaskAction";
DROP POLICY IF EXISTS creator_or_admin_update ON public."MeetingTaskAction";
DROP POLICY IF EXISTS tier_select ON public."MeetingTaskAction";
DROP POLICY IF EXISTS admin_delete ON public."Member";
DROP POLICY IF EXISTS admin_insert ON public."Member";
DROP POLICY IF EXISTS admin_update ON public."Member";
DROP POLICY IF EXISTS authenticated_read ON public."Member";
DROP POLICY IF EXISTS authenticated_delete ON public."MemberAssessment";
DROP POLICY IF EXISTS authenticated_insert ON public."MemberAssessment";
DROP POLICY IF EXISTS authenticated_select ON public."MemberAssessment";
DROP POLICY IF EXISTS authenticated_update ON public."MemberAssessment";
DROP POLICY IF EXISTS self_only ON public."MemberPDI";
DROP POLICY IF EXISTS authenticated_delete ON public."MemberSkill";
DROP POLICY IF EXISTS authenticated_insert ON public."MemberSkill";
DROP POLICY IF EXISTS authenticated_select ON public."MemberSkill";
DROP POLICY IF EXISTS authenticated_update ON public."MemberSkill";
DROP POLICY IF EXISTS module_select ON public."Module";
DROP POLICY IF EXISTS module_write ON public."Module";
DROP POLICY IF EXISTS self_only ON public."PDIAction";
DROP POLICY IF EXISTS authenticated_delete ON public."Project";
DROP POLICY IF EXISTS authenticated_insert ON public."Project";
DROP POLICY IF EXISTS authenticated_update ON public."Project";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."Project";
DROP POLICY IF EXISTS manager_delete ON public."ProjectAccess";
DROP POLICY IF EXISTS manager_insert ON public."ProjectAccess";
DROP POLICY IF EXISTS manager_update ON public."ProjectAccess";
DROP POLICY IF EXISTS self_or_manager_select ON public."ProjectAccess";
DROP POLICY IF EXISTS manager_or_editor_insert ON public."ProjectBusinessContext";
DROP POLICY IF EXISTS manager_or_editor_update ON public."ProjectBusinessContext";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."ProjectBusinessContext";
DROP POLICY IF EXISTS authenticated_delete ON public."ProjectMember";
DROP POLICY IF EXISTS authenticated_insert ON public."ProjectMember";
DROP POLICY IF EXISTS authenticated_update ON public."ProjectMember";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."ProjectMember";
DROP POLICY IF EXISTS persona_select ON public."ProjectPersona";
DROP POLICY IF EXISTS persona_write ON public."ProjectPersona";
DROP POLICY IF EXISTS authenticated_delete ON public."ProjectSquad";
DROP POLICY IF EXISTS authenticated_insert ON public."ProjectSquad";
DROP POLICY IF EXISTS authenticated_update ON public."ProjectSquad";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."ProjectSquad";
DROP POLICY IF EXISTS authenticated_delete ON public."ProjectWikiSection";
DROP POLICY IF EXISTS authenticated_insert ON public."ProjectWikiSection";
DROP POLICY IF EXISTS authenticated_select ON public."ProjectWikiSection";
DROP POLICY IF EXISTS authenticated_update ON public."ProjectWikiSection";
DROP POLICY IF EXISTS authenticated_delete ON public."Sprint";
DROP POLICY IF EXISTS authenticated_insert ON public."Sprint";
DROP POLICY IF EXISTS authenticated_update ON public."Sprint";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."Sprint";
DROP POLICY IF EXISTS authenticated_delete ON public."SprintDeploy";
DROP POLICY IF EXISTS authenticated_insert ON public."SprintDeploy";
DROP POLICY IF EXISTS authenticated_select ON public."SprintDeploy";
DROP POLICY IF EXISTS authenticated_update ON public."SprintDeploy";
DROP POLICY IF EXISTS authenticated_delete ON public."Squad";
DROP POLICY IF EXISTS authenticated_insert ON public."Squad";
DROP POLICY IF EXISTS authenticated_select ON public."Squad";
DROP POLICY IF EXISTS authenticated_update ON public."Squad";
DROP POLICY IF EXISTS authenticated_delete ON public."SquadMember";
DROP POLICY IF EXISTS authenticated_insert ON public."SquadMember";
DROP POLICY IF EXISTS authenticated_select ON public."SquadMember";
DROP POLICY IF EXISTS authenticated_update ON public."SquadMember";
DROP POLICY IF EXISTS manager_or_editor_delete ON public."Task";
DROP POLICY IF EXISTS manager_or_editor_insert ON public."Task";
DROP POLICY IF EXISTS manager_or_editor_update ON public."Task";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."Task";
DROP POLICY IF EXISTS manager_or_editor_delete ON public."TaskAssignment";
DROP POLICY IF EXISTS manager_or_editor_insert ON public."TaskAssignment";
DROP POLICY IF EXISTS manager_or_editor_update ON public."TaskAssignment";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."TaskAssignment";
DROP POLICY IF EXISTS manager_or_editor_delete ON public."TaskIteration";
DROP POLICY IF EXISTS manager_or_editor_insert ON public."TaskIteration";
DROP POLICY IF EXISTS manager_or_editor_update ON public."TaskIteration";
DROP POLICY IF EXISTS manager_or_viewer_select ON public."TaskIteration";
DROP POLICY IF EXISTS "Todo_delete" ON public."Todo";
DROP POLICY IF EXISTS "Todo_insert" ON public."Todo";
DROP POLICY IF EXISTS "Todo_select" ON public."Todo";
DROP POLICY IF EXISTS "Todo_update" ON public."Todo";
DROP POLICY IF EXISTS story_delete ON public."UserStory";
DROP POLICY IF EXISTS story_insert ON public."UserStory";
DROP POLICY IF EXISTS story_select ON public."UserStory";
DROP POLICY IF EXISTS story_update ON public."UserStory";

-- ═════════════════════════════════════════════════════════════════════════
-- 4. DROP triggers que usam funções a recriar
-- ═════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS project_member_sync_access ON public."ProjectMember";

-- ═════════════════════════════════════════════════════════════════════════
-- 5. DROP functions (16 a recriar + 1 obsoleta dropada permanente)
-- CASCADE inofensivo: policies (step 3) e trigger (step 4) já foram dropados;
-- só pode pegar function-to-function deps, todas dropadas no mesmo bloco.
-- ═════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.can_view_project(text) CASCADE;
DROP FUNCTION IF EXISTS public.can_edit_sessions(text) CASCADE;
DROP FUNCTION IF EXISTS public.can_edit_tasks(text) CASCADE;
DROP FUNCTION IF EXISTS public.can_access_session(text) CASCADE;
DROP FUNCTION IF EXISTS public.can_edit_session(text) CASCADE;
DROP FUNCTION IF EXISTS public.can_view_meeting(text) CASCADE;
DROP FUNCTION IF EXISTS public.can_edit_meeting(text) CASCADE;
DROP FUNCTION IF EXISTS public.is_allocated_to(text) CASCADE;
DROP FUNCTION IF EXISTS public.next_user_story_reference(text) CASCADE;
DROP FUNCTION IF EXISTS public.ensure_wiki_sections(text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.create_meeting_with_reviews(timestamptz, jsonb, jsonb, text, text, jsonb, jsonb, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.create_meeting_with_reviews(timestamptz, jsonb, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.get_my_member_id() CASCADE;
DROP FUNCTION IF EXISTS public.delete_member_integration(text, text) CASCADE;
DROP FUNCTION IF EXISTS public.get_member_integration_secret(text, text) CASCADE;
DROP FUNCTION IF EXISTS public.set_member_integration(text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.sync_project_access_from_member() CASCADE;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. DROP FKs internas (86) — cross-schema (auth.users) ficam intactas
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public."AcceptanceCriterion" DROP CONSTRAINT "AcceptanceCriterion_checkedBy_fkey";
ALTER TABLE public."AcceptanceCriterion" DROP CONSTRAINT "AcceptanceCriterion_taskId_fkey";
ALTER TABLE public."AcceptanceCriterion" DROP CONSTRAINT "AcceptanceCriterion_userStoryId_fkey";
ALTER TABLE public."AgentConfig" DROP CONSTRAINT "AgentConfig_agentId_fkey";
ALTER TABLE public."AgentHeuristic" DROP CONSTRAINT "AgentHeuristic_agentId_fkey";
ALTER TABLE public."AgentUsage" DROP CONSTRAINT "AgentUsage_memberId_fkey";
ALTER TABLE public."AgentUsage" DROP CONSTRAINT "AgentUsage_threadId_fkey";
ALTER TABLE public."AgentVersion" DROP CONSTRAINT "AgentVersion_agentId_fkey";
ALTER TABLE public."ChatMessage" DROP CONSTRAINT "ChatMessage_threadId_fkey";
ALTER TABLE public."ChatThread" DROP CONSTRAINT "ChatThread_agentId_fkey";
ALTER TABLE public."ChatThread" DROP CONSTRAINT "ChatThread_agentVersionId_fkey";
ALTER TABLE public."ChatThread" DROP CONSTRAINT "ChatThread_createdBy_fkey";
ALTER TABLE public."ChatThread" DROP CONSTRAINT "ChatThread_sessionId_fkey";
ALTER TABLE public."DesignDecision" DROP CONSTRAINT "DesignDecision_projectId_fkey";
ALTER TABLE public."DesignDecision" DROP CONSTRAINT "DesignDecision_sessionId_fkey";
ALTER TABLE public."DesignDecision" DROP CONSTRAINT "DesignDecision_supersededBy_fkey";
ALTER TABLE public."DesignOpenQuestion" DROP CONSTRAINT "DesignOpenQuestion_projectId_fkey";
ALTER TABLE public."DesignOpenQuestion" DROP CONSTRAINT "DesignOpenQuestion_sessionId_fkey";
ALTER TABLE public."DesignSession" DROP CONSTRAINT "DesignSession_createdBy_fkey";
ALTER TABLE public."DesignSession" DROP CONSTRAINT "DesignSession_projectId_fkey";
ALTER TABLE public."DesignSessionExportLog" DROP CONSTRAINT "DesignSessionExportLog_memberId_fkey";
ALTER TABLE public."DesignSessionExportLog" DROP CONSTRAINT "DesignSessionExportLog_sessionId_fkey";
ALTER TABLE public."DesignSessionItem" DROP CONSTRAINT "DesignSessionItem_sessionId_fkey";
ALTER TABLE public."DesignSessionParticipant" DROP CONSTRAINT "DesignSessionParticipant_memberId_fkey";
ALTER TABLE public."DesignSessionParticipant" DROP CONSTRAINT "DesignSessionParticipant_sessionId_fkey";
ALTER TABLE public."DesignSessionResearch" DROP CONSTRAINT "DesignSessionResearch_projectId_fkey";
ALTER TABLE public."DesignSessionResearch" DROP CONSTRAINT "DesignSessionResearch_sessionId_fkey";
ALTER TABLE public."DesignSessionStepData" DROP CONSTRAINT "DesignSessionStepData_sessionId_fkey";
ALTER TABLE public."DesignSessionTranscript" DROP CONSTRAINT "DesignSessionTranscript_importedByMemberId_fkey";
ALTER TABLE public."DesignSessionTranscript" DROP CONSTRAINT "DesignSessionTranscript_projectId_fkey";
ALTER TABLE public."DesignSessionTranscript" DROP CONSTRAINT "DesignSessionTranscript_sessionId_fkey";
ALTER TABLE public."Meeting" DROP CONSTRAINT "Meeting_createdById_fkey";
ALTER TABLE public."Meeting" DROP CONSTRAINT "Meeting_sprintId_fkey";
ALTER TABLE public."MeetingAttendee" DROP CONSTRAINT "MeetingAttendee_meetingId_fkey";
ALTER TABLE public."MeetingAttendee" DROP CONSTRAINT "MeetingAttendee_memberId_fkey";
ALTER TABLE public."MeetingProjectLink" DROP CONSTRAINT "MeetingProjectLink_meetingId_fkey";
ALTER TABLE public."MeetingProjectLink" DROP CONSTRAINT "MeetingProjectLink_projectId_fkey";
ALTER TABLE public."MeetingProjectReview" DROP CONSTRAINT "MeetingProjectReview_meetingId_fkey";
ALTER TABLE public."MeetingProjectReview" DROP CONSTRAINT "MeetingProjectReview_memberId_fkey";
ALTER TABLE public."MeetingProjectReview" DROP CONSTRAINT "MeetingProjectReview_projectId_fkey";
ALTER TABLE public."MeetingTaskAction" DROP CONSTRAINT "MeetingTaskAction_decidedById_fkey";
ALTER TABLE public."MeetingTaskAction" DROP CONSTRAINT "MeetingTaskAction_meetingId_fkey";
ALTER TABLE public."MeetingTaskAction" DROP CONSTRAINT "MeetingTaskAction_projectId_fkey";
ALTER TABLE public."MeetingTaskAction" DROP CONSTRAINT "MeetingTaskAction_targetSprintId_fkey";
ALTER TABLE public."MeetingTaskAction" DROP CONSTRAINT "MeetingTaskAction_taskId_fkey";
ALTER TABLE public."MemberAssessment" DROP CONSTRAINT "MemberAssessment_memberId_fkey";
ALTER TABLE public."MemberIntegration" DROP CONSTRAINT "MemberIntegration_memberId_fkey";
ALTER TABLE public."MemberPDI" DROP CONSTRAINT "MemberPDI_memberId_fkey";
ALTER TABLE public."MemberSkill" DROP CONSTRAINT "MemberSkill_memberId_fkey";
ALTER TABLE public."Module" DROP CONSTRAINT "Module_projectId_fkey";
ALTER TABLE public."PDIAction" DROP CONSTRAINT "PDIAction_pdiId_fkey";
ALTER TABLE public."Project" DROP CONSTRAINT "Project_clientId_fkey";
ALTER TABLE public."Project" DROP CONSTRAINT "Project_pmId_fkey";
ALTER TABLE public."ProjectAccess" DROP CONSTRAINT "ProjectAccess_projectId_fkey";
ALTER TABLE public."ProjectBusinessContext" DROP CONSTRAINT "ProjectBusinessContext_projectId_fkey";
ALTER TABLE public."ProjectMember" DROP CONSTRAINT "ProjectMember_memberId_fkey";
ALTER TABLE public."ProjectMember" DROP CONSTRAINT "ProjectMember_projectId_fkey";
ALTER TABLE public."ProjectPersona" DROP CONSTRAINT "ProjectPersona_projectId_fkey";
ALTER TABLE public."ProjectSquad" DROP CONSTRAINT "ProjectSquad_projectId_fkey";
ALTER TABLE public."ProjectSquad" DROP CONSTRAINT "ProjectSquad_squadId_fkey";
ALTER TABLE public."ProjectWikiSection" DROP CONSTRAINT "ProjectWikiSection_projectId_fkey";
ALTER TABLE public."Sprint" DROP CONSTRAINT "Sprint_projectId_fkey";
ALTER TABLE public."SprintDeploy" DROP CONSTRAINT "SprintDeploy_sprintId_fkey";
ALTER TABLE public."SprintMember" DROP CONSTRAINT "SprintMember_memberId_fkey";
ALTER TABLE public."SprintMember" DROP CONSTRAINT "SprintMember_sprintId_fkey";
ALTER TABLE public."SquadMember" DROP CONSTRAINT "SquadMember_memberId_fkey";
ALTER TABLE public."SquadMember" DROP CONSTRAINT "SquadMember_squadId_fkey";
ALTER TABLE public."Task" DROP CONSTRAINT "Task_createdById_fkey";
ALTER TABLE public."Task" DROP CONSTRAINT "Task_projectId_fkey";
ALTER TABLE public."Task" DROP CONSTRAINT "Task_sprintId_fkey";
ALTER TABLE public."Task" DROP CONSTRAINT "Task_userStoryId_fkey";
ALTER TABLE public."TaskAssignment" DROP CONSTRAINT "TaskAssignment_designSessionItemId_fkey";
ALTER TABLE public."TaskAssignment" DROP CONSTRAINT "TaskAssignment_memberId_fkey";
ALTER TABLE public."TaskAssignment" DROP CONSTRAINT "TaskAssignment_taskId_fkey";
ALTER TABLE public."TaskIteration" DROP CONSTRAINT "TaskIteration_taskId_fkey";
ALTER TABLE public."Todo" DROP CONSTRAINT "Todo_assigneeId_fkey";
ALTER TABLE public."Todo" DROP CONSTRAINT "Todo_createdById_fkey";
ALTER TABLE public."Todo" DROP CONSTRAINT "Todo_meetingId_fkey";
ALTER TABLE public."Todo" DROP CONSTRAINT "Todo_sourceReviewId_fkey";
ALTER TABLE public."UserStory" DROP CONSTRAINT "UserStory_acValidatedBy_fkey";
ALTER TABLE public."UserStory" DROP CONSTRAINT "UserStory_createdById_fkey";
ALTER TABLE public."UserStory" DROP CONSTRAINT "UserStory_designSessionId_fkey";
ALTER TABLE public."UserStory" DROP CONSTRAINT "UserStory_designSessionItemId_fkey";
ALTER TABLE public."UserStory" DROP CONSTRAINT "UserStory_moduleId_fkey";
ALTER TABLE public."UserStory" DROP CONSTRAINT "UserStory_personaId_fkey";
ALTER TABLE public."UserStory" DROP CONSTRAINT "UserStory_projectId_fkey";

-- ═════════════════════════════════════════════════════════════════════════
-- 7. TRUNCATE — wipe data (FKs internas já dropadas no step 6;
--    cross-schema FKs em out-going pra auth.users sobrevivem)
-- ═════════════════════════════════════════════════════════════════════════
TRUNCATE
  public."AcceptanceCriterion",
  public."Agent",
  public."AgentConfig",
  public."AgentHeuristic",
  public."AgentUsage",
  public."AgentVersion",
  public."ChatMessage",
  public."ChatThread",
  public."Client",
  public."DesignDecision",
  public."DesignOpenQuestion",
  public."DesignSession",
  public."DesignSessionExportLog",
  public."DesignSessionItem",
  public."DesignSessionParticipant",
  public."DesignSessionResearch",
  public."DesignSessionStepData",
  public."DesignSessionTranscript",
  public."Meeting",
  public."MeetingAttendee",
  public."MeetingProjectLink",
  public."MeetingProjectReview",
  public."MeetingTaskAction",
  public."Member",
  public."MemberAssessment",
  public."MemberIntegration",
  public."MemberPDI",
  public."MemberSkill",
  public."Module",
  public."PDIAction",
  public."Project",
  public."ProjectAccess",
  public."ProjectBusinessContext",
  public."ProjectMember",
  public."ProjectPersona",
  public."ProjectSquad",
  public."ProjectWikiSection",
  public."Sprint",
  public."SprintDeploy",
  public."SprintMember",
  public."Squad",
  public."SquadMember",
  public."Task",
  public."TaskAssignment",
  public."TaskIteration",
  public."Todo",
  public."UserStory"
RESTART IDENTITY;

-- ═════════════════════════════════════════════════════════════════════════
-- 8. ALTER PK to uuid (42 user tables com 'id' text;
--    5 outras têm PK composto e são tratadas no step 9)
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public."AcceptanceCriterion" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."Agent" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."AgentConfig" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."AgentHeuristic" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."AgentUsage" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."AgentVersion" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."ChatMessage" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."ChatThread" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."Client" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."DesignDecision" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."DesignOpenQuestion" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."DesignSession" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."DesignSessionExportLog" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."DesignSessionItem" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."DesignSessionParticipant" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."DesignSessionResearch" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."DesignSessionStepData" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."DesignSessionTranscript" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."Meeting" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."MeetingAttendee" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."MeetingProjectReview" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."MeetingTaskAction" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."Member" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."MemberPDI" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."MemberSkill" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."Module" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."PDIAction" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."Project" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."ProjectAccess" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."ProjectMember" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."ProjectPersona" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."ProjectSquad" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."ProjectWikiSection" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."Sprint" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."SprintDeploy" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."Squad" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."SquadMember" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."Task" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."TaskAssignment" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."TaskIteration" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."Todo" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public."UserStory" ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ═════════════════════════════════════════════════════════════════════════
-- 9. ALTER FK columns to uuid (87 colunas (FK formal + Id$); whitelist de 5 externas mantida text)
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public."AcceptanceCriterion" ALTER COLUMN "checkedBy" TYPE uuid USING "checkedBy"::uuid;
ALTER TABLE public."AcceptanceCriterion" ALTER COLUMN "taskId" TYPE uuid USING "taskId"::uuid;
ALTER TABLE public."AcceptanceCriterion" ALTER COLUMN "userStoryId" TYPE uuid USING "userStoryId"::uuid;
ALTER TABLE public."AgentConfig" ALTER COLUMN "agentId" TYPE uuid USING "agentId"::uuid;
ALTER TABLE public."AgentHeuristic" ALTER COLUMN "agentId" TYPE uuid USING "agentId"::uuid;
ALTER TABLE public."AgentUsage" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."AgentUsage" ALTER COLUMN "threadId" TYPE uuid USING "threadId"::uuid;
ALTER TABLE public."AgentVersion" ALTER COLUMN "agentId" TYPE uuid USING "agentId"::uuid;
ALTER TABLE public."ChatMessage" ALTER COLUMN "threadId" TYPE uuid USING "threadId"::uuid;
ALTER TABLE public."ChatThread" ALTER COLUMN "agentId" TYPE uuid USING "agentId"::uuid;
ALTER TABLE public."ChatThread" ALTER COLUMN "agentVersionId" TYPE uuid USING "agentVersionId"::uuid;
ALTER TABLE public."ChatThread" ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid;
ALTER TABLE public."ChatThread" ALTER COLUMN "sessionId" TYPE uuid USING "sessionId"::uuid;
ALTER TABLE public."DesignDecision" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."DesignDecision" ALTER COLUMN "sessionId" TYPE uuid USING "sessionId"::uuid;
ALTER TABLE public."DesignDecision" ALTER COLUMN "supersededBy" TYPE uuid USING "supersededBy"::uuid;
ALTER TABLE public."DesignOpenQuestion" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."DesignOpenQuestion" ALTER COLUMN "sessionId" TYPE uuid USING "sessionId"::uuid;
ALTER TABLE public."DesignSession" ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid;
ALTER TABLE public."DesignSession" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."DesignSessionExportLog" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."DesignSessionExportLog" ALTER COLUMN "sessionId" TYPE uuid USING "sessionId"::uuid;
ALTER TABLE public."DesignSessionItem" ALTER COLUMN "sessionId" TYPE uuid USING "sessionId"::uuid;
ALTER TABLE public."DesignSessionParticipant" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."DesignSessionParticipant" ALTER COLUMN "sessionId" TYPE uuid USING "sessionId"::uuid;
ALTER TABLE public."DesignSessionResearch" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."DesignSessionResearch" ALTER COLUMN "sessionId" TYPE uuid USING "sessionId"::uuid;
ALTER TABLE public."DesignSessionStepData" ALTER COLUMN "sessionId" TYPE uuid USING "sessionId"::uuid;
ALTER TABLE public."DesignSessionTranscript" ALTER COLUMN "importedByMemberId" TYPE uuid USING "importedByMemberId"::uuid;
ALTER TABLE public."DesignSessionTranscript" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."DesignSessionTranscript" ALTER COLUMN "sessionId" TYPE uuid USING "sessionId"::uuid;
ALTER TABLE public."Meeting" ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid;
ALTER TABLE public."Meeting" ALTER COLUMN "sprintId" TYPE uuid USING "sprintId"::uuid;
ALTER TABLE public."MeetingAttendee" ALTER COLUMN "meetingId" TYPE uuid USING "meetingId"::uuid;
ALTER TABLE public."MeetingAttendee" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."MeetingProjectLink" ALTER COLUMN "meetingId" TYPE uuid USING "meetingId"::uuid;
ALTER TABLE public."MeetingProjectLink" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."MeetingProjectReview" ALTER COLUMN "meetingId" TYPE uuid USING "meetingId"::uuid;
ALTER TABLE public."MeetingProjectReview" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."MeetingProjectReview" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."MeetingTaskAction" ALTER COLUMN "decidedById" TYPE uuid USING "decidedById"::uuid;
ALTER TABLE public."MeetingTaskAction" ALTER COLUMN "meetingId" TYPE uuid USING "meetingId"::uuid;
ALTER TABLE public."MeetingTaskAction" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."MeetingTaskAction" ALTER COLUMN "targetSprintId" TYPE uuid USING "targetSprintId"::uuid;
ALTER TABLE public."MeetingTaskAction" ALTER COLUMN "taskId" TYPE uuid USING "taskId"::uuid;
ALTER TABLE public."MemberAssessment" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."MemberIntegration" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."MemberPDI" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."MemberSkill" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."Module" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."PDIAction" ALTER COLUMN "pdiId" TYPE uuid USING "pdiId"::uuid;
ALTER TABLE public."Project" ALTER COLUMN "clientId" TYPE uuid USING "clientId"::uuid;
ALTER TABLE public."Project" ALTER COLUMN "pmId" TYPE uuid USING "pmId"::uuid;
ALTER TABLE public."ProjectAccess" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."ProjectBusinessContext" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."ProjectMember" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."ProjectMember" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."ProjectPersona" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."ProjectSquad" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."ProjectSquad" ALTER COLUMN "squadId" TYPE uuid USING "squadId"::uuid;
ALTER TABLE public."ProjectWikiSection" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."Sprint" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."SprintDeploy" ALTER COLUMN "sprintId" TYPE uuid USING "sprintId"::uuid;
ALTER TABLE public."SprintMember" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."SprintMember" ALTER COLUMN "sprintId" TYPE uuid USING "sprintId"::uuid;
ALTER TABLE public."SquadMember" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."SquadMember" ALTER COLUMN "squadId" TYPE uuid USING "squadId"::uuid;
ALTER TABLE public."Task" ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid;
ALTER TABLE public."Task" ALTER COLUMN "designSessionId" TYPE uuid USING "designSessionId"::uuid;
ALTER TABLE public."Task" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;
ALTER TABLE public."Task" ALTER COLUMN "sprintId" TYPE uuid USING "sprintId"::uuid;
ALTER TABLE public."Task" ALTER COLUMN "userStoryId" TYPE uuid USING "userStoryId"::uuid;
ALTER TABLE public."TaskAssignment" ALTER COLUMN "designSessionItemId" TYPE uuid USING "designSessionItemId"::uuid;
ALTER TABLE public."TaskAssignment" ALTER COLUMN "memberId" TYPE uuid USING "memberId"::uuid;
ALTER TABLE public."TaskAssignment" ALTER COLUMN "taskId" TYPE uuid USING "taskId"::uuid;
ALTER TABLE public."TaskIteration" ALTER COLUMN "taskId" TYPE uuid USING "taskId"::uuid;
ALTER TABLE public."Todo" ALTER COLUMN "assigneeId" TYPE uuid USING "assigneeId"::uuid;
ALTER TABLE public."Todo" ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid;
ALTER TABLE public."Todo" ALTER COLUMN "meetingId" TYPE uuid USING "meetingId"::uuid;
ALTER TABLE public."Todo" ALTER COLUMN "sourceReviewId" TYPE uuid USING "sourceReviewId"::uuid;
ALTER TABLE public."UserStory" ALTER COLUMN "acValidatedBy" TYPE uuid USING "acValidatedBy"::uuid;
ALTER TABLE public."UserStory" ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid;
ALTER TABLE public."UserStory" ALTER COLUMN "designSessionId" TYPE uuid USING "designSessionId"::uuid;
ALTER TABLE public."UserStory" ALTER COLUMN "designSessionItemId" TYPE uuid USING "designSessionItemId"::uuid;
ALTER TABLE public."UserStory" ALTER COLUMN "moduleId" TYPE uuid USING "moduleId"::uuid;
ALTER TABLE public."UserStory" ALTER COLUMN "personaId" TYPE uuid USING "personaId"::uuid;
ALTER TABLE public."UserStory" ALTER COLUMN "projectId" TYPE uuid USING "projectId"::uuid;


-- ═════════════════════════════════════════════════════════════════════════
-- 10. RECREATE functions (16) com signatures uuid
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_member_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json->'app_metadata'->>'member_id',
    ''
  )::uuid
$$;

CREATE OR REPLACE FUNCTION public.can_view_project(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectAccess"
    WHERE "userId" = auth.uid() AND "projectId" = p_project_id
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_sessions(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectAccess"
    WHERE "userId" = auth.uid()
      AND "projectId" = p_project_id
      AND role IN ('session_participant','contributor','lead')
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_tasks(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectAccess"
    WHERE "userId" = auth.uid()
      AND "projectId" = p_project_id
      AND role IN ('contributor','lead')
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_session(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT public.is_manager() OR EXISTS (
    SELECT 1 FROM public."DesignSession" ds
    WHERE ds.id = p_session_id
      AND public.can_view_project(ds."projectId")
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_session(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT public.is_manager() OR EXISTS (
    SELECT 1 FROM public."DesignSession" ds
    WHERE ds.id = p_session_id
      AND public.can_edit_sessions(ds."projectId")
  )
$$;

CREATE OR REPLACE FUNCTION public.can_view_meeting(p_meeting_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public."Meeting" m
      JOIN public."MeetingAttendee" a ON a."meetingId" = m.id
      WHERE m.id = p_meeting_id
        AND m.type IN ('pm_review','general')
        AND a."memberId" = public.get_my_member_id()
    )
    OR EXISTS (
      SELECT 1
      FROM public."Meeting" m
      JOIN public."MeetingProjectLink" mpl ON mpl."meetingId" = m.id
      JOIN public."Project" p ON p.id = mpl."projectId"
      WHERE m.id = p_meeting_id
        AND m.type IN ('daily','super_planning')
        AND p."pmId" = public.get_my_member_id()
    )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_meeting(p_meeting_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public."Meeting"
      WHERE id = p_meeting_id
        AND "createdById" = public.get_my_member_id()
        AND public.get_my_member_id() IS NOT NULL
    )
$$;

CREATE OR REPLACE FUNCTION public.is_allocated_to(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectMember"
    WHERE "memberId" = public.get_my_member_id()
      AND "projectId" = p_project_id
  )
$$;

CREATE OR REPLACE FUNCTION public.next_user_story_reference(p_project_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_key text;
  v_seq int;
BEGIN
  SELECT "referenceKey" INTO v_key FROM public."Project" WHERE id = p_project_id;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Project % is missing referenceKey', p_project_id;
  END IF;

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM '\-US\-(\d+)$') AS int)
  ), 0) + 1
  INTO v_seq
  FROM public."UserStory"
  WHERE "projectId" = p_project_id;

  RETURN v_key || '-US-' || LPAD(v_seq::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_wiki_sections(p_project_id uuid, p_sections jsonb)
RETURNS SETOF public."ProjectWikiSection" LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public."ProjectWikiSection" ("projectId", "sectionKey", title, data, "order", "createdAt", "updatedAt")
  SELECT
    p_project_id,
    s->>'sectionKey',
    s->>'title',
    COALESCE(s->'data', '[]'::jsonb),
    (s->>'order')::int,
    now(),
    now()
  FROM jsonb_array_elements(p_sections) s
  ON CONFLICT ("projectId", "sectionKey") DO NOTHING;

  RETURN QUERY
  SELECT * FROM public."ProjectWikiSection"
  WHERE "projectId" = p_project_id
  ORDER BY "order";
END;
$$;

CREATE OR REPLACE FUNCTION public.create_meeting_with_reviews(
  p_date timestamptz,
  p_reviews jsonb DEFAULT '[]'::jsonb,
  p_carry_actions jsonb DEFAULT '[]'::jsonb,
  p_type text DEFAULT 'pm_review',
  p_title text DEFAULT NULL,
  p_attendees jsonb DEFAULT '[]'::jsonb,
  p_project_ids jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL,
  p_sprint_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_meeting_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public."Meeting"
    (id, date, "type", title, notes, "sprintId", "createdAt", "updatedAt")
  VALUES
    (v_meeting_id, p_date, p_type, p_title, p_notes, p_sprint_id, now(), now());

  INSERT INTO public."MeetingProjectReview"
    ("meetingId", "projectId", "memberId", "order", "createdAt", "updatedAt")
  SELECT
    v_meeting_id,
    (r->>'projectId')::uuid,
    (r->>'memberId')::uuid,
    (r->>'order')::int,
    now(),
    now()
  FROM jsonb_array_elements(p_reviews) r;

  INSERT INTO public."MeetingAttendee"
    ("meetingId", "memberId", "externalName", "externalEmail", "externalRole", "role", "createdAt")
  SELECT
    v_meeting_id,
    NULLIF(a->>'memberId', '')::uuid,
    NULLIF(a->>'externalName', ''),
    NULLIF(a->>'externalEmail', ''),
    NULLIF(a->>'externalRole', ''),
    NULLIF(a->>'role', ''),
    now()
  FROM jsonb_array_elements(p_attendees) a
  WHERE COALESCE(a->>'memberId', a->>'externalName') IS NOT NULL;

  INSERT INTO public."MeetingProjectLink" ("meetingId", "projectId", "createdAt")
  SELECT v_meeting_id, value::uuid, now()
  FROM jsonb_array_elements_text(p_project_ids)
  ON CONFLICT DO NOTHING;

  INSERT INTO public."Todo"
    ("meetingId", description, "assigneeId", "createdById",
     "dueDate", status, source, "createdAt", "updatedAt")
  SELECT
    v_meeting_id,
    a->>'description',
    (a->>'assigneeId')::uuid,
    (a->>'assigneeId')::uuid,
    NULLIF(a->>'dueDate', '')::timestamptz,
    'todo',
    'meeting',
    now(),
    now()
  FROM jsonb_array_elements(p_carry_actions) a
  WHERE a->>'description' IS NOT NULL;

  RETURN v_meeting_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_member_integration(p_member_id uuid, p_provider text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $$
DECLARE v_secret_id UUID;
BEGIN
  SELECT "secretId" INTO v_secret_id
  FROM public."MemberIntegration"
  WHERE "memberId" = p_member_id AND provider = p_provider;
  IF v_secret_id IS NULL THEN RETURN; END IF;
  DELETE FROM public."MemberIntegration"
  WHERE "memberId" = p_member_id AND provider = p_provider;
  DELETE FROM vault.secrets WHERE id = v_secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_member_integration_secret(p_member_id uuid, p_provider text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $$
DECLARE v_secret_id UUID; v_secret TEXT;
BEGIN
  SELECT "secretId" INTO v_secret_id
  FROM public."MemberIntegration"
  WHERE "memberId" = p_member_id AND provider = p_provider;
  IF v_secret_id IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_member_integration(p_member_id uuid, p_provider text, p_token text, p_token_hint text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $$
DECLARE v_existing_secret_id UUID; v_new_secret_id UUID;
BEGIN
  SELECT "secretId" INTO v_existing_secret_id
  FROM public."MemberIntegration"
  WHERE "memberId" = p_member_id AND provider = p_provider;

  IF v_existing_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_secret_id, p_token);
    UPDATE public."MemberIntegration"
    SET "tokenHint" = p_token_hint, "updatedAt" = now()
    WHERE "memberId" = p_member_id AND provider = p_provider;
  ELSE
    v_new_secret_id := vault.create_secret(p_token, format('member_%s_%s', p_member_id, p_provider));
    INSERT INTO public."MemberIntegration"("memberId", provider, "secretId", "tokenHint")
    VALUES (p_member_id, p_provider, v_new_secret_id, p_token_hint);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_project_access_from_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_user uuid;
BEGIN
  SELECT "userId" INTO v_user FROM public."Member" WHERE id = NEW."memberId";
  IF v_user IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public."ProjectAccess" ("userId", "projectId", role)
  VALUES (v_user, NEW."projectId", 'contributor')
  ON CONFLICT ("userId", "projectId") DO UPDATE
    SET role = CASE
      WHEN "ProjectAccess".role IN ('viewer','session_participant') THEN 'contributor'
      ELSE "ProjectAccess".role
    END;
  RETURN NEW;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 11. RECREATE trigger
-- ═════════════════════════════════════════════════════════════════════════
CREATE TRIGGER project_member_sync_access
  AFTER INSERT OR UPDATE ON public."ProjectMember"
  FOR EACH ROW EXECUTE FUNCTION public.sync_project_access_from_member();

-- ═════════════════════════════════════════════════════════════════════════
-- 12. RECREATE FKs internas (86)
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public."AcceptanceCriterion" ADD CONSTRAINT "AcceptanceCriterion_checkedBy_fkey" FOREIGN KEY ("checkedBy") REFERENCES "Member"(id);
ALTER TABLE public."AcceptanceCriterion" ADD CONSTRAINT "AcceptanceCriterion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"(id) ON DELETE CASCADE;
ALTER TABLE public."AcceptanceCriterion" ADD CONSTRAINT "AcceptanceCriterion_userStoryId_fkey" FOREIGN KEY ("userStoryId") REFERENCES "UserStory"(id) ON DELETE CASCADE;
ALTER TABLE public."AgentConfig" ADD CONSTRAINT "AgentConfig_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"(id) ON DELETE CASCADE;
ALTER TABLE public."AgentHeuristic" ADD CONSTRAINT "AgentHeuristic_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"(id) ON DELETE CASCADE;
ALTER TABLE public."AgentUsage" ADD CONSTRAINT "AgentUsage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON DELETE SET NULL;
ALTER TABLE public."AgentUsage" ADD CONSTRAINT "AgentUsage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"(id) ON DELETE SET NULL;
ALTER TABLE public."AgentVersion" ADD CONSTRAINT "AgentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"(id) ON DELETE CASCADE;
ALTER TABLE public."ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"(id) ON DELETE CASCADE;
ALTER TABLE public."ChatThread" ADD CONSTRAINT "ChatThread_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"(id);
ALTER TABLE public."ChatThread" ADD CONSTRAINT "ChatThread_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "AgentVersion"(id);
ALTER TABLE public."ChatThread" ADD CONSTRAINT "ChatThread_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Member"(id);
ALTER TABLE public."ChatThread" ADD CONSTRAINT "ChatThread_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"(id) ON DELETE CASCADE;
ALTER TABLE public."DesignDecision" ADD CONSTRAINT "DesignDecision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE;
ALTER TABLE public."DesignDecision" ADD CONSTRAINT "DesignDecision_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"(id) ON DELETE CASCADE;
ALTER TABLE public."DesignDecision" ADD CONSTRAINT "DesignDecision_supersededBy_fkey" FOREIGN KEY ("supersededBy") REFERENCES "DesignDecision"(id) ON DELETE SET NULL;
ALTER TABLE public."DesignOpenQuestion" ADD CONSTRAINT "DesignOpenQuestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE;
ALTER TABLE public."DesignOpenQuestion" ADD CONSTRAINT "DesignOpenQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"(id) ON DELETE CASCADE;
ALTER TABLE public."DesignSession" ADD CONSTRAINT "DesignSession_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Member"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."DesignSession" ADD CONSTRAINT "DesignSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."DesignSessionExportLog" ADD CONSTRAINT "DesignSessionExportLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON DELETE SET NULL;
ALTER TABLE public."DesignSessionExportLog" ADD CONSTRAINT "DesignSessionExportLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"(id) ON DELETE CASCADE;
ALTER TABLE public."DesignSessionItem" ADD CONSTRAINT "DesignSessionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."DesignSessionParticipant" ADD CONSTRAINT "DesignSessionParticipant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."DesignSessionParticipant" ADD CONSTRAINT "DesignSessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."DesignSessionResearch" ADD CONSTRAINT "DesignSessionResearch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE;
ALTER TABLE public."DesignSessionResearch" ADD CONSTRAINT "DesignSessionResearch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"(id) ON DELETE CASCADE;
ALTER TABLE public."DesignSessionStepData" ADD CONSTRAINT "DesignSessionStepData_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."DesignSessionTranscript" ADD CONSTRAINT "DesignSessionTranscript_importedByMemberId_fkey" FOREIGN KEY ("importedByMemberId") REFERENCES "Member"(id) ON DELETE SET NULL;
ALTER TABLE public."DesignSessionTranscript" ADD CONSTRAINT "DesignSessionTranscript_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE;
ALTER TABLE public."DesignSessionTranscript" ADD CONSTRAINT "DesignSessionTranscript_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"(id) ON DELETE CASCADE;
ALTER TABLE public."Meeting" ADD CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Member"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."Meeting" ADD CONSTRAINT "Meeting_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"(id) ON DELETE CASCADE;
ALTER TABLE public."MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON DELETE SET NULL;
ALTER TABLE public."MeetingProjectLink" ADD CONSTRAINT "MeetingProjectLink_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"(id) ON DELETE CASCADE;
ALTER TABLE public."MeetingProjectLink" ADD CONSTRAINT "MeetingProjectLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE;
ALTER TABLE public."MeetingProjectReview" ADD CONSTRAINT "MeetingProjectReview_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."MeetingProjectReview" ADD CONSTRAINT "MeetingProjectReview_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."MeetingProjectReview" ADD CONSTRAINT "MeetingProjectReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."MeetingTaskAction" ADD CONSTRAINT "MeetingTaskAction_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Member"(id) ON DELETE SET NULL;
ALTER TABLE public."MeetingTaskAction" ADD CONSTRAINT "MeetingTaskAction_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"(id) ON DELETE CASCADE;
ALTER TABLE public."MeetingTaskAction" ADD CONSTRAINT "MeetingTaskAction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE;
ALTER TABLE public."MeetingTaskAction" ADD CONSTRAINT "MeetingTaskAction_targetSprintId_fkey" FOREIGN KEY ("targetSprintId") REFERENCES "Sprint"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."MeetingTaskAction" ADD CONSTRAINT "MeetingTaskAction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."MemberAssessment" ADD CONSTRAINT "MemberAssessment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON DELETE CASCADE;
ALTER TABLE public."MemberIntegration" ADD CONSTRAINT "MemberIntegration_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON DELETE CASCADE;
ALTER TABLE public."MemberPDI" ADD CONSTRAINT "MemberPDI_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON DELETE CASCADE;
ALTER TABLE public."MemberSkill" ADD CONSTRAINT "MemberSkill_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON DELETE CASCADE;
ALTER TABLE public."Module" ADD CONSTRAINT "Module_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE;
ALTER TABLE public."PDIAction" ADD CONSTRAINT "PDIAction_pdiId_fkey" FOREIGN KEY ("pdiId") REFERENCES "MemberPDI"(id) ON DELETE CASCADE;
ALTER TABLE public."Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."Project" ADD CONSTRAINT "Project_pmId_fkey" FOREIGN KEY ("pmId") REFERENCES "Member"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."ProjectAccess" ADD CONSTRAINT "ProjectAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE;
ALTER TABLE public."ProjectBusinessContext" ADD CONSTRAINT "ProjectBusinessContext_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE;
ALTER TABLE public."ProjectMember" ADD CONSTRAINT "ProjectMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."ProjectPersona" ADD CONSTRAINT "ProjectPersona_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE;
ALTER TABLE public."ProjectSquad" ADD CONSTRAINT "ProjectSquad_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."ProjectSquad" ADD CONSTRAINT "ProjectSquad_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."ProjectWikiSection" ADD CONSTRAINT "ProjectWikiSection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."Sprint" ADD CONSTRAINT "Sprint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."SprintDeploy" ADD CONSTRAINT "SprintDeploy_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."SprintMember" ADD CONSTRAINT "SprintMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON DELETE CASCADE;
ALTER TABLE public."SprintMember" ADD CONSTRAINT "SprintMember_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"(id) ON DELETE CASCADE;
ALTER TABLE public."SquadMember" ADD CONSTRAINT "SquadMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."SquadMember" ADD CONSTRAINT "SquadMember_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Member"(id) ON DELETE SET NULL;
ALTER TABLE public."Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."Task" ADD CONSTRAINT "Task_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."Task" ADD CONSTRAINT "Task_userStoryId_fkey" FOREIGN KEY ("userStoryId") REFERENCES "UserStory"(id) ON DELETE SET NULL;
ALTER TABLE public."TaskAssignment" ADD CONSTRAINT "TaskAssignment_designSessionItemId_fkey" FOREIGN KEY ("designSessionItemId") REFERENCES "DesignSessionItem"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."TaskAssignment" ADD CONSTRAINT "TaskAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."TaskIteration" ADD CONSTRAINT "TaskIteration_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."Todo" ADD CONSTRAINT "Todo_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Member"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."Todo" ADD CONSTRAINT "Todo_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Member"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."Todo" ADD CONSTRAINT "Todo_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."Todo" ADD CONSTRAINT "Todo_sourceReviewId_fkey" FOREIGN KEY ("sourceReviewId") REFERENCES "MeetingProjectReview"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."UserStory" ADD CONSTRAINT "UserStory_acValidatedBy_fkey" FOREIGN KEY ("acValidatedBy") REFERENCES "Member"(id);
ALTER TABLE public."UserStory" ADD CONSTRAINT "UserStory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Member"(id);
ALTER TABLE public."UserStory" ADD CONSTRAINT "UserStory_designSessionId_fkey" FOREIGN KEY ("designSessionId") REFERENCES "DesignSession"(id) ON DELETE SET NULL;
ALTER TABLE public."UserStory" ADD CONSTRAINT "UserStory_designSessionItemId_fkey" FOREIGN KEY ("designSessionItemId") REFERENCES "DesignSessionItem"(id) ON DELETE SET NULL;
ALTER TABLE public."UserStory" ADD CONSTRAINT "UserStory_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"(id) ON DELETE SET NULL;
ALTER TABLE public."UserStory" ADD CONSTRAINT "UserStory_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "ProjectPersona"(id);
ALTER TABLE public."UserStory" ADD CONSTRAINT "UserStory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════
-- 13. ADD FKs novas pra auth.users (2 — Member.userId, DesignSessionExportLog.userId)
--     ProjectAccess.userId, ProjectAccess.grantedBy, AgentVersion.createdBy
--     já têm FK pra auth.users (não tocadas)
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public."Member"
  ADD CONSTRAINT "Member_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."DesignSessionExportLog"
  ADD CONSTRAINT "DesignSessionExportLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════
-- 14. RECREATE RLS policies (133) — bodies idênticos aos originais
-- ═════════════════════════════════════════════════════════════════════════
CREATE POLICY ac_select ON public."AcceptanceCriterion" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_manager() OR (EXISTS ( SELECT 1
   FROM "UserStory" us
  WHERE ((us.id = "AcceptanceCriterion"."userStoryId") AND can_view_project(us."projectId")))) OR (EXISTS ( SELECT 1
   FROM "Task" t
  WHERE ((t.id = "AcceptanceCriterion"."taskId") AND can_view_project(t."projectId"))))));
CREATE POLICY ac_write ON public."AcceptanceCriterion" AS PERMISSIVE FOR ALL TO authenticated
  USING ((is_manager() OR (EXISTS ( SELECT 1
   FROM "UserStory" us
  WHERE ((us.id = "AcceptanceCriterion"."userStoryId") AND can_edit_tasks(us."projectId")))) OR (EXISTS ( SELECT 1
   FROM "Task" t
  WHERE ((t.id = "AcceptanceCriterion"."taskId") AND can_edit_tasks(t."projectId"))))))
  WITH CHECK ((is_manager() OR (EXISTS ( SELECT 1
   FROM "UserStory" us
  WHERE ((us.id = "AcceptanceCriterion"."userStoryId") AND can_edit_tasks(us."projectId")))) OR (EXISTS ( SELECT 1
   FROM "Task" t
  WHERE ((t.id = "AcceptanceCriterion"."taskId") AND can_edit_tasks(t."projectId"))))));
CREATE POLICY authenticated_delete ON public."Client" AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);
CREATE POLICY authenticated_insert ON public."Client" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY authenticated_select ON public."Client" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY authenticated_update ON public."Client" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);
CREATE POLICY manager_or_editor_delete ON public."DesignDecision" AS PERMISSIVE FOR DELETE TO public
  USING ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_editor_insert ON public."DesignDecision" AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_editor_update ON public."DesignDecision" AS PERMISSIVE FOR UPDATE TO public
  USING ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_viewer_select ON public."DesignDecision" AS PERMISSIVE FOR SELECT TO public
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY manager_or_editor_delete ON public."DesignOpenQuestion" AS PERMISSIVE FOR DELETE TO public
  USING ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_editor_insert ON public."DesignOpenQuestion" AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_editor_update ON public."DesignOpenQuestion" AS PERMISSIVE FOR UPDATE TO public
  USING ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_viewer_select ON public."DesignOpenQuestion" AS PERMISSIVE FOR SELECT TO public
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY manager_or_editor_delete ON public."DesignSession" AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_editor_insert ON public."DesignSession" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_editor_update ON public."DesignSession" AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_viewer_select ON public."DesignSession" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY "managers can read export log" ON public."DesignSessionExportLog" AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_manager());
CREATE POLICY manager_or_editor_delete ON public."DesignSessionItem" AS PERMISSIVE FOR DELETE TO authenticated
  USING (can_edit_session("sessionId"));
CREATE POLICY manager_or_editor_insert ON public."DesignSessionItem" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_edit_session("sessionId"));
CREATE POLICY manager_or_editor_update ON public."DesignSessionItem" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_edit_session("sessionId"));
CREATE POLICY manager_or_viewer_select ON public."DesignSessionItem" AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_access_session("sessionId"));
CREATE POLICY manager_or_editor_delete ON public."DesignSessionParticipant" AS PERMISSIVE FOR DELETE TO authenticated
  USING (can_edit_session("sessionId"));
CREATE POLICY manager_or_editor_insert ON public."DesignSessionParticipant" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_edit_session("sessionId"));
CREATE POLICY manager_or_editor_update ON public."DesignSessionParticipant" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_edit_session("sessionId"));
CREATE POLICY manager_or_viewer_select ON public."DesignSessionParticipant" AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_access_session("sessionId"));
CREATE POLICY manager_or_viewer_select ON public."DesignSessionResearch" AS PERMISSIVE FOR SELECT TO public
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY manager_or_editor_delete ON public."DesignSessionStepData" AS PERMISSIVE FOR DELETE TO authenticated
  USING (can_edit_session("sessionId"));
CREATE POLICY manager_or_editor_insert ON public."DesignSessionStepData" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_edit_session("sessionId"));
CREATE POLICY manager_or_editor_update ON public."DesignSessionStepData" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_edit_session("sessionId"));
CREATE POLICY manager_or_viewer_select ON public."DesignSessionStepData" AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_access_session("sessionId"));
CREATE POLICY manager_or_editor_delete ON public."DesignSessionTranscript" AS PERMISSIVE FOR DELETE TO public
  USING ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_editor_insert ON public."DesignSessionTranscript" AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_editor_update ON public."DesignSessionTranscript" AS PERMISSIVE FOR UPDATE TO public
  USING ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_viewer_select ON public."DesignSessionTranscript" AS PERMISSIVE FOR SELECT TO public
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY creator_or_admin_delete ON public."Meeting" AS PERMISSIVE FOR DELETE TO authenticated
  USING (can_edit_meeting(id));
CREATE POLICY creator_or_admin_update ON public."Meeting" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_edit_meeting(id));
CREATE POLICY manager_insert ON public."Meeting" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_manager());
CREATE POLICY tier_select ON public."Meeting" AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_view_meeting(id));
CREATE POLICY creator_or_admin_delete ON public."MeetingAttendee" AS PERMISSIVE FOR DELETE TO authenticated
  USING (can_edit_meeting("meetingId"));
CREATE POLICY creator_or_admin_insert ON public."MeetingAttendee" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_edit_meeting("meetingId"));
CREATE POLICY creator_or_admin_update ON public."MeetingAttendee" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_edit_meeting("meetingId"));
CREATE POLICY tier_select ON public."MeetingAttendee" AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_view_meeting("meetingId"));
CREATE POLICY creator_or_admin_delete ON public."MeetingProjectLink" AS PERMISSIVE FOR DELETE TO authenticated
  USING (can_edit_meeting("meetingId"));
CREATE POLICY creator_or_admin_insert ON public."MeetingProjectLink" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_edit_meeting("meetingId"));
CREATE POLICY creator_or_admin_update ON public."MeetingProjectLink" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_edit_meeting("meetingId"));
CREATE POLICY tier_select ON public."MeetingProjectLink" AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_view_meeting("meetingId"));
CREATE POLICY creator_or_admin_delete ON public."MeetingProjectReview" AS PERMISSIVE FOR DELETE TO authenticated
  USING (can_edit_meeting("meetingId"));
CREATE POLICY creator_or_admin_insert ON public."MeetingProjectReview" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_edit_meeting("meetingId"));
CREATE POLICY creator_or_admin_update ON public."MeetingProjectReview" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_edit_meeting("meetingId"));
CREATE POLICY tier_select ON public."MeetingProjectReview" AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_view_meeting("meetingId"));
CREATE POLICY creator_or_admin_delete ON public."MeetingTaskAction" AS PERMISSIVE FOR DELETE TO authenticated
  USING (can_edit_meeting("meetingId"));
CREATE POLICY creator_or_admin_insert ON public."MeetingTaskAction" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_edit_meeting("meetingId"));
CREATE POLICY creator_or_admin_update ON public."MeetingTaskAction" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_edit_meeting("meetingId"));
CREATE POLICY tier_select ON public."MeetingTaskAction" AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_view_meeting("meetingId"));
CREATE POLICY admin_delete ON public."Member" AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());
CREATE POLICY admin_insert ON public."Member" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());
CREATE POLICY admin_update ON public."Member" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin());
CREATE POLICY authenticated_read ON public."Member" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY authenticated_delete ON public."MemberAssessment" AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);
CREATE POLICY authenticated_insert ON public."MemberAssessment" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY authenticated_select ON public."MemberAssessment" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY authenticated_update ON public."MemberAssessment" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);
CREATE POLICY self_only ON public."MemberPDI" AS PERMISSIVE FOR ALL TO authenticated
  USING (("memberId" IN ( SELECT "Member".id
   FROM "Member"
  WHERE ("Member"."userId" = auth.uid()))))
  WITH CHECK (("memberId" IN ( SELECT "Member".id
   FROM "Member"
  WHERE ("Member"."userId" = auth.uid()))));
CREATE POLICY authenticated_delete ON public."MemberSkill" AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);
CREATE POLICY authenticated_insert ON public."MemberSkill" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY authenticated_select ON public."MemberSkill" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY authenticated_update ON public."MemberSkill" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);
CREATE POLICY module_select ON public."Module" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY module_write ON public."Module" AS PERMISSIVE FOR ALL TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());
CREATE POLICY self_only ON public."PDIAction" AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM ("MemberPDI" mp
     JOIN "Member" m ON ((m.id = mp."memberId")))
  WHERE ((mp.id = "PDIAction"."pdiId") AND (m."userId" = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM ("MemberPDI" mp
     JOIN "Member" m ON ((m.id = mp."memberId")))
  WHERE ((mp.id = "PDIAction"."pdiId") AND (m."userId" = auth.uid())))));
CREATE POLICY authenticated_delete ON public."Project" AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);
CREATE POLICY authenticated_insert ON public."Project" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY authenticated_update ON public."Project" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);
CREATE POLICY manager_or_viewer_select ON public."Project" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_manager() OR can_view_project(id)));
CREATE POLICY manager_delete ON public."ProjectAccess" AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_manager());
CREATE POLICY manager_insert ON public."ProjectAccess" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_manager());
CREATE POLICY manager_update ON public."ProjectAccess" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_manager());
CREATE POLICY self_or_manager_select ON public."ProjectAccess" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((("userId" = auth.uid()) OR is_manager()));
CREATE POLICY manager_or_editor_insert ON public."ProjectBusinessContext" AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_editor_update ON public."ProjectBusinessContext" AS PERMISSIVE FOR UPDATE TO public
  USING ((is_manager() OR can_edit_sessions("projectId")));
CREATE POLICY manager_or_viewer_select ON public."ProjectBusinessContext" AS PERMISSIVE FOR SELECT TO public
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY authenticated_delete ON public."ProjectMember" AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);
CREATE POLICY authenticated_insert ON public."ProjectMember" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY authenticated_update ON public."ProjectMember" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);
CREATE POLICY manager_or_viewer_select ON public."ProjectMember" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY persona_select ON public."ProjectPersona" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY persona_write ON public."ProjectPersona" AS PERMISSIVE FOR ALL TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());
CREATE POLICY authenticated_delete ON public."ProjectSquad" AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);
CREATE POLICY authenticated_insert ON public."ProjectSquad" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY authenticated_update ON public."ProjectSquad" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);
CREATE POLICY manager_or_viewer_select ON public."ProjectSquad" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY authenticated_delete ON public."ProjectWikiSection" AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);
CREATE POLICY authenticated_insert ON public."ProjectWikiSection" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY authenticated_select ON public."ProjectWikiSection" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY authenticated_update ON public."ProjectWikiSection" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);
CREATE POLICY authenticated_delete ON public."Sprint" AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);
CREATE POLICY authenticated_insert ON public."Sprint" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY authenticated_update ON public."Sprint" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);
CREATE POLICY manager_or_viewer_select ON public."Sprint" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY authenticated_delete ON public."SprintDeploy" AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);
CREATE POLICY authenticated_insert ON public."SprintDeploy" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY authenticated_select ON public."SprintDeploy" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY authenticated_update ON public."SprintDeploy" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);
CREATE POLICY authenticated_delete ON public."Squad" AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);
CREATE POLICY authenticated_insert ON public."Squad" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY authenticated_select ON public."Squad" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY authenticated_update ON public."Squad" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);
CREATE POLICY authenticated_delete ON public."SquadMember" AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);
CREATE POLICY authenticated_insert ON public."SquadMember" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY authenticated_select ON public."SquadMember" AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY authenticated_update ON public."SquadMember" AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);
CREATE POLICY manager_or_editor_delete ON public."Task" AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_manager() OR can_edit_tasks("projectId")));
CREATE POLICY manager_or_editor_insert ON public."Task" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_manager() OR can_edit_tasks("projectId")));
CREATE POLICY manager_or_editor_update ON public."Task" AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_manager() OR can_edit_tasks("projectId")));
CREATE POLICY manager_or_viewer_select ON public."Task" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY manager_or_editor_delete ON public."TaskAssignment" AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_manager() OR (EXISTS ( SELECT 1
   FROM "Task" t
  WHERE ((t.id = "TaskAssignment"."taskId") AND can_edit_tasks(t."projectId"))))));
CREATE POLICY manager_or_editor_insert ON public."TaskAssignment" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_manager() OR (EXISTS ( SELECT 1
   FROM "Task" t
  WHERE ((t.id = "TaskAssignment"."taskId") AND can_edit_tasks(t."projectId"))))));
CREATE POLICY manager_or_editor_update ON public."TaskAssignment" AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_manager() OR (EXISTS ( SELECT 1
   FROM "Task" t
  WHERE ((t.id = "TaskAssignment"."taskId") AND can_edit_tasks(t."projectId"))))));
CREATE POLICY manager_or_viewer_select ON public."TaskAssignment" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_manager() OR (EXISTS ( SELECT 1
   FROM "Task" t
  WHERE ((t.id = "TaskAssignment"."taskId") AND can_view_project(t."projectId"))))));
CREATE POLICY manager_or_editor_delete ON public."TaskIteration" AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_manager() OR (EXISTS ( SELECT 1
   FROM "Task" t
  WHERE ((t.id = "TaskIteration"."taskId") AND can_edit_tasks(t."projectId"))))));
CREATE POLICY manager_or_editor_insert ON public."TaskIteration" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_manager() OR (EXISTS ( SELECT 1
   FROM "Task" t
  WHERE ((t.id = "TaskIteration"."taskId") AND can_edit_tasks(t."projectId"))))));
CREATE POLICY manager_or_editor_update ON public."TaskIteration" AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_manager() OR (EXISTS ( SELECT 1
   FROM "Task" t
  WHERE ((t.id = "TaskIteration"."taskId") AND can_edit_tasks(t."projectId"))))));
CREATE POLICY manager_or_viewer_select ON public."TaskIteration" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_manager() OR (EXISTS ( SELECT 1
   FROM "Task" t
  WHERE ((t.id = "TaskIteration"."taskId") AND can_view_project(t."projectId"))))));
CREATE POLICY "Todo_delete" ON public."Todo" AS PERMISSIVE FOR DELETE TO authenticated
  USING ((("createdById" = get_my_member_id()) OR is_manager()));
CREATE POLICY "Todo_insert" ON public."Todo" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((("createdById" = get_my_member_id()) AND (("assigneeId" = get_my_member_id()) OR is_manager())));
CREATE POLICY "Todo_select" ON public."Todo" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((("assigneeId" = get_my_member_id()) OR is_manager()));
CREATE POLICY "Todo_update" ON public."Todo" AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((("assigneeId" = get_my_member_id()) OR ("createdById" = get_my_member_id()) OR is_manager()));
CREATE POLICY story_delete ON public."UserStory" AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_manager());
CREATE POLICY story_insert ON public."UserStory" AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_manager() OR can_edit_tasks("projectId")));
CREATE POLICY story_select ON public."UserStory" AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_manager() OR can_view_project("projectId")));
CREATE POLICY story_update ON public."UserStory" AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_manager() OR can_edit_tasks("projectId")))
  WITH CHECK ((is_manager() OR can_edit_tasks("projectId")));

-- ═════════════════════════════════════════════════════════════════════════
-- 15. RECREATE views (8) — ordem: sprint_member_capacity ANTES de
--     sprint_capacity_overview (dependência)
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.client_summary AS
 SELECT id,
    name,
    email,
    phone,
    notes,
    "createdAt",
    "updatedAt",
    (( SELECT count(*) AS count
           FROM "Project" p
          WHERE (p."clientId" = c.id)))::integer AS project_count
   FROM "Client" c;

CREATE OR REPLACE VIEW public.design_session_summary AS
 SELECT ds.id,
    ds."projectId",
    ds.type,
    ds.status,
    ds.title,
    ds.description,
    ds."currentStep",
    ds."totalSteps",
    ds."scheduledAt",
    ds."completedAt",
    ds."actualDurationMin",
    ds."createdBy",
    ds."createdAt",
    ds."updatedAt",
    (count(dsi.id))::integer AS item_count
   FROM ("DesignSession" ds
     LEFT JOIN "DesignSessionItem" dsi ON ((dsi."sessionId" = ds.id)))
  GROUP BY ds.id;

CREATE OR REPLACE VIEW public.member_capacity_overview AS
 SELECT m.id,
    m.name,
    m.role,
    m."fpCapacity" AS fp_capacity,
    (COALESCE(sum(t."functionPoints") FILTER (WHERE (t.status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'review'::text, 'changes_requested'::text]))), (0)::bigint))::integer AS fp_allocated,
    (count(ta.id) FILTER (WHERE (t.status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'review'::text, 'changes_requested'::text]))))::integer AS active_task_count
   FROM (("Member" m
     LEFT JOIN "TaskAssignment" ta ON ((ta."memberId" = m.id)))
     LEFT JOIN "Task" t ON ((t.id = ta."taskId")))
  GROUP BY m.id, m.name, m.role, m."fpCapacity";

CREATE OR REPLACE VIEW public.member_commitment_overview AS
 SELECT m.id,
    m.name,
    m.role,
    m."fpCapacity" AS capacity,
    (COALESCE(sum(pm."fpAllocation"), (0)::bigint))::integer AS committed,
    ((m."fpCapacity" - COALESCE(sum(pm."fpAllocation"), (0)::bigint)))::integer AS remaining,
    (count(DISTINCT pm."projectId"))::integer AS project_count
   FROM ("Member" m
     LEFT JOIN "ProjectMember" pm ON ((pm."memberId" = m.id)))
  GROUP BY m.id, m.name, m.role, m."fpCapacity";

CREATE OR REPLACE VIEW public.member_summary AS
 SELECT id,
    name,
    email,
    role,
    "githubUsername",
    "fpCapacity",
    "createdAt",
    "updatedAt",
    "userId",
    (( SELECT count(*) AS count
           FROM "SquadMember" sm
          WHERE (sm."memberId" = m.id)))::integer AS squad_count,
    (( SELECT count(*) AS count
           FROM ("TaskAssignment" ta
             JOIN "Task" t ON ((t.id = ta."taskId")))
          WHERE ((ta."memberId" = m.id) AND (t.status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'review'::text, 'changes_requested'::text])))))::integer AS active_task_count
   FROM "Member" m;

CREATE OR REPLACE VIEW public.sprint_member_capacity AS
 SELECT s.id AS "sprintId",
    pm."memberId",
    m.name AS member_name,
    s."projectId",
    COALESCE(sm."fpAllocation", pm."fpAllocation") AS fp_allocation,
    (COALESCE(agg.fp_planned, (0)::bigint))::integer AS fp_planned,
    (COALESCE(agg.fp_done, (0)::bigint))::integer AS fp_done,
    (COALESCE(agg.fp_open, (0)::bigint))::integer AS fp_open,
    (sm."fpAllocation" IS NOT NULL) AS has_sprint_override
   FROM (((("Sprint" s
     JOIN "ProjectMember" pm ON ((pm."projectId" = s."projectId")))
     JOIN "Member" m ON ((m.id = pm."memberId")))
     LEFT JOIN "SprintMember" sm ON (((sm."sprintId" = s.id) AND (sm."memberId" = pm."memberId"))))
     LEFT JOIN LATERAL ( SELECT sum(t."functionPoints") FILTER (WHERE (t.status <> 'backlog'::text)) AS fp_planned,
            sum(t."functionPoints") FILTER (WHERE (t.status = 'done'::text)) AS fp_done,
            sum(t."functionPoints") FILTER (WHERE (t.status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'review'::text, 'changes_requested'::text]))) AS fp_open
           FROM ("Task" t
             JOIN "TaskAssignment" ta ON ((ta."taskId" = t.id)))
          WHERE ((t."sprintId" = s.id) AND (ta."memberId" = pm."memberId"))) agg ON (true));

CREATE OR REPLACE VIEW public.sprint_capacity_overview AS
 SELECT "sprintId",
    (sum(fp_allocation))::integer AS capacity,
    (sum(fp_planned))::integer AS planned,
    (sum(fp_done))::integer AS done,
    (sum(fp_open))::integer AS open
   FROM sprint_member_capacity
  GROUP BY "sprintId";

CREATE OR REPLACE VIEW public.user_story_overview AS
 SELECT us.id AS "userStoryId",
    us."projectId",
    us."moduleId",
    us.reference,
    us.title,
    us."refinementStatus",
    us."acValidatedAt",
    count(t.id) AS "totalTasks",
    count(t.id) FILTER (WHERE (t.status = 'done'::text)) AS "doneTasks",
    COALESCE(sum(t."functionPoints"), (0)::bigint) AS "totalFunctionPoints",
    COALESCE(sum(t."functionPoints") FILTER (WHERE (t.status = 'done'::text)), (0)::bigint) AS "doneFunctionPoints",
        CASE
            WHEN (count(t.id) = 0) THEN 'pending'::text
            WHEN ((count(t.id) FILTER (WHERE (t.status = 'done'::text)) = count(t.id)) AND (us."acValidatedAt" IS NOT NULL)) THEN 'done'::text
            WHEN (count(t.id) FILTER (WHERE (t.status = 'done'::text)) = count(t.id)) THEN 'tasks_complete'::text
            WHEN (count(t.id) FILTER (WHERE (t.status = ANY (ARRAY['done'::text, 'in_progress'::text, 'review'::text]))) > 0) THEN 'in_progress'::text
            ELSE 'pending'::text
        END AS "computedStatus"
   FROM ("UserStory" us
     LEFT JOIN "Task" t ON ((t."userStoryId" = us.id)))
  GROUP BY us.id;

-- ═════════════════════════════════════════════════════════════════════════
-- 16. Post-flight
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  cnt_text_id INT;
  cnt_fks INT;
  cnt_policies INT;
  cnt_funcs INT;
  cnt_views INT;
BEGIN
  SELECT count(*) INTO cnt_text_id
  FROM information_schema.columns c
  JOIN information_schema.tables t USING (table_schema, table_name)
  WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
    AND c.data_type='text'
    AND (c.column_name='id' OR c.column_name ~ 'Id$')
    AND NOT (
      (c.table_name='Agent' AND c.column_name='modelId') OR
      (c.table_name='AgentVersion' AND c.column_name='modelId') OR
      (c.table_name='AgentUsage' AND c.column_name='modelId') OR
      (c.table_name='AgentUsage' AND c.column_name='generationId') OR
      (c.table_name='DesignSessionTranscript' AND c.column_name='roamTranscriptId') OR
      (c.table_name='_prisma_migrations' AND c.column_name='id')
    );
  IF cnt_text_id > 0 THEN
    RAISE EXCEPTION 'Post-flight FAILED: % colunas ainda em text', cnt_text_id;
  END IF;

  SELECT count(*) INTO cnt_fks
  FROM information_schema.table_constraints
  WHERE constraint_type='FOREIGN KEY' AND table_schema='public';
  IF cnt_fks < 88 THEN
    RAISE EXCEPTION 'Post-flight FAILED: só % FKs (esperado >= 88)', cnt_fks;
  END IF;

  SELECT count(*) INTO cnt_policies FROM pg_policies WHERE schemaname='public';
  IF cnt_policies <> 133 THEN
    RAISE EXCEPTION 'Post-flight FAILED: % policies (esperado 133)', cnt_policies;
  END IF;

  SELECT count(*) INTO cnt_funcs
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind='f';
  IF cnt_funcs < 20 THEN
    RAISE EXCEPTION 'Post-flight FAILED: só % funções (esperado >= 20)', cnt_funcs;
  END IF;

  SELECT count(*) INTO cnt_views FROM information_schema.views WHERE table_schema='public';
  IF cnt_views <> 8 THEN
    RAISE EXCEPTION 'Post-flight FAILED: % views (esperado 8)', cnt_views;
  END IF;

  RAISE NOTICE 'Post-flight OK. text_id=% fks=% policies=% funcs=% views=%',
    cnt_text_id, cnt_fks, cnt_policies, cnt_funcs, cnt_views;
END $$;

COMMIT;
