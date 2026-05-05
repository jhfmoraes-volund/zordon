import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi, getCurrentMember } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { db } from "@/lib/db";
import {
  promoteTasksForModule,
  revertTasksForModule,
} from "@/lib/dal/story-hierarchy";

/**
 * POST /api/modules/[id]/approve
 * Marks a Module as approved (`approvedAt = now()`, `approvedBy = current member`)
 * AND promotes its draft tasks into the project backlog (status='draft' →
 * 'backlog', generates TASK-NNN reference for each). Stories+tasks become
 * visible in /projects/[id] from this point on.
 *
 * DELETE /api/modules/[id]/approve
 * Reverses approval. Pre-flight blocks if any task under this module is past
 * 'backlog' — caller must resolve in_progress/review/done tasks first. When
 * safe, sets approvedAt = NULL and reverts backlog tasks back to 'draft'.
 */

async function authorize(): Promise<Response | { memberId: string | null }> {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;
  const member = await getCurrentMember();
  return { memberId: member?.id ?? null };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize();
  if (auth instanceof Response) return auth;
  const memberId = auth.memberId;

  const supabase = db();
  const { data, error } = await supabase
    .from("Module")
    .update({
      approvedAt: new Date().toISOString(),
      approvedBy: memberId,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, name, approvedAt, approvedBy")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Module not found" }, { status: 404 });

  // Cascade: promote draft tasks under this module to backlog.
  try {
    const { promoted, totalFp } = await promoteTasksForModule(id);
    return NextResponse.json({ ...data, promoted, totalFp });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "task promotion failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize();
  if (auth instanceof Response) return auth;

  // Pre-flight: revert backlog tasks back to draft, OR fail with detail.
  try {
    const { reverted, blocking } = await revertTasksForModule(id);
    if (blocking.length > 0) {
      return NextResponse.json(
        {
          error: "blocked",
          message: `${blocking.length} task(s) já saíram do backlog`,
          blocking,
        },
        { status: 409 },
      );
    }

    const supabase = db();
    const { data, error } = await supabase
      .from("Module")
      .update({
        approvedAt: null,
        approvedBy: null,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, name, approvedAt")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Module not found" }, { status: 404 });
    return NextResponse.json({ ...data, reverted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unapprove failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
