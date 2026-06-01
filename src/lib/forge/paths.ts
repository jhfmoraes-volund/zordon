/**
 * Forge home directory + path resolution.
 *
 * Decisões (`Dn` referenciados nos AGENTS.md e PRD da Forja):
 *
 *   D1  FORGE_HOME default ~/volund-forge (visível no Finder, sem ponto).
 *       Override via env FORGE_HOME ou CLI flag --home. Resolvido aqui em
 *       runtime; nada hard-codeado a cwd().
 *
 *   D2  Workspace por projeto. Slug derivado de:
 *         project.referenceKey (lowercase) → slugify(name) → id.slice(0,8).
 *       Colisões resolvidas via sufixo numérico (-2, -3) checadas no setup.
 *
 *   D7  Sentinel .forge.json no root do workspace identifica o projeto
 *       canonicamente. Pasta sem sentinel é tratada como vazia (re-clone).
 *
 *   D8  Workspace persiste; só é GC'd se sem atividade > 30 dias. Artifacts
 *       em runs/<runId>/ persistem 7 dias.
 *
 * Estrutura on-disk:
 *
 *   $FORGE_HOME/
 *   ├── workspaces/
 *   │   ├── <slug>/
 *   │   │   ├── .forge.json   ← sentinel (D7)
 *   │   │   ├── .forge.lock   ← lock per-project (D6)
 *   │   │   └── (repo clonado)
 *   │   └── ...
 *   ├── runs/<runId>/         ← events.jsonl, memory.jsonl, manifest
 *   ├── logs/
 *   └── cache/                ← reservado pra futuro (npm/pip caches)
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type ForgeProjectLike = {
  id: string;
  name: string | null;
  referenceKey: string | null;
};

/** Resolve FORGE_HOME. Default ~/volund-forge (visível no Finder). */
export function getForgeHome(): string {
  const fromEnv = process.env.FORGE_HOME?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(homedir(), "volund-forge");
}

/** Ensure FORGE_HOME directory tree exists + writable. Idempotente. */
export function ensureForgeHome(): string {
  const home = getForgeHome();
  for (const sub of ["workspaces", "runs", "logs", "cache"]) {
    mkdirSync(resolve(home, sub), { recursive: true });
  }
  // Sentinel write/delete pra validar permissão
  const probe = resolve(home, ".write-probe");
  try {
    writeFileSync(probe, String(Date.now()));
    unlinkSync(probe);
  } catch (err) {
    throw new Error(
      `FORGE_HOME (${home}) is not writable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return home;
}

/** Path do diretório de runs (artifacts/eventos). */
export function getRunPath(runId: string): string {
  return resolve(getForgeHome(), "runs", runId);
}

/** Path do diretório de logs. */
export function getLogsPath(): string {
  return resolve(getForgeHome(), "logs");
}

/** Caminho base de workspaces. */
export function getWorkspacesRoot(): string {
  return resolve(getForgeHome(), "workspaces");
}

// ─── Slug resolution ─────────────────────────────────────────────────────────

const RESERVED_SLUGS = new Set(["", "node_modules", ".git", "runs", "logs"]);

/** Converte string arbitrária pra slug filesystem-safe (kebab, lower, ASCII). */
export function slugifyForFs(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/**
 * Resolve o slug "base" do projeto antes de checagem de colisão.
 * referenceKey > slugify(name) > id.slice(0,8).
 */
export function baseSlugFor(project: ForgeProjectLike): string {
  const fromRef = project.referenceKey?.trim().toLowerCase();
  if (fromRef && !RESERVED_SLUGS.has(fromRef)) {
    const cleaned = slugifyForFs(fromRef);
    if (cleaned) return cleaned;
  }
  if (project.name) {
    const cleaned = slugifyForFs(project.name);
    if (cleaned && !RESERVED_SLUGS.has(cleaned)) return cleaned;
  }
  return project.id.slice(0, 8);
}

/**
 * Resolve o path final do workspace pra um projeto, lidando com colisão.
 * Se workspace existe e o sentinel aponta pra outro projectId, tenta -2, -3…
 *
 * Garante: workspace path único por projeto. Idempotente — mesma chamada
 * retorna mesmo path se o sentinel bate.
 */
export function resolveWorkspacePath(project: ForgeProjectLike): string {
  const base = baseSlugFor(project);
  const root = getWorkspacesRoot();
  let candidate = resolve(root, base);
  let suffix = 1;

  while (existsSync(candidate)) {
    const sentinel = readSentinel(candidate);
    if (sentinel === null) {
      // pasta existe mas vazia/sem sentinel: assume nossa, sobreescreve
      return candidate;
    }
    if (sentinel.projectId === project.id) {
      // mesma forja, mesmo projeto
      return candidate;
    }
    // colisão de slug com outro projeto → próximo sufixo
    suffix += 1;
    candidate = resolve(root, `${base}-${suffix}`);
  }

  return candidate;
}

// ─── Sentinel ────────────────────────────────────────────────────────────────

export type WorkspaceSentinel = {
  projectId: string;
  projectName: string;
  referenceKey: string | null;
  createdAt: string;
  lastRunId: string | null;
  lastRunAt: string | null;
};

const SENTINEL_NAME = ".forge.json";

export function sentinelPath(workspacePath: string): string {
  return resolve(workspacePath, SENTINEL_NAME);
}

export function readSentinel(workspacePath: string): WorkspaceSentinel | null {
  const path = sentinelPath(workspacePath);
  if (!existsSync(path)) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const raw = fs.readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as WorkspaceSentinel;
    if (typeof parsed.projectId === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export function writeSentinel(
  workspacePath: string,
  data: WorkspaceSentinel,
): void {
  writeFileSync(sentinelPath(workspacePath), JSON.stringify(data, null, 2) + "\n");
}

// ─── Lock ────────────────────────────────────────────────────────────────────

const LOCK_NAME = ".forge.lock";

export function lockPath(workspacePath: string): string {
  return resolve(workspacePath, LOCK_NAME);
}

/**
 * Tenta adquirir lock exclusivo no workspace. Retorna true se obteve, false
 * se outro run já está rodando. Lock file contém metadata pra debug.
 */
export function tryAcquireLock(
  workspacePath: string,
  meta: { runId: string; daemonId: string; pid: number },
): boolean {
  const path = lockPath(workspacePath);
  if (existsSync(path)) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // wx = fail if exists (atomic create)
    fs.writeFileSync(path, JSON.stringify({ ...meta, acquiredAt: new Date().toISOString() }), {
      flag: "wx",
    });
    return true;
  } catch {
    return false;
  }
}

export function releaseLock(workspacePath: string): void {
  const path = lockPath(workspacePath);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // ignore — lock liberation must never fail the run
  }
}
