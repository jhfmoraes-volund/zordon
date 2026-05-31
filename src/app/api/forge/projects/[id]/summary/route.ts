import { NextResponse } from "next/server";
import { getEffectiveAccessLevel } from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";
import { db } from "@/lib/db";
import { getProjectForgeSummary } from "@/lib/dal/forge-project";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const accessLevel = await getEffectiveAccessLevel();
  if (!hasMinAccessLevel(accessLevel, "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = db();
  const { data: project, error: projectError } = await supabase
    .from("Project")
    .select(
      "id, name, referenceKey, repoUrl, githubRepoOwner, githubRepoName, githubDefaultBranch, forgeSourceSessionId",
    )
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !project) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const summary = await getProjectForgeSummary(projectId);

  return NextResponse.json({ project, summary });
}
