-- Extend Notification CHECK constraints for the Granola auto-import feed.
--
-- Two changes to the constraint set defined in 20260506_notifications.sql:
--   - kind        adds 'granola_auto_import'
--   - entityType  adds 'meeting' (the auto-import payload links to a Meeting,
--                 not a task/sprint/comment)
--
-- Pattern: drop the named constraint, recreate with the new value set. Doing
-- it inside a single transaction keeps the table queryable end-to-end; no
-- existing rows reference the new values, so the recheck on existing data is
-- a no-op fast scan.

BEGIN;

ALTER TABLE public."Notification"
  DROP CONSTRAINT IF EXISTS "Notification_kind_check";

-- IMPORTANT: keep this set in sync with prior migrations that extended it
-- (20260507_daily_todo_reminders.sql added 'daily_todos'). New rows live in
-- prod with that kind, so dropping/recreating without it would fail the
-- constraint recheck.
ALTER TABLE public."Notification"
  ADD CONSTRAINT "Notification_kind_check"
  CHECK (kind IN (
    'mention',
    'assigned',
    'status_changed',
    'sprint_started',
    'sprint_ended',
    'agent_task_change',
    'daily_todos',
    'granola_auto_import'
  ));

ALTER TABLE public."Notification"
  DROP CONSTRAINT IF EXISTS "Notification_entityType_check";

ALTER TABLE public."Notification"
  ADD CONSTRAINT "Notification_entityType_check"
  CHECK ("entityType" IN ('task', 'sprint', 'comment', 'meeting'));

COMMIT;
