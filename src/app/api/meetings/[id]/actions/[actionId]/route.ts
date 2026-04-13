import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; actionId: string }> }
) {
  const { actionId } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.description !== undefined) data.description = body.description;
  if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId;
  if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;

  if (body.status === "done") data.resolvedAt = new Date();
  if (body.status && body.status !== "done") data.resolvedAt = null;

  const action = await prisma.meetingActionItem.update({
    where: { id: actionId },
    data,
    include: {
      assignee: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(action);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; actionId: string }> }
) {
  const { actionId } = await params;
  await prisma.meetingActionItem.delete({ where: { id: actionId } });
  return NextResponse.json({ ok: true });
}
