import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinAccessLevelApi } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";

export async function GET() {
  // Carteira de clientes é dado executivo → só manager (PM) ou admin.
  const denied = await requireMinAccessLevelApi("manager");
  if (denied) return denied;

  const { data: clients, error } = await db()
    .from("client_summary")
    .select("*")
    .order("createdAt", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(clients);
}

export async function POST(req: NextRequest) {
  const denied = await requireCapabilityApi("client.write");
  if (denied) return denied;

  const body = await req.json();
  const { data: client, error } = await db()
    .from("Client")
    .insert({ id: crypto.randomUUID(), updatedAt: new Date().toISOString(), ...body })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(client, { status: 201 });
}
