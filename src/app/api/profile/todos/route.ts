import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { canCreateTodoFor } from "@/lib/todos/permissions";

/**
 * GET /api/profile/todos
 *  Returns all To-dos assigned to the current member. Includes meeting source
 *  metadata when applicable (todo can come from a meeting, manual, or agent).
 *
 * POST /api/profile/todos
 *  Body: { description*, assigneeId?, dueDate?, status? }
 *  Creates a manual To-do (source='manual'). Defaults assigneeId to self.
 *  When assigneeId is someone else, enforces hierarchy via canCreateTodoFor.
 */

export async function GET() {
  const me = await getCurrentMember();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });

  const supabase = db();
  const { data, error } = await supabase
    .from("Todo")
    .select(
      "id, description, status, dueDate, notes, source, meetingId, sourceReviewId, createdAt, resolvedAt, " +
        "meeting:Meeting(id, date, title), " +
        "sourceReview:MeetingProjectReview(project:Project(name))",
    )
    .eq("assigneeId", me.id)
    .order("status", { ascending: true })
    .order("dueDate", { ascending: true, nullsFirst: false })
    .order("createdAt", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const me = await getCurrentMember();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const description = String(body.description ?? "").trim();
  if (!description) {
    return NextResponse.json({ error: "description obrigatório" }, { status: 400 });
  }

  const status = ["todo", "doing", "done"].includes(body.status) ? body.status : "todo";
  const assigneeId = (body.assigneeId as string | undefined) ?? me.id;

  // Enforce hierarchy when creating for someone else
  if (assigneeId !== me.id) {
    const { data: assignee } = await db()
      .from("Member")
      .select("id, role, position")
      .eq("id", assigneeId)
      .maybeSingle();
    if (!assignee) {
      return NextResponse.json({ error: "assignee não encontrado" }, { status: 400 });
    }
    if (!canCreateTodoFor({ id: me.id, role: me.role }, assignee)) {
      return NextResponse.json(
        { error: "Sem permissão para criar To-do para este membro" },
        { status: 403 },
      );
    }
  }

  const notesRaw = typeof body.notes === "string" ? body.notes.trim() : null;
  const notes = notesRaw && notesRaw !== "" ? notesRaw : null;

  const supabase = db();
  const { data: todo, error } = await supabase
    .from("Todo")
    .insert({
      id: crypto.randomUUID(),
      assigneeId,
      createdById: me.id,
      description: description.slice(0, 500),
      notes,
      source: "manual",
      meetingId: null,
      sourceReviewId: null,
      dueDate: body.dueDate ? new Date(body.dueDate).toISOString() : null,
      status,
      updatedAt: new Date().toISOString(),
    })
    .select(
      "id, description, status, dueDate, notes, source, meetingId, sourceReviewId, createdAt, resolvedAt",
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(todo, { status: 201 });
}
