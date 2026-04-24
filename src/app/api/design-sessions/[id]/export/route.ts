import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { db } from "@/lib/db";

/**
 * POST /api/design-sessions/[id]/export
 * Exports draft tasks generated during the session into the project's backlog.
 * For each draft task, generates a TASK-NNN reference, flips status to 'backlog',
 * then marks the session as completed. Idempotent: already-exported tasks are
 * ignored, so the endpoint can be retried safely on partial failure.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const supabase = db();

  const { data: drafts, error: draftsError } = await supabase
    .from("Task")
    .select("id, reference, functionPoints")
    .eq("designSessionId", sessionId)
    .eq("status", "draft")
    .order("createdAt", { ascending: true });

  if (draftsError) {
    return NextResponse.json({ error: draftsError.message }, { status: 500 });
  }

  let exported = 0;
  let totalFp = 0;

  for (const task of drafts ?? []) {
    // Preserve an existing reference (e.g. tasks backfilled from before the
    // draft status existed). Only generate a new one when reference is null.
    // The RPC is volatile and uniqueness is indexed, so collisions surface as
    // 23505 — retry a few times to absorb races with parallel creations.
    let success = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const update: { status: string; updatedAt: string; reference?: string } = {
        status: "backlog",
        updatedAt: new Date().toISOString(),
      };

      if (!task.reference) {
        const { data: ref, error: refError } = await supabase.rpc(
          "next_task_reference"
        );
        if (refError || !ref) {
          return NextResponse.json(
            { error: refError?.message || "reference generation failed" },
            { status: 500 }
          );
        }
        update.reference = ref;
      }

      const { error: updateError } = await supabase
        .from("Task")
        .update(update)
        .eq("id", task.id);

      if (!updateError) {
        success = true;
        break;
      }
      const code = (updateError as { code?: string }).code;
      if (code === "23505") continue;
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (!success) {
      return NextResponse.json(
        { error: "could not assign a unique reference after 5 attempts" },
        { status: 500 }
      );
    }

    exported += 1;
    totalFp += task.functionPoints ?? 0;
  }

  const { error: sessionError } = await supabase
    .from("DesignSession")
    .update({
      status: "completed",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  return NextResponse.json({ exported, totalFp });
}
