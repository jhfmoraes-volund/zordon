import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const sessions = await prisma.designSession.findMany({
    include: {
      project: { select: { name: true, client: { select: { name: true } } } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(sessions);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const totalSteps = body.type === "inception" ? 7 : 5;

  const session = await prisma.designSession.create({
    data: {
      ...body,
      totalSteps,
    },
    include: {
      project: { select: { name: true } },
    },
  });
  return NextResponse.json(session, { status: 201 });
}
