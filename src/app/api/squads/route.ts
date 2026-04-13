import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const squads = await prisma.squad.findMany({
      include: {
        projectSquads: {
          include: { project: { select: { id: true, name: true } } },
        },
        members: { include: { member: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(squads);
  } catch (error) {
    console.error("[GET /api/squads]", error);
    return NextResponse.json({ error: "Failed to fetch squads" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { memberIds, projectIds, ...data } = await req.json();
  const squad = await prisma.squad.create({
    data: {
      ...data,
      projectSquads: projectIds?.length
        ? { create: projectIds.map((projectId: string) => ({ projectId })) }
        : undefined,
      members: memberIds?.length
        ? { create: memberIds.map((memberId: string) => ({ memberId })) }
        : undefined,
    },
    include: {
      projectSquads: {
        include: { project: { select: { id: true, name: true } } },
      },
      members: { include: { member: true } },
    },
  });
  return NextResponse.json(squad, { status: 201 });
}
