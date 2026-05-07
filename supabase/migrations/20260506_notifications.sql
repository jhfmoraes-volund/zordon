-- In-app notifications: per-recipient feed with coalescing + batch grouping.
-- Triggers (mentions, assignment, status, sprint lifecycle, agent changes) are
-- fired from the application layer via DAL.notifyMember(), not DB triggers,
-- so coalescing logic stays in TS where the payload is shaped.
BEGIN;

CREATE TABLE IF NOT EXISTS public."Notification" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipientMemberId" uuid NOT NULL REFERENCES public."Member"(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN (
    'mention',
    'assigned',
    'status_changed',
    'sprint_started',
    'sprint_ended',
    'agent_task_change'
  )),
  "entityType"        text NOT NULL CHECK ("entityType" IN ('task', 'sprint', 'comment')),
  "entityId"          uuid NOT NULL,
  "actorMemberId"     uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "batchId"           uuid,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  "readAt"            timestamptz,
  "createdAt"         timestamptz NOT NULL DEFAULT now()
);

-- Feed listing (recipient + chronological)
CREATE INDEX IF NOT EXISTS "Notification_recipient_createdAt_idx"
  ON public."Notification" ("recipientMemberId", "createdAt" DESC);

-- Badge unread count (partial index — only unread rows)
CREATE INDEX IF NOT EXISTS "Notification_recipient_unread_idx"
  ON public."Notification" ("recipientMemberId")
  WHERE "readAt" IS NULL;

-- Coalescing lookup: find recent unread notif for same (recipient, kind, entity)
CREATE INDEX IF NOT EXISTS "Notification_coalesce_idx"
  ON public."Notification" ("recipientMemberId", kind, "entityId", "createdAt" DESC)
  WHERE "readAt" IS NULL;

-- Batch lookup (for UI grouping when batchId is set)
CREATE INDEX IF NOT EXISTS "Notification_batch_idx"
  ON public."Notification" ("batchId")
  WHERE "batchId" IS NOT NULL;

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- service_role (DAL/API) bypasses these. Policies exist for the realtime
-- subscription that runs as the authenticated user.
ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_read_own"   ON public."Notification";
DROP POLICY IF EXISTS "notification_update_own" ON public."Notification";

CREATE POLICY "notification_read_own" ON public."Notification" FOR SELECT
  USING (
    "recipientMemberId" IN (
      SELECT id FROM public."Member" WHERE "userId" = auth.uid()
    )
  );

-- Allow client to flip readAt directly via supabase-js (cheaper than API hop).
-- Restricted to recipient's own rows; INSERT/DELETE stay service_role only.
CREATE POLICY "notification_update_own" ON public."Notification" FOR UPDATE
  USING (
    "recipientMemberId" IN (
      SELECT id FROM public."Member" WHERE "userId" = auth.uid()
    )
  )
  WITH CHECK (
    "recipientMemberId" IN (
      SELECT id FROM public."Member" WHERE "userId" = auth.uid()
    )
  );

-- ─── Realtime ───────────────────────────────────────────────────────────────
-- REPLICA IDENTITY FULL so UPDATE events carry full row (needed for filtering
-- on recipientMemberId after the change).
ALTER TABLE public."Notification" REPLICA IDENTITY FULL;

-- Add to supabase_realtime publication if not already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'Notification'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."Notification";
  END IF;
END $$;

COMMIT;
