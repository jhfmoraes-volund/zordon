import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stepKey: string }> }
) {
  const { id, stepKey } = await params;
  const stepData = await prisma.designSessionStepData.findUnique({
    where: { sessionId_stepKey: { sessionId: id, stepKey } },
  });
  if (!stepData) return NextResponse.json({ data: {} });
  return NextResponse.json({ data: JSON.parse(stepData.data) });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepKey: string }> }
) {
  const { id, stepKey } = await params;
  const body = await req.json();

  const stepData = await prisma.designSessionStepData.upsert({
    where: { sessionId_stepKey: { sessionId: id, stepKey } },
    create: {
      sessionId: id,
      stepIndex: body.stepIndex ?? 0,
      stepKey,
      data: JSON.stringify(body.data),
    },
    update: {
      data: JSON.stringify(body.data),
    },
  });

  return NextResponse.json({ data: JSON.parse(stepData.data) });
}
