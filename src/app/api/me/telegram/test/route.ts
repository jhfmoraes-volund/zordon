import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActorMemberId, getCurrentMember } from "@/lib/dal";

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Sends a one-off test message to the bound Telegram chat — bypasses the
 * Notification table so the bell doesn't get polluted with synthetic rows.
 * Only confirms the integration is reachable end-to-end (token, chat id,
 * bot connectivity).
 */
export async function POST() {
  const memberId = await getActorMemberId();
  if (!memberId) return new NextResponse("Unauthorized", { status: 401 });

  const member = await getCurrentMember();
  if (!member?.telegramChatId) {
    return NextResponse.json(
      { error: "Telegram não conectado." },
      { status: 400 },
    );
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN não configurado no servidor." },
      { status: 500 },
    );
  }

  const text = [
    "✅ <b>Volund — teste de integração</b>",
    "",
    `Olá, ${escapeHtml(member.name ?? "lá")}.`,
    "Se você recebeu esta mensagem, suas notificações por aqui estão funcionando.",
  ].join("\n");

  const appUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://zordon.volund.com.br";
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: member.telegramChatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "Abrir Volund", url: appUrl }]],
      },
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) {
      // User blocked the bot. Wipe chatId so app reflects reality.
      await db()
        .from("Member")
        .update({ telegramChatId: null, telegramConnectedAt: null })
        .eq("id", memberId);
      return NextResponse.json(
        { error: "Bot foi bloqueado no Telegram. Reconecte pelo Volund." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Falha ao enviar.", status: res.status, data },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
