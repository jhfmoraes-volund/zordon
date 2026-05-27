-- Daily to-do reminders → Telegram-only nudge; in-app becomes a state card.
--
-- Background: daily_todos used to insert one Notification row per slot/day,
-- which (a) flooded the bell with historical reminders that are state, not
-- events, and (b) doubled up with the Telegram push the row's AFTER INSERT
-- trigger fired. We split the two concerns:
--
--   • Telegram  → the cron now calls telegram-notify DIRECTLY via pg_net,
--                 in "dailyTodos" mode ({ memberId, slot }). No Notification
--                 row is written, so the trigger is no longer involved for
--                 this kind.
--   • In-app    → the bell renders a live "Seus to-dos" state card computed
--                 on-the-fly from the Todo table (see /api/me/todos/summary).
--                 No rows to accumulate, nothing to mark read.
--
-- Idempotency previously leaned on the Notification table ("did we already
-- insert this slot today?"). With no row to look at, we track the last send
-- per slot on the Member itself.
BEGIN;

-- ─── Idempotency anchor (replaces the Notification existence check) ─────────
-- jsonb { "morning": "YYYY-MM-DD", "evening": "YYYY-MM-DD" } in BRT. Cheap to
-- read/write, survives the cron lapping or a migration replay.
ALTER TABLE public."Member"
  ADD COLUMN IF NOT EXISTS "dailyTodosLastSent" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ─── Enqueue function — now a dispatcher, not an inserter ───────────────────
-- Same slot-matching + zero-todos skip as before. The two behavioural changes:
--   1. Instead of INSERT INTO Notification, POST to telegram-notify directly.
--   2. Idempotency reads/writes Member."dailyTodosLastSent" (per slot, BRT).
-- The old "mark the opposite slot's notif as read" anti-noise rule is gone —
-- there are no in-app rows to keep tidy anymore.
CREATE OR REPLACE FUNCTION public.enqueue_daily_todo_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_now_local timestamp;
  v_today     date;
  v_today_iso text;
  v_slot_time time;
  v_member    record;
  v_open_count int;
  v_slot text;
  v_url         text;
  v_service_key text;
BEGIN
  v_now_local := (now() AT TIME ZONE 'America/Sao_Paulo')::timestamp;
  v_today     := v_now_local::date;
  v_today_iso := to_char(v_today, 'YYYY-MM-DD');
  v_slot_time := v_now_local::time;

  -- Telegram dispatch endpoint + shared token, from Vault. If unset (local /
  -- CI), the function no-ops entirely — nothing to deliver, nothing to record.
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'telegram_notify_url';
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'telegram_service_role_key';
  IF v_url IS NULL OR v_service_key IS NULL THEN
    RETURN;
  END IF;

  FOR v_member IN
    SELECT
      m.id,
      m."dailyTodosLastSent",
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
      AND m."telegramChatId" IS NOT NULL  -- no chat = nothing to deliver
  LOOP
    IF v_member.slot IS NULL THEN CONTINUE; END IF;
    v_slot := v_member.slot;

    -- Idempotency: skip if we already sent this slot today (BRT).
    IF (v_member."dailyTodosLastSent" ->> v_slot) = v_today_iso THEN
      CONTINUE;
    END IF;

    -- Skip when there's nothing open — an empty nudge is worse than silence.
    SELECT count(*)
    INTO v_open_count
    FROM public."Todo" t
    WHERE t."assigneeId" = v_member.id
      AND t."resolvedAt" IS NULL
      AND t.status <> 'done';

    IF v_open_count = 0 THEN CONTINUE; END IF;

    -- Fire-and-forget Telegram push in dailyTodos mode. The edge function
    -- recomputes buckets from Todo itself, so we send only the slot + member.
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        ),
        body    := jsonb_build_object(
          'dailyTodos', jsonb_build_object(
            'memberId', v_member.id::text,
            'slot',     v_slot
          )
        ),
        timeout_milliseconds := 5000
      );
    EXCEPTION WHEN OTHERS THEN
      -- A delivery failure must not abort the loop or block the slot stamp;
      -- best-effort, same posture as the old AFTER INSERT trigger.
      RAISE WARNING 'daily_todos dispatch failed for %: %', v_member.id, SQLERRM;
    END;

    -- Stamp the slot so we don't re-fire if cron laps within the window.
    UPDATE public."Member"
       SET "dailyTodosLastSent" =
             COALESCE("dailyTodosLastSent", '{}'::jsonb)
             || jsonb_build_object(v_slot, v_today_iso)
     WHERE id = v_member.id;
  END LOOP;
END;
$$;

-- ─── Backfill: clear the bell of historical daily_todos ─────────────────────
-- These rows no longer get created; mark the unread leftovers as read so the
-- feed stops showing the "Lembrete da manhã/noite" pile. Rows are preserved
-- (no audit value lost) but drop out of the unread badge and bucket lists.
UPDATE public."Notification"
   SET "readAt" = now()
 WHERE kind = 'daily_todos'
   AND "readAt" IS NULL;

COMMIT;
