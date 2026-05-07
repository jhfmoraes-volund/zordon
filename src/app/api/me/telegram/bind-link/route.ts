import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActorMemberId } from "@/lib/dal";

const BOT_USERNAME = "zordon_notifier_bot";
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Generates (or refreshes) a one-shot Telegram bind token. The link returned
 * encodes the token in the deep-link `start` param — when the user taps it,
 * Telegram opens the bot with the prefilled command and the webhook resolves
 * it back to this Member.
 */
export async function POST() {
  const memberId = await getActorMemberId();
  if (!memberId) return new NextResponse("Unauthorized", { status: 401 });

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const { error } = await db()
    .from("Member")
    .update({
      telegramBindToken: token,
      telegramBindExpiresAt: expiresAt,
    })
    .eq("id", memberId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const url = `https://t.me/${BOT_USERNAME}?start=${token}`;
  return NextResponse.json({ url, expiresAt });
}
