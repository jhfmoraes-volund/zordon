import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; category: string }> }
) {
  const { id, category } = await params;

  const guideline = await prisma.projectGuideline.findUnique({
    where: { projectId_category: { projectId: id, category } },
  });

  if (!guideline) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(guideline);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; category: string }> }
) {
  const { id, category } = await params;
  const { title, content } = await req.json();

  const guideline = await prisma.projectGuideline.update({
    where: { projectId_category: { projectId: id, category } },
    data: { title, content, isDefault: false },
  });

  return NextResponse.json(guideline);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; category: string }> }
) {
  const { id, category } = await params;

  await prisma.projectGuideline.delete({
    where: { projectId_category: { projectId: id, category } },
  });

  return NextResponse.json({ ok: true });
}
