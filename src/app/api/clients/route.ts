import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";

export async function GET() {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: clients, error } = await db()
    .from("client_summary")
    .select("*")
    .order("createdAt", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(clients);
}

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json();
  const { data: client, error } = await db()
    .from("Client")
    .insert({ id: crypto.randomUUID(), updatedAt: new Date().toISOString(), ...body })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(client, { status: 201 });
}
