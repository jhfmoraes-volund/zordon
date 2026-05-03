-- Fix RLS for TaskActivity and TaskComment to use ProjectAccess (not ProjectMember).
-- Original policies (20260501_task_activity.sql / 20260502_task_comments.sql) used
-- ProjectMember, which models *allocation* (FP, sprint capacity), not *access*.
-- A user with ProjectAccess role=lead/contributor but no ProjectMember row was
-- silently blocked. Align with canViewProject/canEditTasks helpers in src/lib/dal.ts.
BEGIN;

-- ─── TaskActivity ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "task_activity_read"   ON public."TaskActivity";
DROP POLICY IF EXISTS "task_activity_insert" ON public."TaskActivity";

-- SELECT: anyone with any ProjectAccess role can read the audit trail.
CREATE POLICY "task_activity_read" ON public."TaskActivity" FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public."Task" t
    JOIN public."ProjectAccess" pa ON pa."projectId" = t."projectId"
    WHERE t.id = "TaskActivity"."taskId"
      AND pa."userId" = auth.uid()
  ));

-- INSERT: contributor/lead can write activity (matches canEditTasks).
-- In practice the recorder runs through service_role (db()), so this only
-- gates direct writes from the JS client; kept tight for defense in depth.
CREATE POLICY "task_activity_insert" ON public."TaskActivity" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public."Task" t
    JOIN public."ProjectAccess" pa ON pa."projectId" = t."projectId"
    WHERE t.id = "TaskActivity"."taskId"
      AND pa."userId" = auth.uid()
      AND pa.role IN ('contributor', 'lead')
  ));

-- ─── TaskComment ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "task_comment_read"   ON public."TaskComment";
DROP POLICY IF EXISTS "task_comment_insert" ON public."TaskComment";

-- SELECT: any project access role can read comments.
CREATE POLICY "task_comment_read" ON public."TaskComment" FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public."Task" t
    JOIN public."ProjectAccess" pa ON pa."projectId" = t."projectId"
    WHERE t.id = "TaskComment"."taskId"
      AND pa."userId" = auth.uid()
  ));

-- INSERT: contributor/lead — same gate as canEditTasks. The route also runs
-- requireProjectMemberApi (= requireProjectEditTasksApi) so this is parity.
CREATE POLICY "task_comment_insert" ON public."TaskComment" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public."Task" t
    JOIN public."ProjectAccess" pa ON pa."projectId" = t."projectId"
    WHERE t.id = "TaskComment"."taskId"
      AND pa."userId" = auth.uid()
      AND pa.role IN ('contributor', 'lead')
  ));

-- UPDATE/DELETE policies stay as-is: scoped by authorMemberId = current member.

COMMIT;
