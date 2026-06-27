/**
 * PUT /api/planning/[id]/actions/[actionId]
 * Registra a decisão (approved | rejected | pending) de uma MeetingTaskAction
 * vinculada a uma PlanningCeremony.
 *
 * Não exige meetingId no path — a action é identificada pelo actionId diretamente.
 * Auth: caller precisa ter acesso ao projeto da planning.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { getPlanningById } from "@/lib/dal/planning";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";

type Update = Database["public"]["Tables"]["MeetingTaskAction"]["Update"];

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; actionId: string }> },
) {
  const { id, actionId } = await params;

  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }

  // Registrar a decisão (approved/rejected/pending) de uma action é OPERAR o
  // Planning — não basta VER o projeto. Reconciliado de requireProjectViewApi
  // (view-level, frouxo demais p/ mutação) p/ ritual.planning, o mesmo gate da
  // rota irmã .../complete. (tightening — ver flag)
  const denied = await requireCapabilityApi("ritual.planning", {
    projectId: planning.projectId,
  });
  if (denied) return denied;

  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "sem memberId no contexto" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    decision?: "pending" | "approved" | "rejected";
    reviewNote?: string | null;
    reviewReasons?: string[] | null;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }

  const editable: Update = { updatedAt: new Date().toISOString() };

  if ("reviewNote" in body) editable.reviewNote = body.reviewNote ?? null;
  if ("reviewReasons" in body) editable.reviewReasons = body.reviewReasons ?? null;

  if (body.decision && ["pending", "approved", "rejected"].includes(body.decision)) {
    editable.decision = body.decision;
    if (body.decision === "pending") {
      editable.decidedAt = null;
      editable.decidedById = null;
    } else {
      editable.decidedAt = new Date().toISOString();
      editable.decidedById = me.id;
    }
  }

  const { data, error } = await db()
    .from("MeetingTaskAction")
    .update(editable)
    .eq("id", actionId)
    .eq("planningCeremonyId", id)
    .select("id, decision, decidedAt, updatedAt")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
