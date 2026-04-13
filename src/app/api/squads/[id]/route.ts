import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { memberIds, projectIds, ...data } = await req.json();

  // Replace members if provided
  if (memberIds !== undefined) {
    await prisma.squadMember.deleteMany({ where: { squadId: id } });
    if (memberIds.length > 0) {
      await prisma.squadMember.createMany({
        data: memberIds.map((memberId: string) => ({ squadId: id, memberId })),
      });
    }
  }

  // Replace project associations if provided
  if (projectIds !== undefined) {
    await prisma.projectSquad.deleteMany({ where: { squadId: id } });
    if (projectIds.length > 0) {
      await prisma.projectSquad.createMany({
        data: projectIds.map((projectId: string) => ({ squadId: id, projectId })),
      });
    }
  }

  const squad = await prisma.squad.update({
    where: { id },
    data,
    include: {
      projectSquads: {
        include: { project: { select: { id: true, name: true } } },
      },
      members: { include: { member: true } },
    },
  });
  return NextResponse.json(squad);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.squad.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
