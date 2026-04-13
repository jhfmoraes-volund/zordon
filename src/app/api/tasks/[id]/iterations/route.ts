import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const iterations = await prisma.taskIteration.findMany({
    where: { taskId: id },
    orderBy: { number: "asc" },
  });

  return NextResponse.json(iterations);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await req.json();

  // Auto-increment iteration number
  const last = await prisma.taskIteration.findFirst({
    where: { taskId: id },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const nextNumber = (last?.number ?? 0) + 1;

  const iteration = await prisma.taskIteration.create({
    data: {
      ...data,
      taskId: id,
      number: nextNumber,
    },
  });

  // Update task iteration count
  await prisma.task.update({
    where: { id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json(iteration, { status: 201 });
}
