import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser, getMemberId } from "@/lib/dal";

type Body = {
  goodPoints?: string | null;
  badPoints?: string | null;
  ideas?: string | null;
};

function normalize(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const { data, error } = await db()
    .from("SprintRetrospective")
    .select("*")
    .eq("sprintId", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;
  const memberId = await getMemberId();

  const payload = {
    sprintId: id,
    goodPoints: normalize(body.goodPoints),
    badPoints: normalize(body.badPoints),
    ideas: normalize(body.ideas),
    completedBy: memberId,
    completedAt: new Date().toISOString(),
  };

  const { data, error } = await db()
    .from("SprintRetrospective")
    .upsert(payload, { onConflict: "sprintId" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
