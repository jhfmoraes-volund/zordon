import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import type { Database } from "@/lib/supabase/database.types";

type TodoUpdate = Database["public"]["Tables"]["Todo"]["Update"];

/**
 * PATCH /api/profile/todos/[id]
 *   Body: { description?, status?, dueDate? }
 *   Allowed when the requester is the assignee, the creator, or an admin.
 *
 * DELETE /api/profile/todos/[id]
 *   Allowed when the requester is the creator or an admin.
 *
 * Auth checks are duplicated server-side (RLS is the floor; service_role
 * bypasses it, so we enforce again here).
 */

const STATUSES = ["todo", "doing", "done"] as const;

async function loadAuthorized(id: string, memberId: string) {
  const { data } = await db()
    .from("Todo")
    .select("id, assigneeId, createdById")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { todo: null, allowed: false };
  const allowed = data.assigneeId === memberId || data.createdById === memberId;
  return { todo: data, allowed };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentMember();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const { todo, allowed } = await loadAuthorized(id, me.id);
  if (!todo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const patch: TodoUpdate = {};

  if (body.description !== undefined) {
    const desc = String(body.description ?? "").trim();
    if (!desc) {
      return NextResponse.json({ error: "description vazio" }, { status: 400 });
    }
    patch.description = desc.slice(0, 500);
  }

  if (body.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: "status inválido" }, { status: 400 });
    }
    patch.status = body.status;
    patch.resolvedAt = body.status === "done" ? new Date().toISOString() : null;
  }

  if (body.dueDate !== undefined) {
    patch.dueDate = body.dueDate ? new Date(body.dueDate).toISOString() : null;
  }

  if (body.notes !== undefined) {
    if (body.notes === null) {
      patch.notes = null;
    } else {
      const trimmed = String(body.notes).trim();
      patch.notes = trimmed === "" ? null : trimmed;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nada pra atualizar" }, { status: 400 });
  }

  patch.updatedAt = new Date().toISOString();

  const { data, error } = await db()
    .from("Todo")
    .update(patch)
    .eq("id", id)
    .select(
      "id, description, status, dueDate, notes, source, meetingId, sourceReviewId, createdAt, resolvedAt",
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentMember();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const { todo } = await loadAuthorized(id, me.id);
  if (!todo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (todo.createdById !== me.id) {
    return NextResponse.json({ error: "Apenas o criador pode excluir" }, { status: 403 });
  }

  const { error } = await db().from("Todo").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
