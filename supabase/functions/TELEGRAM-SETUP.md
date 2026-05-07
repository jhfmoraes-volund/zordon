# Telegram integration — deploy & setup

One-time steps to wire `telegram-webhook` and `telegram-notify` against the
production project. Run these once per environment (prod, staging).

## 1. Confirm secrets in Supabase

The Edge Functions read these from `Deno.env`. Set via Dashboard → Settings →
Edge Functions → Secrets, or the CLI.

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN=<bot token from @BotFather> \
  TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32> \
  TELEGRAM_NOTIFY_AUTH_TOKEN=<openssl rand -hex 32> \
  APP_BASE_URL=https://<prod domain>
```

`TELEGRAM_NOTIFY_AUTH_TOKEN` is the shared secret between the AFTER INSERT
trigger (which reads it from Vault) and the `telegram-notify` function (which
reads it from Edge secrets). Decoupling from `SUPABASE_SERVICE_ROLE_KEY`
avoids breakage when the project's service-role key rotates independently of
the value seeded into Vault. **Same value must be in both places.**

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the
runtime — don't set them manually.

## 2. Deploy the functions

```bash
supabase functions deploy telegram-webhook
supabase functions deploy telegram-notify
```

`config.toml` already disables JWT verification for `telegram-webhook` (gated
by the `secret_token` header instead) and keeps it on for `telegram-notify`.

## 3. Seed Vault secrets used by the trigger

The `dispatch_telegram_notification` trigger reads two values from Vault. Run
**once** via psql connected to the project:

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')

psql "$DIRECT_URL" <<SQL
SELECT vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/telegram-notify',
  'telegram_notify_url'
);
SELECT vault.create_secret(
  '<value of TELEGRAM_NOTIFY_AUTH_TOKEN>',
  'telegram_service_role_key'
);
SQL
```

To rotate later: `SELECT vault.update_secret(<id>, '<new_value>');`. The
trigger does *not* cache, so updates take effect immediately.

If both secrets are absent the trigger no-ops gracefully (lets local/dev
environments run without Telegram wired up).

## 4. Register the webhook with Telegram

```bash
SECRET=<value of TELEGRAM_WEBHOOK_SECRET>

curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"https://<project-ref>.supabase.co/functions/v1/telegram-webhook\",
    \"secret_token\": \"$SECRET\",
    \"allowed_updates\": [\"message\"]
  }"
```

Verify with:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

`url` should match, `pending_update_count` near 0, no `last_error_message`.

## 5. Smoke test

1. Open `/profile` in the app, scroll to **Integrações** → **Telegram**.
2. Click **Conectar Telegram** → Telegram opens with `/start <token>` ready.
3. Tap **INICIAR** in the bot chat → welcome message arrives.
4. Card flips to **Conectado** without refresh (Realtime).
5. Click **Enviar teste** → test message in Telegram.
6. Have someone @mention you in a comment → notification in Telegram within
   a couple seconds.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `setWebhook` returns `ok: false` | URL unreachable, function not deployed |
| Welcome message never arrives | Webhook not registered, or `secret_token` mismatch (check function logs) |
| Card stays "Desconectado" after `/start` | Realtime publication missing `Member`, or RLS blocks the user from reading their own row |
| In-app notif arrives but Telegram doesn't | Vault secrets not seeded; `kindsDisabled` includes the kind; or user blocked the bot (chatId got wiped — check `Member.telegramChatId IS NULL`) |
| Trigger logs `dispatch_telegram_notification failed` | `pg_net` extension missing, Edge URL invalid, or Vault returns null |
