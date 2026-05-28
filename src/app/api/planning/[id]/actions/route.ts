/**
 * GET /api/planning/[id]/actions
 * Lista as MeetingTaskAction vinculadas a uma PlanningCeremony.
 * Inclui task embed (título, status, sprint) pra exibir no command center.
 *
 * Auth: caller precisa ter acesso ao projeto da planning (via requireProjectViewApi).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { getPlanningById } from "@/lib/dal/planning";
import { db } from "@/lib/db";

const SELECT = `
  id, type, payload, decision, execution, source,
  aiReasoning, aiConfidence, errorMessage, notes,
  reviewReasons, reviewNote, createdAt, updatedAt,
  meetingId, planningCeremonyId, projectId, taskId, targetSprintId,
  task:Task(id, reference, title, status, scope, type, priority, sprintId, projectId),
  targetSprint:Sprint!MeetingTaskAction_targetSprintId_fkey(id, name)
`;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }

  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return denied;

  const { data, error } = await db()
    .from("MeetingTaskAction")
    .select(SELECT)
    .eq("planningCeremonyId", id)
    .order("createdAt", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
