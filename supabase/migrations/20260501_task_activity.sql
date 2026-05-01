-- Task activity log: records duplicate/clone (and future) events per task.
BEGIN;

CREATE TABLE IF NOT EXISTS public."TaskActivity" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId"        uuid NOT NULL REFERENCES public."Task"(id) ON DELETE CASCADE,
  type            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actorMemberId" uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "TaskActivity_taskId_createdAt_idx"
  ON public."TaskActivity" ("taskId", "createdAt" DESC);

ALTER TABLE public."TaskActivity" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_activity_read"   ON public."TaskActivity";
DROP POLICY IF EXISTS "task_activity_insert" ON public."TaskActivity";

CREATE POLICY "task_activity_read" ON public."TaskActivity" FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public."Task" t
    JOIN public."ProjectMember" pm ON pm."projectId" = t."projectId"
    JOIN public."Member" m         ON m.id           = pm."memberId"
    WHERE t.id = "TaskActivity"."taskId"
      AND m."userId" = auth.uid()
  ));

CREATE POLICY "task_activity_insert" ON public."TaskActivity" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public."Task" t
    JOIN public."ProjectMember" pm ON pm."projectId" = t."projectId"
    JOIN public."Member" m         ON m.id           = pm."memberId"
    WHERE t.id = "TaskActivity"."taskId"
      AND m."userId" = auth.uid()
  ));

COMMIT;
