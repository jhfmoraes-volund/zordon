import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";
import { getSession, updateStatus } from "@/lib/dal/planning-session";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id: sessionId } = await params;

  // Validate session exists
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  // Only allow abort if in orchestrating or error state
  if (!["orchestrating", "error"].includes(session.status)) {
    return NextResponse.json(
      {
        error: "session not in orchestrating/error state",
        currentStatus: session.status,
      },
      { status: 409 },
    );
  }

  try {
    const updated = await updateStatus(sessionId, "aborted");
    return NextResponse.json({ session: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "abort failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
