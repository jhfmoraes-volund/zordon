import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const agents = await prisma.agent.findMany({
    include: { _count: { select: { taskAssignments: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(agents);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const agent = await prisma.agent.create({ data: body });
  return NextResponse.json(agent, { status: 201 });
}
