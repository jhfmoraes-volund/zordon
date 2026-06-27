import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { buildRepoManifest } from "@/lib/composio/manifest";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/[id]/repo/refresh-manifest
 *   Rebuild manifest do repo já configurado (sem mudar owner/repo/branch).
 *   Usa o token Composio do member que chamou. Útil quando AGENTS.md mudou
 *   ou estrutura nova chegou.
 */
export async function POST(_req: Request, { params }: RouteParams) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;
  const denied = await requireCapabilityApi("task.edit", { projectId });
  if (denied) return denied;

  const supabase = db();
  const { data: project, error: pErr } = await supabase
    .from("Project")
    .select("githubRepoOwner, githubRepoName, githubDefaultBranch")
    .eq("id", projectId)
    .maybeSingle();
  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }
  if (!project?.githubRepoOwner || !project?.githubRepoName) {
    return NextResponse.json(
      { error: "Projeto não tem repo configurado. Use POST /repo primeiro." },
      { status: 400 },
    );
  }

  const manifest = await buildRepoManifest({
    userId: member.id,
    owner: project.githubRepoOwner,
    repo: project.githubRepoName,
    branch: project.githubDefaultBranch ?? "main",
  });

  if (!manifest.ok) {
    return NextResponse.json({ error: manifest.error }, { status: 502 });
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("Project")
    .update({
      repoManifest: manifest.markdown,
      repoManifestUpdatedAt: now,
      updatedAt: now,
    })
    .eq("id", projectId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    manifest: {
      sizeBytes: manifest.sizeBytes,
      updatedAt: now,
    },
  });
}
