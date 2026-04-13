import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iterationId: string }> }
) {
  const { iterationId } = await params;
  const data = await req.json();

  const iteration = await prisma.taskIteration.update({
    where: { id: iterationId },
    data,
  });

  return NextResponse.json(iteration);
}
