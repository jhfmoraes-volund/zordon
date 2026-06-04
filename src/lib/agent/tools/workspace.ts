// workspace tools — leitura SANDBOXED dentro do workspace do projeto na
// Forja (~/zordon-forge/workspaces/<projectKey>/). Vitor pode usar pra
// ancorar discovery no código real do projeto. Toda chamada valida o
// path contra o prefixo do workspace — paths fora retornam erro.
//
// Por que não usar Read/Grep/Glob nativos do CC SDK: aqueles aceitam path
// absoluto e atravessam o disco inteiro. cwd só seta starting point, não
// restringe. Já tivemos incidente real (agente leu ~/Documents do user).
import { tool, type Tool } from "ai";
import { z } from "zod";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute, join } from "node:path";

type SourceContext = {
  workspacePath: string | null;
};

function ensureInWorkspace(
  ctx: SourceContext,
  inputPath: string,
): { absolute: string; relative: string } {
  if (!ctx.workspacePath) {
    throw new Error(
      "no_workspace: este projeto ainda não foi clonado na Forja. Não há código pra ler.",
    );
  }
  const workspaceRoot = resolve(ctx.workspacePath);
  const absolute = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(workspaceRoot, inputPath);
  const rel = relative(workspaceRoot, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `path_outside_workspace: '${inputPath}' aponta fora de ${workspaceRoot}. Você só pode ler arquivos dentro do workspace do projeto.`,
    );
  }
  return { absolute, relative: rel };
}

// ─── read_workspace_file ────────────────────────────────────────────────────

export function createReadWorkspaceFileTool(ctx: SourceContext): Tool {
  return tool({
    description:
      "Le um arquivo do workspace do projeto clonado na Forja (~/zordon-forge/workspaces/<projectKey>/). Path pode ser RELATIVO (ex: 'src/app/page.tsx') ou ABSOLUTO (deve estar dentro do workspace). Retorna texto. Falha com 'path_outside_workspace' se voce tentar ler fora do projeto. Use pra ancorar discovery no codigo real.",
    inputSchema: z.object({
      path: z.string().min(1),
      maxBytes: z.number().int().positive().max(500_000).optional(),
    }),
    execute: async ({ path, maxBytes }) => {
      const { absolute, relative: rel } = ensureInWorkspace(ctx, path);
      const limit = maxBytes ?? 200_000;
      try {
        const buf = await readFile(absolute);
        const truncated = buf.length > limit;
        const content = truncated
          ? buf.slice(0, limit).toString("utf-8") + "\n\n... [truncado, file tem " + buf.length + " bytes]"
          : buf.toString("utf-8");
        return {
          path: rel,
          bytes: buf.length,
          truncated,
          content,
        };
      } catch (err) {
        throw new Error(
          `read_failed: ${rel} — ${(err as Error).message}`,
        );
      }
    },
  });
}

// ─── glob_workspace ─────────────────────────────────────────────────────────

const DEFAULT_IGNORE = new Set([
  "node_modules",
  ".next",
  ".turbo",
  ".vercel",
  "dist",
  "build",
  ".git",
  ".cache",
  "coverage",
  ".forge.lock",
]);

async function walkWorkspace(
  root: string,
  maxFiles: number,
): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string) {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (DEFAULT_IGNORE.has(e.name)) continue;
      if (e.name.startsWith(".") && e.name !== ".env.example") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await recurse(full);
      } else if (e.isFile()) {
        out.push(relative(root, full));
      }
    }
  }
  await recurse(root);
  return out;
}

function matchesGlob(filePath: string, pattern: string): boolean {
  // Simple glob: '*' matches anything except '/', '**' matches anything,
  // outros chars literais. Suficiente pra patterns comuns.
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§§DOUBLESTAR§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§DOUBLESTAR§§/g, ".*")
        .replace(/\?/g, "[^/]") +
      "$",
  );
  return re.test(filePath);
}

export function createGlobWorkspaceTool(ctx: SourceContext): Tool {
  return tool({
    description:
      "Lista arquivos do workspace que casam com um glob pattern (ex: '**/*.tsx', 'src/lib/**/*.ts', 'package.json'). Ignora node_modules, .next, .git, etc. Retorna paths relativos ao workspace.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      limit: z.number().int().positive().max(500).optional(),
    }),
    execute: async ({ pattern, limit }) => {
      if (!ctx.workspacePath) {
        throw new Error(
          "no_workspace: este projeto ainda não foi clonado na Forja.",
        );
      }
      const root = resolve(ctx.workspacePath);
      const max = limit ?? 200;
      const all = await walkWorkspace(root, 5000);
      const matches = all.filter((p) => matchesGlob(p, pattern)).slice(0, max);
      return {
        pattern,
        matchCount: matches.length,
        truncated: matches.length >= max,
        files: matches,
      };
    },
  });
}

// ─── grep_workspace ─────────────────────────────────────────────────────────

const TEXT_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "json", "md", "mdx", "txt", "yaml", "yml",
  "sql", "css", "scss", "html",
  "sh", "py", "rb", "go", "rs",
  "env", "example", "gitignore",
]);

function isTextFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXT.has(ext);
}

export function createGrepWorkspaceTool(ctx: SourceContext): Tool {
  return tool({
    description:
      "Busca regex em arquivos texto do workspace. Retorna matches com path + linha + preview. Use pra encontrar uso de funcoes, configs, padroes no codigo real do projeto.",
    inputSchema: z.object({
      pattern: z.string().min(1).describe("Regex JavaScript-style"),
      pathGlob: z.string().optional().describe("Restringe a arquivos que casam com este glob (ex: '**/*.ts')"),
      maxMatches: z.number().int().positive().max(200).optional(),
    }),
    execute: async ({ pattern, pathGlob, maxMatches }) => {
      if (!ctx.workspacePath) {
        throw new Error(
          "no_workspace: este projeto ainda não foi clonado na Forja.",
        );
      }
      const root = resolve(ctx.workspacePath);
      const max = maxMatches ?? 50;
      let re: RegExp;
      try {
        re = new RegExp(pattern, "m");
      } catch (err) {
        throw new Error(`bad_regex: ${(err as Error).message}`);
      }
      const all = await walkWorkspace(root, 5000);
      const candidates = all.filter((p) => {
        if (!isTextFile(p)) return false;
        if (pathGlob && !matchesGlob(p, pathGlob)) return false;
        return true;
      });

      const matches: Array<{ path: string; line: number; preview: string }> = [];
      for (const rel of candidates) {
        if (matches.length >= max) break;
        const abs = join(root, rel);
        try {
          const s = await stat(abs);
          if (s.size > 500_000) continue; // skip files > 500KB
          const content = await readFile(abs, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= max) break;
            if (re.test(lines[i])) {
              matches.push({
                path: rel,
                line: i + 1,
                preview: lines[i].slice(0, 200),
              });
            }
          }
        } catch {
          continue;
        }
      }
      return {
        pattern,
        matchCount: matches.length,
        truncated: matches.length >= max,
        matches,
      };
    },
  });
}
