import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stepKey: string }> }
) {
  const { id, stepKey } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;
  const { data: stepData } = await db()
    .from("DesignSessionStepData")
    .select("*")
    .eq("sessionId", id)
    .eq("stepKey", stepKey)
    .maybeSingle();
  if (!stepData) return NextResponse.json({ data: {} });
  return NextResponse.json({ data: stepData.data });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepKey: string }> }
) {
  const { id, stepKey } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;
  const body = await req.json();

  const { data: stepData, error } = await db()
    .from("DesignSessionStepData")
    .upsert(
      {
        id: crypto.randomUUID(),
        sessionId: id,
        stepIndex: body.stepIndex ?? 0,
        stepKey,
        data: body.data,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "sessionId,stepKey" }
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: stepData.data });
}
