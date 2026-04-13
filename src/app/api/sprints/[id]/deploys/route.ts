import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const deploys = await prisma.sprintDeploy.findMany({
    where: { sprintId: id },
    orderBy: { startedAt: "desc" },
  });

  return NextResponse.json(deploys);
}
