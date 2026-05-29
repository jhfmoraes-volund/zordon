import "server-only";

/**
 * Repo manifest builder — gera resumo curado do repo pra Vitória ter awareness
 * estrutural permanente no prompt sem ingerir 1M tokens.
 *
 * Estratégia (Camada E do intelligence-plan v2, T1):
 *  - Fetch AGENTS.md / CLAUDE.md / README.md (primeiro que existir)
 *  - Lista root + cada top-level dir (depth 2)
 *  - Fetch package.json (extrai scripts + deps count)
 *  - Concatena em markdown ≤ ~8k tokens
 *
 * Tudo via Composio (`composio.tools.execute`) — usa o token OAuth do user
 * que linkou o repo. Falhas em chamadas individuais são swallowed (manifest
 * fica parcial mas funcional).
 */

const MAX_README_BYTES = 30_000;
const MAX_DEPS_LISTED = 30;
const MAX_DIRS_EXPANDED = 12; // top-level dirs a expandir (depth 2)
const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".cache",
  ".turbo", "coverage", ".vercel", ".vscode", ".idea",
]);

type Composio = {
  tools: {
    execute: (
      slug: string,
      opts: { userId: string; arguments: Record<string, unknown> },
    ) => Promise<{ successful: boolean; data?: unknown; error?: string }>;
  };
};

type GhContentItem = {
  type: "file" | "dir" | "symlink" | "submodule";
  name: string;
  path: string;
  size?: number;
};

async function getClient(): Promise<Composio | null> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  const { Composio } = await import("@composio/core");
  const { VercelProvider } = await import("@composio/vercel");
  // SDK exige version por execute; "latest" no construtor libera o toolkit
  // sem hardcodar data específica. Cast pra Composio<...> (interface tipada da SDK).
  const composio = new Composio({
    apiKey,
    provider: new VercelProvider(),
    toolkitVersions: { github: "latest" },
  });
  return composio as unknown as Composio;
}

// Slugs confirmados via REST direto em 2026-05-29.
// Composio v3 — total 823 GitHub tools.
const SLUG_GET_CONTENT = "GITHUB_GET_REPOSITORY_CONTENT";

/**
 * Helper: extrai conteúdo decodificado de uma resposta GITHUB_GET_REPOSITORY_CONTENT.
 * A SDK pode devolver `data` em formatos diferentes (base64 ou já decodificado).
 */
function decodeFileContent(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = raw as any;
  // Tentativas em ordem: data.data.content (b64), data.content (b64), data.decoded
  const tryDecode = (s: unknown, enc?: unknown): string | null => {
    if (typeof s !== "string") return null;
    if (enc === "base64" || (!enc && /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 200)))) {
      try {
        return Buffer.from(s.replace(/\s/g, ""), "base64").toString("utf8");
      } catch {
        return s;
      }
    }
    return s;
  };
  if (typeof d.decoded === "string") return d.decoded;
  if (typeof d.content === "string") return tryDecode(d.content, d.encoding);
  if (d.data) {
    if (typeof d.data.decoded === "string") return d.data.decoded;
    if (typeof d.data.content === "string")
      return tryDecode(d.data.content, d.data.encoding);
  }
  return null;
}

async function tryGetFile(
  client: Composio,
  userId: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  try {
    const res = await client.tools.execute(SLUG_GET_CONTENT, {
      userId,
      arguments: {
        owner,
        repo,
        path,
        ...(ref ? { ref } : {}),
      },
    });
    if (!res.successful) return null;
    return decodeFileContent(res.data);
  } catch {
    return null;
  }
}

