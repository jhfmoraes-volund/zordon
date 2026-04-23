import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";
import type { Database } from "@/lib/supabase/database.types";

type WikiUpdate = Database["public"]["Tables"]["ProjectWikiSection"]["Update"];

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionKey: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id, sectionKey } = await params;
  const body = await req.json();

  const updateData: WikiUpdate = { data: body.data };
  if (body.title !== undefined) updateData.title = body.title;

  const { data: section, error } = await db()
    .from("ProjectWikiSection")
    .update(updateData)
    .eq("projectId", id)
    .eq("sectionKey", sectionKey)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(section);
}
