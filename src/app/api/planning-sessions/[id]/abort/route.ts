import { NextRequest, NextResponse } from "next/server";
import { getSession, updateStatus } from "@/lib/dal/planning-session";
import { requireCapabilityApi } from "@/lib/access/require-capability";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  // Validate session exists
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  // db() bypassa RLS — gate explícito por projeto (grant-aware via ritual.planning).
  const denied = await requireCapabilityApi("ritual.planning", {
    projectId: session.projectId,
  });
  if (denied) return denied;

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