async function listDir(
  client: Composio,
  userId: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<GhContentItem[]> {
  // GITHUB_GET_REPOSITORY_CONTENT do GitHub API retorna ARRAY quando path é
  // diretório, ou objeto quando é arquivo. Mesma tool serve pra ambos.
  try {
    const res = await client.tools.execute(SLUG_GET_CONTENT, {
      userId,
      arguments: {
        owner,
        repo,
        path,
        ...(ref ? { ref } : {}),
      },
    });
    if (!res.successful) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = res.data as any;
    const items = (d?.data ?? d?.items ?? d) as unknown;
    if (!Array.isArray(items)) return [];
    return items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it: any) => ({
        type: it.type ?? "file",
        name: it.name ?? "",
        path: it.path ?? it.name ?? "",
        size: typeof it.size === "number" ? it.size : undefined,
      }))
      .filter((it) => it.name && !IGNORE_DIRS.has(it.name));
  } catch {
    return [];
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n…(truncado a ${max} chars)`;
}

function renderTreeSection(rootItems: GhContentItem[], expanded: Map<string, GhContentItem[]>): string {
  const lines: string[] = [];
  for (const item of rootItems) {
    if (item.type === "dir") {
      lines.push(`📁 ${item.name}/`);
      const children = expanded.get(item.path);
      if (children && children.length > 0) {
        const shown = children.slice(0, 20);
        for (const c of shown) {
          lines.push(`   ${c.type === "dir" ? "📁" : "📄"} ${c.name}${c.type === "dir" ? "/" : ""}`);
        }
        if (children.length > shown.length) {
          lines.push(`   … +${children.length - shown.length} items`);
        }
      }
    } else {
      lines.push(`📄 ${item.name}`);
    }
  }
  return lines.join("\n");
}

function renderPackageSection(pkgJson: string | null): string {
  if (!pkgJson) return "_(sem package.json)_";
  try {
    const pkg = JSON.parse(pkgJson) as {
      name?: string;
      version?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const lines: string[] = [];
    if (pkg.name) lines.push(`**Name**: \`${pkg.name}\``);
    if (pkg.version) lines.push(`**Version**: \`${pkg.version}\``);

    if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
      lines.push("", "**Scripts:**");
      for (const [k, v] of Object.entries(pkg.scripts)) {
        lines.push(`- \`npm run ${k}\` — \`${truncate(v, 80)}\``);
      }
    }

    const deps = Object.keys(pkg.dependencies ?? {});
    const devDeps = Object.keys(pkg.devDependencies ?? {});
    lines.push("", `**Dependencies**: ${deps.length} prod + ${devDeps.length} dev`);
    const topDeps = [...deps, ...devDeps].slice(0, MAX_DEPS_LISTED);
    if (topDeps.length > 0) {
      lines.push("Top: " + topDeps.map((d) => `\`${d}\``).join(", "));
    }
    return lines.join("\n");
  } catch {
    return "_(package.json inválido)_";
  }
}

export type BuildManifestInput = {
  /** Member.id que linkou — autoriza chamadas Composio com seu token OAuth */
  userId: string;
  owner: string;
  repo: string;
  branch?: string;
};

export type BuildManifestResult =
  | { ok: true; markdown: string; sizeBytes: number }
  | { ok: false; error: string };

/**
 * Builda o manifest completo. Retorna markdown pronto pra salvar em
 * Project.repoManifest. Idempotente — pode rodar quantas vezes quiser pra
 * atualizar.
 */
export async function buildRepoManifest(
  input: BuildManifestInput,
): Promise<BuildManifestResult> {
  const client = await getClient();
  if (!client) return { ok: false, error: "Composio não configurado" };

  const { userId, owner, repo, branch } = input;
  const ref = branch;

  // Roda em paralelo: readme (3 tentativas), tree root, package.json
  const [readmePromise, rootItems, pkgJson] = await Promise.all([
    (async () => {
      // Ordem: AGENTS.md > CLAUDE.md > README.md > readme.md
      const candidates = ["AGENTS.md", "CLAUDE.md", "README.md", "readme.md"];
      for (const path of candidates) {
        const content = await tryGetFile(client, userId, owner, repo, path, ref);
        if (content) return { path, content };
      }
      return null;
    })(),
    listDir(client, userId, owner, repo, "", ref),
    tryGetFile(client, userId, owner, repo, "package.json", ref),
  ]);

  // Pega top dirs do root pra expandir (depth 2)
  const dirsToExpand = rootItems
    .filter((it) => it.type === "dir")
    .slice(0, MAX_DIRS_EXPANDED);

  const expandedEntries = await Promise.all(
    dirsToExpand.map(async (d) => {
      const children = await listDir(client, userId, owner, repo, d.path, ref);
      return [d.path, children] as const;
    }),
  );
  const expanded = new Map(expandedEntries);

  const readme = await readmePromise;
  const readmeContent = readme
    ? truncate(readme.content, MAX_README_BYTES)
    : null;

  // Monta markdown
  const sections: string[] = [];
  sections.push(`# Manifest do repositório \`${owner}/${repo}\``);
  sections.push(
    `> Branch: \`${branch ?? "default"}\` · Gerado: ${new Date().toISOString()}`,
  );
  sections.push("");

  if (readmeContent) {
    sections.push(`## ${readme!.path}`);
    sections.push("");
    sections.push(readmeContent);
    sections.push("");
  } else {
    sections.push("## Documentação principal");
    sections.push("_(sem AGENTS.md / CLAUDE.md / README.md detectado)_");
    sections.push("");
  }

  sections.push("## Estrutura (depth 2)");
  sections.push("```");
  sections.push(renderTreeSection(rootItems, expanded));
  sections.push("```");
  sections.push("");

  sections.push("## package.json");
  sections.push(renderPackageSection(pkgJson));

  const markdown = sections.join("\n");
  return { ok: true, markdown, sizeBytes: Buffer.byteLength(markdown, "utf8") };
}
