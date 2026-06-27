import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { buildRepoManifest } from "@/lib/composio/manifest";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/[id]/repo
 *   Body: { owner: string, repo: string, branch?: string }
 *   Configura o repo GitHub do projeto:
 *     1. Salva owner/repoName/defaultBranch nas colunas existentes
 *     2. Constrói o manifest (via Composio do user atual) e salva em
 *        Project.repoManifest + repoManifestUpdatedAt
 *
 *   Inline (não async background) — chamada ~5-10s mas dá feedback imediato.
 *   Vitória vai usar o manifest do próximo turno em diante.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;
  const denied = await requireCapabilityApi("task.edit", { projectId });
  if (denied) return denied;

  let body: { owner?: string; repo?: string; branch?: string };
  try {
    body = (await req.json()) as { owner?: string; repo?: string; branch?: string };
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const owner = body.owner?.trim();
  const repo = body.repo?.trim();
  if (!owner || !repo) {
    return NextResponse.json(
      { error: "owner e repo são obrigatórios" },
      { status: 400 },
    );
  }
  const branch = body.branch?.trim() || "main";

  // 1. Salva colunas (sem o manifest ainda — assim mesmo que o build falhe,
  // owner/repo ficam persistidos e usuário pode tentar refresh depois).
  const supabase = db();
  const { error: updErr } = await supabase
    .from("Project")
    .update({
      githubRepoOwner: owner,
      githubRepoName: repo,
      githubDefaultBranch: branch,
      repoUrl: `https://github.com/${owner}/${repo}`,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", projectId);
  if (updErr) {
    return NextResponse.json(
      { error: `Falha ao salvar repo: ${updErr.message}` },
      { status: 500 },
    );
  }

  // 2. Gera manifest.
  const manifest = await buildRepoManifest({
    userId: member.id,
    owner,
    repo,
    branch,
  });

  if (!manifest.ok) {
    return NextResponse.json(
      {
        owner,
        repo,
        branch,
        manifest: null,
        warning: `Repo salvo, mas manifest falhou: ${manifest.error}. Tente "Atualizar manifest" depois.`,
      },
      { status: 200 },
    );
  }

  const now = new Date().toISOString();
  const { error: manifestErr } = await supabase
    .from("Project")
    .update({
      repoManifest: manifest.markdown,
      repoManifestUpdatedAt: now,
      updatedAt: now,
    })
    .eq("id", projectId);
  if (manifestErr) {
    return NextResponse.json(
      { error: `Manifest gerado mas falhou ao salvar: ${manifestErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    owner,
    repo,
    branch,
    manifest: {
      sizeBytes: manifest.sizeBytes,
      updatedAt: now,
    },
  });
}

/**
 * DELETE /api/projects/[id]/repo
 *   Desvincula o repo do projeto. Limpa as 4 colunas + manifest.
 */
export async function DELETE(_req: Request, { params }: RouteParams) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;
  const denied = await requireCapabilityApi("task.edit", { projectId });
  if (denied) return denied;

  const supabase = db();
  const { error } = await supabase
    .from("Project")
    .update({
      githubRepoOwner: null,
      githubRepoName: null,
      githubDefaultBranch: "main",
      repoUrl: null,
      repoManifest: null,
      repoManifestUpdatedAt: null,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", projectId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
