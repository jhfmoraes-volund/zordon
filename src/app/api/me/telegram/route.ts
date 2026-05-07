import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActorMemberId } from "@/lib/dal";
import type { Database } from "@/lib/supabase/database.types";

type MemberUpdate = Database["public"]["Tables"]["Member"]["Update"];

const NOTIFICATION_KINDS = [
  "mention",
  "assigned",
  "status_changed",
  "sprint_started",
  "sprint_ended",
  "agent_task_change",
  "daily_todos",
] as const;

// HH:MM with 30-min granularity (xx:00 or xx:30) between 06:00 and 22:00.
// Stored as Postgres `time`; we round-trip with seconds suffix internally.
const TIME_HHMM = /^(0[6-9]|1\d|2[0-2]):(00|30)$/;

const patchSchema = z.object({
  kindsDisabled: z
    .array(z.enum(NOTIFICATION_KINDS))
    .max(NOTIFICATION_KINDS.length)
    .optional(),
  dailyTodosMorningEnabled: z.boolean().optional(),
  dailyTodosEveningEnabled: z.boolean().optional(),
  dailyTodosMorningTime: z.string().regex(TIME_HHMM).optional(),
  dailyTodosEveningTime: z.string().regex(TIME_HHMM).optional(),
});

function trimTime(value: string | null | undefined): string | null {
  if (!value) return null;
  // Postgres returns "08:00:00"; UI wants "08:00".
  return value.length >= 5 ? value.slice(0, 5) : value;
}

async function loadStatus(memberId: string) {
  const { data, error } = await db()
    .from("Member")
    .select(
      "telegramChatId, telegramUsername, telegramConnectedAt, telegramKindsDisabled, dailyTodosMorningEnabled, dailyTodosEveningEnabled, dailyTodosMorningTime, dailyTodosEveningTime",
    )
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw error;
  return {
    connected: !!data?.telegramChatId,
    username: data?.telegramUsername ?? null,
    connectedAt: data?.telegramConnectedAt ?? null,
    kindsDisabled: data?.telegramKindsDisabled ?? [],
    dailyTodosMorningEnabled: data?.dailyTodosMorningEnabled ?? true,
    dailyTodosEveningEnabled: data?.dailyTodosEveningEnabled ?? true,
    dailyTodosMorningTime: trimTime(data?.dailyTodosMorningTime) ?? "08:00",
    dailyTodosEveningTime: trimTime(data?.dailyTodosEveningTime) ?? "20:00",
  };
}

export async function GET() {
  const memberId = await getActorMemberId();
  if (!memberId) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json(await loadStatus(memberId));
}

export async function PATCH(req: NextRequest) {
  const memberId = await getActorMemberId();
  if (!memberId) return new NextResponse("Unauthorized", { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    console.error("[/api/me/telegram] PATCH validation failed", {
      payload: json,
      error: parsed.error.flatten(),
    });
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const update: MemberUpdate = {};
  if (parsed.data.kindsDisabled !== undefined) {
    update.telegramKindsDisabled = parsed.data.kindsDisabled;
  }
  if (parsed.data.dailyTodosMorningEnabled !== undefined) {
    update.dailyTodosMorningEnabled = parsed.data.dailyTodosMorningEnabled;
  }
  if (parsed.data.dailyTodosEveningEnabled !== undefined) {
    update.dailyTodosEveningEnabled = parsed.data.dailyTodosEveningEnabled;
  }
  if (parsed.data.dailyTodosMorningTime !== undefined) {
    update.dailyTodosMorningTime = parsed.data.dailyTodosMorningTime;
  }
  if (parsed.data.dailyTodosEveningTime !== undefined) {
    update.dailyTodosEveningTime = parsed.data.dailyTodosEveningTime;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await db()
      .from("Member")
      .update(update)
      .eq("id", memberId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json(await loadStatus(memberId));
}

export async function DELETE() {
  const memberId = await getActorMemberId();
  if (!memberId) return new NextResponse("Unauthorized", { status: 401 });

  const { error } = await db()
    .from("Member")
    .update({
      telegramChatId: null,
      telegramUsername: null,
      telegramConnectedAt: null,
      telegramBindToken: null,
      telegramBindExpiresAt: null,
    })
    .eq("id", memberId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(await loadStatus(memberId));
}
