import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";
import { getSession } from "@/lib/dal/planning-session";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id: sessionId } = await params;

  try {
    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "session not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ session });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "get failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
