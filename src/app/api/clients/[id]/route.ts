import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinAccessLevelApi } from "@/lib/dal";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinAccessLevelApi("manager");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const { data: client, error } = await db()
    .from("Client")
    .update(body)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(client);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinAccessLevelApi("manager");
  if (denied) return denied;

  const { id } = await params;
  const { error } = await db().from("Client").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
