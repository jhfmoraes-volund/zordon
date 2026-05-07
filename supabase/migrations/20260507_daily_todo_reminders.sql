-- Daily to-do reminders. Scheduled via pg_cron, delivered through the
-- existing Notification table → AFTER INSERT trigger → telegram-notify.
--
-- Two slots per member: morning + evening, each independently toggleable
-- with a configurable HH:MM (30-minute granularity, enforced in app layer).
-- Times are stored in America/Sao_Paulo. The cron itself runs in UTC at
-- :00 and :30 of every hour and asks the enqueue function to find members
-- whose local slot matches "now".
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- ─── Notification kind: daily_todos ────────────────────────────────────────
ALTER TABLE public."Notification"
  DROP CONSTRAINT IF EXISTS "Notification_kind_check";
ALTER TABLE public."Notification"
  ADD CONSTRAINT "Notification_kind_check"
  CHECK (kind IN (
    'mention',
    'assigned',
    'status_changed',
    'sprint_started',
    'sprint_ended',
    'agent_task_change',
    'daily_todos'
  ));

-- ─── Member columns ────────────────────────────────────────────────────────
ALTER TABLE public."Member"
  ADD COLUMN IF NOT EXISTS "dailyTodosMorningEnabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "dailyTodosEveningEnabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "dailyTodosMorningTime"    time   NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS "dailyTodosEveningTime"    time   NOT NULL DEFAULT '20:00';

-- ─── Enqueue function ──────────────────────────────────────────────────────
-- Called by pg_cron every 30 minutes. It looks at the current time in
-- America/Sao_Paulo, finds members whose preference matches the slot
-- (within ±15min so we don't miss anyone if cron drifts), counts open todos
-- for them, and inserts one Notification per slot/member.
--
-- Two anti-noise rules baked in here:
--   1. Skip when the member has zero open todos — empty notifications are
--      worse than silence.
--   2. When inserting an "evening" notif, mark the member's previous
--      "morning" daily_todos notifs (still unread) as read, and vice-versa.
--      Keeps the bell free of stale reminders from the same day.
CREATE OR REPLACE FUNCTION public.enqueue_daily_todo_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now_local timestamp;
  v_today     date;
  v_slot_time time;
  v_member    record;
  v_open_count int;
  v_overdue_count int;
  v_today_count int;
  v_undated_count int;
  v_slot text;
  v_other_slot text;
BEGIN
  v_now_local := (now() AT TIME ZONE 'America/Sao_Paulo')::timestamp;
  v_today     := v_now_local::date;
  v_slot_time := v_now_local::time;

  FOR v_member IN
    SELECT
      m.id,
      CASE
        WHEN m."dailyTodosMorningEnabled"
         AND abs(EXTRACT(EPOCH FROM (m."dailyTodosMorningTime" - v_slot_time))) <= 900
          THEN 'morning'
        WHEN m."dailyTodosEveningEnabled"
         AND abs(EXTRACT(EPOCH FROM (m."dailyTodosEveningTime" - v_slot_time))) <= 900
          THEN 'evening'
        ELSE NULL
      END AS slot
    FROM public."Member" m
    WHERE m."onboardedAt" IS NOT NULL
  LOOP
    IF v_member.slot IS NULL THEN CONTINUE; END IF;

    -- Idempotency: don't double-fire if cron lapped or migration replayed.
    IF EXISTS (
      SELECT 1 FROM public."Notification" n
      WHERE n."recipientMemberId" = v_member.id
        AND n.kind = 'daily_todos'
        AND (n.payload ->> 'slot') = v_member.slot
        AND (n."createdAt" AT TIME ZONE 'America/Sao_Paulo')::date = v_today
    ) THEN CONTINUE; END IF;

    -- Count open todos for the member, partitioned by due-date bucket.
    SELECT
      count(*) FILTER (WHERE t."dueDate" IS NOT NULL AND t."dueDate" < v_today),
      count(*) FILTER (WHERE t."dueDate" = v_today),
      count(*) FILTER (WHERE t."dueDate" IS NULL OR t."dueDate" > v_today),
      count(*)
    INTO v_overdue_count, v_today_count, v_undated_count, v_open_count
    FROM public."Todo" t
    WHERE t."assigneeId" = v_member.id
      AND t."resolvedAt" IS NULL
      AND t.status <> 'done';

    IF v_open_count = 0 THEN CONTINUE; END IF;

    v_slot       := v_member.slot;
    v_other_slot := CASE v_slot WHEN 'morning' THEN 'evening' ELSE 'morning' END;

    -- Mark earlier same-day reminder of the opposite slot as read so the
    -- bell shows only the freshest one.
    UPDATE public."Notification"
       SET "readAt" = now()
     WHERE "recipientMemberId" = v_member.id
       AND kind = 'daily_todos'
       AND "readAt" IS NULL
       AND (payload ->> 'slot') = v_other_slot
       AND ("createdAt" AT TIME ZONE 'America/Sao_Paulo')::date = v_today;

    INSERT INTO public."Notification"(
      "recipientMemberId", kind, "entityType", "entityId",
      "actorMemberId", "batchId", payload
    ) VALUES (
      v_member.id,
      'daily_todos',
      'task',          -- not strictly a task; entityType kept loose for now
      v_member.id,     -- self-targeted; entityId = recipient for routing
      NULL,            -- system action
      NULL,
      jsonb_build_object(
        'slot',          v_slot,
        'overdueCount',  v_overdue_count,
        'todayCount',    v_today_count,
        'undatedCount',  v_undated_count,
        'openCount',     v_open_count,
        'title',         CASE v_slot
                           WHEN 'morning' THEN 'Lembrete da manhã'
                           ELSE 'Lembrete da noite'
                         END
      )
    );
  END LOOP;
END;
$$;

-- ─── Schedule ──────────────────────────────────────────────────────────────
-- Every 30 minutes (UTC). The function itself reads America/Sao_Paulo and
-- matches against per-member preferences with a ±15min window — so this one
-- cron line covers every possible 30-min slot the user may pick.
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'enqueue_daily_todo_reminders';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'enqueue_daily_todo_reminders',
    '0,30 * * * *',
    $cmd$ SELECT public.enqueue_daily_todo_reminders(); $cmd$
  );
END $$;

COMMIT;
