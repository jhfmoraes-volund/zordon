import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getMemberId } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { projectIdForSprint } from "@/lib/dal/sprint";

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
  const { id } = await params;
  const projectId = await projectIdForSprint(id);
  if (!projectId) return new NextResponse("Sprint não encontrada", { status: 404 });
  const denied = await requireCapabilityApi("sprint.view", { projectId });
  if (denied) return denied;

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
  const { id } = await params;
  const projectId = await projectIdForSprint(id);
  if (!projectId) return new NextResponse("Sprint não encontrada", { status: 404 });
  const denied = await requireCapabilityApi("sprint.write", { projectId });
  if (denied) return denied;

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
