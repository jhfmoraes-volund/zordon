import { NextResponse } from "next/server";
import { getActorMemberId } from "@/lib/dal";
import { markRead } from "@/lib/dal/notifications";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const memberId = await getActorMemberId();
  if (!memberId) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  await markRead(id, memberId);
  return NextResponse.json({ ok: true });
}
