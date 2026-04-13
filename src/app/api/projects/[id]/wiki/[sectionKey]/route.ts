import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionKey: string }> }
) {
  const { id, sectionKey } = await params;
  const body = await req.json();

  const section = await prisma.projectWikiSection.update({
    where: {
      projectId_sectionKey: {
        projectId: id,
        sectionKey,
      },
    },
    data: {
      data: JSON.stringify(body.data),
      ...(body.title !== undefined && { title: body.title }),
    },
  });

  return NextResponse.json(section);
}
