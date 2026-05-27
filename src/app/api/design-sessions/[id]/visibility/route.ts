import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canChangeSessionVisibility, getUser } from "@/lib/dal";

/**
 * PATCH /api/design-sessions/[id]/visibility
 *
 * Body: { visibility: 'public' | 'internal' }
 *
 * Permite alternar a visibilidade de uma Design Session entre 'public'
 * (aparece para guests) e 'internal' (oculta do cliente, só time interno).
 *
 * Autorização: espelho de `can_change_session_visibility()` no SQL.
 *   - admin / manager global: yes
 *   - ProjectAccess.role IN ('lead', 'contributor') no projeto da DS: yes
 *   - guest e demais: 403
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const visibility = body?.visibility;
  if (visibility !== "public" && visibility !== "internal") {
    return NextResponse.json(
      { error: "visibility must be 'public' or 'internal'" },
      { status: 400 },
    );
  }

  const supabase = db();
  const { data: session, error: lookupErr } = await supabase
    .from("DesignSession")
    .select("id, projectId, visibility")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (!(await canChangeSessionVisibility(session.projectId))) {
    return new NextResponse(
      "Forbidden — only project leads/contributors or managers can change visibility",
      { status: 403 },
    );
  }

  const { data: updated, error } = await supabase
    .from("DesignSession")
    .update({ visibility, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .select("id, visibility")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
