import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const { memberIds, projectIds, ...data } = await req.json();
  const supabase = db();

  // Replace members if provided
  if (memberIds !== undefined) {
    await supabase.from("SquadMember").delete().eq("squadId", id);
    if (memberIds.length > 0) {
      await supabase
        .from("SquadMember")
        .insert(memberIds.map((memberId: string) => ({ id: crypto.randomUUID(), squadId: id, memberId })));
    }
  }

  // Replace project associations if provided
  if (projectIds !== undefined) {
    await supabase.from("ProjectSquad").delete().eq("squadId", id);
    if (projectIds.length > 0) {
      await supabase
        .from("ProjectSquad")
        .insert(projectIds.map((projectId: string) => ({ id: crypto.randomUUID(), squadId: id, projectId })));
    }
  }

  // Update squad + re-fetch with relations
  await supabase.from("Squad").update(data).eq("id", id);
  const { data: squad, error } = await supabase
    .from("Squad")
    .select(`
      *,
      projectSquads:ProjectSquad(*, project:Project(id, name)),
      members:SquadMember(*, member:Member(*))
    `)
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(squad);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const { error } = await db().from("Squad").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
