import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActorMemberId } from "@/lib/dal";

// Live to-do state for the in-app notification bell card. A to-do reminder is
// state, not an event, so the bell renders this on-the-fly instead of keeping
// historical Notification rows (the Telegram nudge covers the daily ping).
//
// Buckets mirror the cron/edge logic: overdue = dueDate before today,
// dueToday = dueDate == today, both in America/Sao_Paulo. "open" excludes
// resolved and done todos.
export type TodoSummary = {
  open: number;
  overdue: number;
  dueToday: number;
};

/** Today in America/Sao_Paulo as YYYY-MM-DD (matches the cron's BRT anchor). */
function brtTodayISO(): string {
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" })
    .slice(0, 10);
}

export async function GET() {
  const memberId = await getActorMemberId();
  if (!memberId) return new NextResponse("Unauthorized", { status: 401 });

  const { data, error } = await db()
    .from("Todo")
    .select("dueDate")
    .eq("assigneeId", memberId)
    .is("resolvedAt", null)
    .neq("status", "done");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const todayISO = brtTodayISO();
  let overdue = 0;
  let dueToday = 0;
  for (const row of data ?? []) {
    // Collapse the timestamp to YYYY-MM-DD so the string compare ignores HH:MM.
    const due = row.dueDate ? String(row.dueDate).slice(0, 10) : null;
    if (!due) continue;
    if (due < todayISO) overdue++;
    else if (due === todayISO) dueToday++;
  }

  const summary: TodoSummary = {
    open: data?.length ?? 0,
    overdue,
    dueToday,
  };
  return NextResponse.json(summary);
}
