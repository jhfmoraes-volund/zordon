import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/dal";
import { executeTool } from "@/lib/composio/client";

/** Slug Composio v3 confirmado via REST em 2026-05-29. */
const LIST_REPOS_SLUG = "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER";

/**
 * GET /api/integrations/composio/github/repos
 *   Lista repos acessíveis pelo user (via Composio + token OAuth dele).
 *   Devolve { repos: [{owner, name, fullName, defaultBranch, private, description}] }.
 *
 *   Usado pelo GitHubRepoPickerModal no botão "Importar → Repositório GitHub".
 */
type GithubRepoApiItem = {
  full_name?: string;
  name?: string;
  owner?: { login?: string };
  default_branch?: string;
  private?: boolean;
  description?: string | null;
  updated_at?: string;
};

type NormalizedRepo = {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  updatedAt: string | null;
};

function normalize(item: GithubRepoApiItem): NormalizedRepo | null {
  const name = item.name;
  const owner = item.owner?.login;
  if (!name || !owner) return null;
  return {
    owner,
    name,
    fullName: item.full_name ?? `${owner}/${name}`,
    defaultBranch: item.default_branch ?? "main",
    private: Boolean(item.private),
    description: item.description ?? null,
    updatedAt: item.updated_at ?? null,
  };
}

export async function GET() {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await executeTool(member.id, LIST_REPOS_SLUG, {
    per_page: 100,
    sort: "updated",
    direction: "desc",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // Composio v3 shape: { data: { repositories: [...], has_more_pages }, ... }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = result.data as any;
  const rawItems = (data?.repositories ?? data?.data?.repositories ?? data?.items ?? data ?? []) as GithubRepoApiItem[];
  const repos = rawItems
    .map(normalize)
    .filter((r): r is NormalizedRepo => r !== null);

  return NextResponse.json({ repos });
}
