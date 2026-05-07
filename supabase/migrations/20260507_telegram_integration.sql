-- Telegram integration: Member binding columns, realtime publication for the
-- Settings card to react without polling, and a trigger that hands every new
-- Notification off to the telegram-notify Edge Function via pg_net.
--
-- Edge Function URL and the service-role key are read from Vault, not env or
-- config — the trigger needs to authenticate as service_role to call into a
-- gated Edge Function. Vault decryption is restricted to definer-owned funcs.
BEGIN;

-- pg_net lets the trigger fire HTTP requests without blocking the INSERT.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ─── Member columns ─────────────────────────────────────────────────────────
ALTER TABLE public."Member"
  ADD COLUMN IF NOT EXISTS "telegramChatId"        bigint,
  ADD COLUMN IF NOT EXISTS "telegramUsername"      text,
  ADD COLUMN IF NOT EXISTS "telegramBindToken"     text,
  ADD COLUMN IF NOT EXISTS "telegramBindExpiresAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "telegramKindsDisabled" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "telegramConnectedAt"   timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS "Member_telegramChatId_unique"
  ON public."Member" ("telegramChatId")
  WHERE "telegramChatId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Member_telegramBindToken_unique"
  ON public."Member" ("telegramBindToken")
  WHERE "telegramBindToken" IS NOT NULL;

-- ─── Realtime publication ──────────────────────────────────────────────────
-- The Settings card subscribes to its own Member row to flip Disconnected →
-- Connected the moment the webhook persists chatId. RLS gates per-row access,
-- so realtime never leaks another member's state.
ALTER TABLE public."Member" REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime'
      AND schemaname='public'
      AND tablename='Member'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."Member";
  END IF;
END $$;

-- ─── Trigger: AFTER INSERT Notification → Edge Function ────────────────────
CREATE OR REPLACE FUNCTION public.dispatch_telegram_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url         text;
  v_service_key text;
BEGIN
  -- Pull URL + service-role key from Vault. Both must be present, otherwise
  -- the trigger silently no-ops (lets local/CI environments work without the
  -- secrets being seeded).
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'telegram_notify_url';
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'telegram_service_role_key';

  IF v_url IS NULL OR v_service_key IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object('notificationId', NEW.id::text),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a Telegram dispatch failure roll back a Notification insert.
  -- The bell is the source of truth; Telegram is best-effort.
  RAISE WARNING 'dispatch_telegram_notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notification_telegram_dispatch ON public."Notification";
CREATE TRIGGER notification_telegram_dispatch
  AFTER INSERT ON public."Notification"
  FOR EACH ROW
  EXECUTE FUNCTION public.dispatch_telegram_notification();

COMMIT;
