// GET /api/clients/[id]/insights
//
// Returns the latest ClientInsight row for the client, plus a hint about any
// in-flight client-kind job, plus the per-project ProjectInsight rows so the
// page can render the drill-down without a second round-trip.
//
// Gate: manager+ (matches the ClientInsight RLS policy). The per-project rows
// are filtered through the user JWT, so contributors who happen to have
// project access still see only the projects they're entitled to — but no one
// below manager hits this route in practice (UI hides the page section).

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { requireMinAccessLevelApi } from "@/lib/dal";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;

  const denied = await requireMinAccessLevelApi("manager");
  if (denied) return denied;

  const admin = db();

  const [{ data: insight }, { data: pendingJob }, { data: projects }] =
    await Promise.all([
      admin
        .from("ClientInsight")
        .select("*")
        .eq("clientId", clientId)
        .maybeSingle(),
      admin
        .from("InsightJob")
        .select("id, status, source, createdAt")
        .eq("clientId", clientId)
        .eq("kind", "client")
        .in("status", ["pending", "running"])
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("Project")
        .select("id, name, status")
        .eq("clientId", clientId)
        .order("createdAt", { ascending: false }),
    ]);

  const projectIds = (projects ?? []).map((p) => p.id);

  // Per-project insights via the user's JWT — so RLS filters to projects the
  // caller has access to. Manager+ sees everything anyway, but this keeps the
  // contract honest for future role changes.
  const userClient = await createClient();
  const { data: projectInsights } = projectIds.length
    ? await userClient
        .from("ProjectInsight")
        .select(
          "projectId, generatedAt, relationalHealth, relationalSummary, technicalHealth, technicalSummary, errorRelational, errorTechnical",
        )
        .in("projectId", projectIds)
    : { data: [] as Array<{ projectId: string }> };

  return NextResponse.json({
    insight,
    pendingJob,
    projects: projects ?? [],
    projectInsights: projectInsights ?? [],
  });
}
