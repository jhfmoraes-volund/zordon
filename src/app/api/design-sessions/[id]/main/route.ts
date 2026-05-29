import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canChangeSessionVisibility, getUser } from "@/lib/dal";

/**
 * PATCH /api/design-sessions/[id]/main
 *
 * Body: { isMain: boolean }
 *
 * Marca/desmarca a DS como a "principal" do projeto pra aquele type. Única
 * por (projectId, type) — quando isMain=true, desmarca a anterior.
 *
 * Pré-condição: visibility='public'. Sessions internas não podem ser main
 * (CHECK no DB; aqui devolvemos 400 cedo com mensagem melhor).
 *
 * Autorização: mesma de visibility — leads/contributors/managers.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const isMain = body?.isMain;
  if (typeof isMain !== "boolean") {
    return NextResponse.json(
      { error: "isMain must be boolean" },
      { status: 400 },
    );
  }

  const supabase = db();
  const { data: session, error: lookupErr } = await supabase
    .from("DesignSession")
    .select("id, projectId, type, visibility, isMain")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (!(await canChangeSessionVisibility(session.projectId))) {
    return new NextResponse(
      "Forbidden — only project leads/contributors or managers can mark main",
      { status: 403 },
    );
  }

  if (isMain && session.visibility !== "public") {
    return NextResponse.json(
      { error: "Only public sessions can be marked as main" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();

  // Toggle exclusivo: ao marcar true, desmarca a anterior do mesmo (projectId,
  // type) antes — evita 23505 do unique partial index.
  if (isMain) {
    const { error: clearErr } = await supabase
      .from("DesignSession")
      .update({ isMain: false, updatedAt: now })
      .eq("projectId", session.projectId)
      .eq("type", session.type)
      .eq("isMain", true)
      .neq("id", id);
    if (clearErr) {
      return NextResponse.json({ error: clearErr.message }, { status: 500 });
    }
  }

  const { data: updated, error } = await supabase
    .from("DesignSession")
    .update({ isMain, updatedAt: now })
    .eq("id", id)
    .select("id, isMain")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
