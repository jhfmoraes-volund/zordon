import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await prisma.designSession.findUnique({
    where: { id },
    include: {
      project: { select: { name: true, client: { select: { name: true } } } },
      participants: { include: { member: { select: { name: true } } } },
      stepData: true,
      items: { orderBy: { orderIndex: "asc" } },
    },
  });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(session);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const session = await prisma.designSession.update({
    where: { id },
    data: body,
  });
  return NextResponse.json(session);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.designSession.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
