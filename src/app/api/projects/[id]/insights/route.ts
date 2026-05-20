// GET /api/projects/[id]/insights
// Returns the latest ProjectInsight row for the project, plus a hint about
// any in-flight job. Audience gate: requireProjectEditTasksApi (contributor+).
// Viewers/session_participants don't see this card per PRD §5.

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireProjectEditTasksApi } from "@/lib/dal";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const denied = await requireProjectEditTasksApi(projectId);
  if (denied) return denied;

  const supabase = db();

  // Latest insight (UNIQUE projectId in v1 so there's at most one).
  const { data: insight } = await supabase
    .from("ProjectInsight")
    .select("*")
    .eq("projectId", projectId)
    .maybeSingle();

  // Is there a job in flight? Used by the UI to show a spinner without
  // having to poll. A separate realtime channel on ProjectInsight refreshes
  // the snapshot when the job finishes.
  const { data: pendingJob } = await supabase
    .from("InsightJob")
    .select("id, status, source, createdAt")
    .eq("projectId", projectId)
    .in("status", ["pending", "running"])
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ insight, pendingJob });
}
