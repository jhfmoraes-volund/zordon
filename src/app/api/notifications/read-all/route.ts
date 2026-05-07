import { NextResponse } from "next/server";
import { getActorMemberId } from "@/lib/dal";
import { markAllRead } from "@/lib/dal/notifications";

export async function POST() {
  const memberId = await getActorMemberId();
  if (!memberId) return new NextResponse("Unauthorized", { status: 401 });
  await markAllRead(memberId);
  return NextResponse.json({ ok: true });
}
