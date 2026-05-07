// Edge Function: telegram-webhook
//
// Public endpoint Telegram calls when users interact with the bot.
// Authenticated by X-Telegram-Bot-Api-Secret-Token (set when registering the
// webhook); unauthenticated calls are dropped with 401.
//
// Routes:
//   /start <token>  → resolve Member by bind token, persist chatId/username,
//                     wipe token, send welcome.
//   /start (alone)  → friendly nudge to use the Volund Settings flow.
//   /disconnect     → clear chatId for the chat it came from.
//   anything else   → polite explanation that this is a notify-only bot.
//
// Always returns 200 to Telegram so it doesn't retry — even on logical errors
// we handle and reply by text instead.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;

const TELEGRAM_API = "https://api.telegram.org";

type TelegramFrom = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramMessage = {
  from?: TelegramFrom;
  chat: { id: number; type: string };
  text?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

async function reply(chatId: number, text: string): Promise<void> {
  await fetch(`${TELEGRAM_API}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  }).catch((e) => console.error("[telegram-webhook] reply failed", e));
}

function welcomeMessage(name: string): string {
  return [
    `Olá, <b>${escapeHtml(name)}</b>! 👋`,
    ``,
    `Você acabou de conectar o Volund ao Telegram.`,
    ``,
    `A partir de agora vou te avisar por aqui quando algo`,
    `precisar da sua atenção — menções em comentários,`,
    `tasks que te atribuírem, sprints que iniciarem.`,
    ``,
    `Você pode escolher quais tipos de notificação quer`,
    `receber direto nas configurações do Volund.`,
    ``,
    `Pra desconectar, manda <code>/disconnect</code> aqui`,
    `ou desliga pelo app.`,
    ``,
    `Bom trabalho. 🛠️`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function handleStartWithToken(
  supabase: ReturnType<typeof createClient>,
  chatId: number,
  username: string | undefined,
  token: string,
): Promise<void> {
  const { data: member } = await supabase
    .from("Member")
    .select("id, name, telegramBindExpiresAt, telegramChatId")
    .eq("telegramBindToken", token)
    .maybeSingle();

  if (!member) {
    await reply(
      chatId,
      "Esse link de conexão é inválido ou já foi usado. Gera um novo nas configurações do Volund.",
    );
    return;
  }

  const expiresAt = member.telegramBindExpiresAt as string | null;
  if (!expiresAt || new Date(expiresAt).getTime() < Date.now()) {
    await reply(
      chatId,
      "Esse link expirou. Gera um novo nas configurações do Volund — eles valem 15 minutos.",
    );
    // Clear the stale token so it can't be retried.
    await supabase
      .from("Member")
      .update({
        telegramBindToken: null,
        telegramBindExpiresAt: null,
      })
      .eq("id", member.id as string);
    return;
  }

  // Transfer: another member may have previously bound this same chat. Clear
  // them out — explicit takeover, the new bind wins.
  await supabase
    .from("Member")
    .update({
      telegramChatId: null,
      telegramConnectedAt: null,
      telegramUsername: null,
    })
    .eq("telegramChatId", chatId)
    .neq("id", member.id as string);

  await supabase
    .from("Member")
    .update({
      telegramChatId: chatId,
      telegramUsername: username ?? null,
      telegramConnectedAt: new Date().toISOString(),
      telegramBindToken: null,
      telegramBindExpiresAt: null,
    })
    .eq("id", member.id as string);

  await reply(chatId, welcomeMessage((member.name as string) ?? "lá"));
}

async function handleDisconnect(
  supabase: ReturnType<typeof createClient>,
  chatId: number,
): Promise<void> {
  const { data: member } = await supabase
    .from("Member")
    .select("id")
    .eq("telegramChatId", chatId)
    .maybeSingle();

  if (!member) {
    await reply(
      chatId,
      "Esse Telegram não está conectado a nenhuma conta do Volund.",
    );
    return;
  }

  await supabase
    .from("Member")
    .update({
      telegramChatId: null,
      telegramUsername: null,
      telegramConnectedAt: null,
    })
    .eq("id", member.id as string);

  await reply(
    chatId,
    "Desconectado. Pode reconectar pelo Volund quando quiser. 👋",
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Validate Telegram's secret_token header. Without this, anyone with the URL
  // could forge updates and bind/unbind random members.
  const incomingSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (
    !TELEGRAM_WEBHOOK_SECRET ||
    incomingSecret !== TELEGRAM_WEBHOOK_SECRET
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const message = update.message ?? update.edited_message;
  if (!message?.text || !message.chat?.id) {
    return new Response("ok"); // ack non-text updates
  }

  const chatId = message.chat.id;
  const text = message.text.trim();
  const username = message.from?.username;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (text.startsWith("/start ")) {
    const token = text.slice("/start ".length).trim();
    await handleStartWithToken(supabase, chatId, username, token);
  } else if (text === "/start") {
    await reply(
      chatId,
      "Olá! Pra conectar sua conta, abre o Volund → Configurações → Telegram → Conectar.",
    );
  } else if (text === "/disconnect") {
    await handleDisconnect(supabase, chatId);
  } else {
    await reply(
      chatId,
      "Sou o bot de notificações do Volund. Use o app pra interagir com seus projetos.",
    );
  }

  return new Response("ok");
});
