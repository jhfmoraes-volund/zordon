import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";

export async function GET() {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  try {
    const { data: squads, error } = await db()
      .from("Squad")
      .select(`
        *,
        projectSquads:ProjectSquad(*, project:Project(id, name)),
        members:SquadMember(*, member:Member(*))
      `)
      .order("createdAt", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(squads);
  } catch (error) {
    console.error("[GET /api/squads]", error);
    return NextResponse.json({ error: "Failed to fetch squads" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireCapabilityApi("squad.write");
  if (denied) return denied;

  const { memberIds, projectIds, ...data } = await req.json();
  const supabase = db();

  // Create squad
  const { data: squad, error } = await supabase
    .from("Squad")
    .insert({ id: crypto.randomUUID(), updatedAt: new Date().toISOString(), ...data })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Create project associations
  if (projectIds?.length) {
    await supabase
      .from("ProjectSquad")
      .insert(projectIds.map((projectId: string) => ({ id: crypto.randomUUID(), squadId: squad.id, projectId })));
  }

  // Create member associations
  if (memberIds?.length) {
    await supabase
      .from("SquadMember")
      .insert(memberIds.map((memberId: string) => ({ id: crypto.randomUUID(), squadId: squad.id, memberId })));
  }

  // Re-fetch with relations
  const { data: full } = await supabase
    .from("Squad")
    .select(`
      *,
      projectSquads:ProjectSquad(*, project:Project(id, name)),
      members:SquadMember(*, member:Member(*))
    `)
    .eq("id", squad.id)
    .single();

  return NextResponse.json(full, { status: 201 });
}
