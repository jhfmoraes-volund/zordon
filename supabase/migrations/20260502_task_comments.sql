-- Task comments: editable, soft-deletable, with denormalized mentions array.
-- Author is nullable + ON DELETE SET NULL (consistent with TaskActivity.actorMemberId).
BEGIN;

CREATE TABLE IF NOT EXISTS public."TaskComment" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId"             uuid NOT NULL REFERENCES public."Task"(id) ON DELETE CASCADE,
  "authorMemberId"     uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  body                 text NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 16000),
  "mentionedMemberIds" uuid[] NOT NULL DEFAULT '{}',
  "editedAt"           timestamptz,
  "deletedAt"          timestamptz,
  "createdAt"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "TaskComment_taskId_createdAt_idx"
  ON public."TaskComment" ("taskId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "TaskComment_mentionedMemberIds_idx"
  ON public."TaskComment" USING gin ("mentionedMemberIds");

ALTER TABLE public."TaskComment" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_comment_read"   ON public."TaskComment";
DROP POLICY IF EXISTS "task_comment_insert" ON public."TaskComment";
DROP POLICY IF EXISTS "task_comment_update" ON public."TaskComment";
DROP POLICY IF EXISTS "task_comment_delete" ON public."TaskComment";

-- SELECT: any project member can read
CREATE POLICY "task_comment_read" ON public."TaskComment" FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public."Task" t
    JOIN public."ProjectMember" pm ON pm."projectId" = t."projectId"
    JOIN public."Member" m         ON m.id           = pm."memberId"
    WHERE t.id = "TaskComment"."taskId"
      AND m."userId" = auth.uid()
  ));

-- INSERT: any project member can create (route sets authorMemberId)
CREATE POLICY "task_comment_insert" ON public."TaskComment" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public."Task" t
    JOIN public."ProjectMember" pm ON pm."projectId" = t."projectId"
    JOIN public."Member" m         ON m.id           = pm."memberId"
    WHERE t.id = "TaskComment"."taskId"
      AND m."userId" = auth.uid()
  ));

-- UPDATE: only the author
CREATE POLICY "task_comment_update" ON public."TaskComment" FOR UPDATE
  USING (
    "authorMemberId" IN (
      SELECT id FROM public."Member" WHERE "userId" = auth.uid()
    )
  );

-- DELETE: only the author (soft delete done at app layer; hard delete reserved for service_role)
CREATE POLICY "task_comment_delete" ON public."TaskComment" FOR DELETE
  USING (
    "authorMemberId" IN (
      SELECT id FROM public."Member" WHERE "userId" = auth.uid()
    )
  );

COMMIT;
