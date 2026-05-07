import { NextRequest, NextResponse } from "next/server";
import { getActorMemberId } from "@/lib/dal";
import {
  listNotifications,
  unreadCount,
} from "@/lib/dal/notifications";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export async function GET(req: NextRequest) {
  const memberId = await getActorMemberId();
  if (!memberId) return new NextResponse("Unauthorized", { status: 401 });

  const sp = req.nextUrl.searchParams;
  const before = sp.get("before") ?? undefined;
  const limitParam = sp.get("limit");
  const limit = limitParam
    ? Math.min(MAX_LIMIT, Math.max(1, parseInt(limitParam, 10) || DEFAULT_LIMIT))
    : DEFAULT_LIMIT;

  const [notifications, unread] = await Promise.all([
    listNotifications(memberId, { limit, before }),
    unreadCount(memberId),
  ]);

  return NextResponse.json({ notifications, unreadCount: unread });
}
