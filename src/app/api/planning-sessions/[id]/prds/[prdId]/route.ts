import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  getSession,
  updatePrdAssignment,
  removeLinkedPrd,
} from "@/lib/dal/planning-session";

const updateSchema = z.object({
  sprintStart: z.number().int().min(1).max(12).optional(),
  sprintCount: z.number().int().min(1).max(12).optional(),
  order: z.number().int().min(0).optional(),
  ownerOverride: z.string().uuid().nullable().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; prdId: string }> },
) {
  const { id: sessionId, prdId } = await params;

  // db() bypassa RLS — gate por projeto da planning (grant-aware via ritual.planning).
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requireCapabilityApi("ritual.planning", {
    projectId: session.projectId,
  });
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const prd = await updatePrdAssignment(prdId, parsed.data);
    return NextResponse.json({ prd });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; prdId: string }> },
) {
  const { id: sessionId, prdId } = await params;

  // db() bypassa RLS — gate por projeto da planning (grant-aware via ritual.planning).
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requireCapabilityApi("ritual.planning", {
    projectId: session.projectId,
  });
  if (denied) return denied;

  try {
    await removeLinkedPrd(prdId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
