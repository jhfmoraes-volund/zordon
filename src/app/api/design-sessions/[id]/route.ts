import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi, requireSessionEditApi } from "@/lib/dal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;
  const { data: session } = await db()
    .from("DesignSession")
    .select(`
      *,
      project:Project(name, client:Client(name)),
      participants:DesignSessionParticipant(*, member:Member(name)),
      stepData:DesignSessionStepData(*),
      items:DesignSessionItem(*)
    `)
    .eq("id", id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Sort items by orderIndex
  if ((session as any).items) {
    (session as any).items.sort((a: any, b: any) => a.orderIndex - b.orderIndex);
  }

  return NextResponse.json(session);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;
  const body = await req.json();
  const { data: session, error } = await db()
    .from("DesignSession")
    .update(body)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(session);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;
  const { error } = await db().from("DesignSession").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
