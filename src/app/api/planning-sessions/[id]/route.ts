import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser, requireProjectEditSessionsApi } from "@/lib/dal";
import {
  getSession,
  updateSession,
  deleteSession,
} from "@/lib/dal/planning-session";

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

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  facilitatorId: z.string().uuid().nullable().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  sprintCount: z.number().int().min(1).max(12).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requireProjectEditSessionsApi(session.projectId);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const updated = await updateSession(sessionId, parsed.data);
    return NextResponse.json({ session: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requireProjectEditSessionsApi(session.projectId);
  if (denied) return denied;

  try {
    await deleteSession(sessionId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
