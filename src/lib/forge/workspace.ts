/**
 * Forge Workspace Management
 *
 * Workspace **por projeto** (D2), persistente, com reset incremental antes
 * de cada run (D3). Vive em $FORGE_HOME/workspaces/<slug>/.
 *
 * Decisões relevantes (vide src/lib/forge/paths.ts pra D1/D2/D7/D8):
 *
 *   D3  Reset hard antes de cada run pra garantir start limpo, mas preservando
 *       caches caros (D4) via `-e <pattern>` em git clean.
 *
 *   D5  Branch base usa Project.githubDefaultBranch (fallback "main").
 *
 *   D6  Lock per-project (`.forge.lock` no workspace root) impede runs
 *       concorrentes do MESMO projeto. Multi-projeto roda em paralelo.
 *
 * Lifecycle:
 *   1. ensureWorkspace(): clone fresh OU reset incremental
 *   2. acquireWorkspaceLock(): garantia de unicidade
 *   3. (Claude trabalha)
 *   4. releaseWorkspaceLock() + updateSentinelLastRun(): no fim ou em erro
 *
 * Caches preservados em reset (D4):
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "@/lib/supabase/database.types";
import {
  ensureForgeHome,
  getWorkspacesRoot,
  readSentinel,
  releaseLock,
  resolveWorkspacePath,
  tryAcquireLock,
  writeSentinel,
  type ForgeProjectLike,
} from "@/lib/forge/paths";

type ProjectRow = Database["public"]["Tables"]["Project"]["Row"];

// D4 — caches preservados em git clean -fdx
const PRESERVED_CACHE_PATTERNS = [
  "node_modules",
  ".next",
  ".turbo",
  ".vercel",
  "dist",
  "build",
  ".nuxt",
  "target", // Rust
  ".venv",
  "__pycache__",
  "vendor", // PHP/Go
  ".gradle",
  ".pnpm-store",
  ".yarn",
  ".cargo",
  ".forge.json", // sentinel próprio
  ".forge.lock", // lock próprio
];

const DEFAULT_BRANCH_FALLBACK = "main";

export type WorkspaceConfig = {
  runId: string;
  project: ProjectRow;
};

export type WorkspaceResult = {
  workspacePath: string;
  /** Branch criada pra esse run (forge/<prdSlug>-<runId-short>). */
  branch: string;
  /** Branch base (default branch do projeto). */
  baseBranch: string;
  /** true = clone fresh, false = workspace reusado (reset). */
  freshClone: boolean;
};

/**
 * Garante workspace pronto pra um run. Idempotente.
 *
 * Fluxo:
 *  1. Valida FORGE_HOME escrevível
 *  2. Resolve path do workspace via referenceKey (lida com colisão)
 *  3. Se path não existe ou sem sentinel: clone fresh
 *  4. Se existe e sentinel bate: reset incremental
 *  5. Cria branch forge/<prdSlug>-<runId-short>
 *  6. Escreve/atualiza sentinel
 *
 * NÃO adquire lock — chame {@link acquireWorkspaceLock} separadamente.
 */
export function ensureWorkspace(
  config: WorkspaceConfig & { prdSlug?: string },
): WorkspaceResult {
  const { runId, project, prdSlug = "run" } = config;

  if (!project.repoUrl || project.repoUrl.trim() === "") {
    throw new Error(
      `Project ${project.id} (${project.name}) has no repoUrl configured.`,
    );
  }

  ensureForgeHome();
  const workspacePath = resolveWorkspacePath(toProjectLike(project));
  const baseBranch = project.githubDefaultBranch || DEFAULT_BRANCH_FALLBACK;
  const branch = `forge/${slugForBranch(prdSlug)}-${runId.slice(0, 8)}`;

  const sentinel = readSentinel(workspacePath);
  const needsFreshClone =
    !existsSync(resolve(workspacePath, ".git")) || sentinel === null;

  // Reuse detection: chamadas subsequentes do MESMO autorun (várias stories
  // dentro do mesmo loop) devem só fazer checkout, sem reset — senão perde
  // os commits das stories anteriores. Detectamos via sentinel.lastRunId.
  const isSameAutorun =
    !needsFreshClone &&
    sentinel?.lastRunId === runId &&
    sentinel?.projectId === project.id;

  if (needsFreshClone) {
    freshCloneInto(workspacePath, project, baseBranch);
    execGit(workspacePath, `git checkout -B "${branch}"`);
  } else if (isSameAutorun) {
    // Story 2+ do mesmo autorun — só garante que estamos na branch certa.
    // Edge case: branch foi criada com -B no run anterior mas NUNCA recebeu
    // commit (closeout/F5 não existe ainda → workspace fica com phantom branch:
    // HEAD aponta pra ref que não existe). git checkout BRANCH falha com
    // "pathspec did not match". Se HEAD já aponta pro branch certo, é no-op.
    if (currentBranch(workspacePath) !== branch) {
      execGit(workspacePath, `git checkout "${branch}"`);
    }
  } else {
    // Autorun novo no workspace persistente — reset incremental + branch new.
    resetIncremental(workspacePath, project, baseBranch);
    execGit(workspacePath, `git checkout -B "${branch}"`);
  }

  // Atualiza sentinel (D7). createdAt preservado se já existia.
  writeSentinel(workspacePath, {
    projectId: project.id,
    projectName: project.name,
    referenceKey: project.referenceKey,
    createdAt: sentinel?.createdAt ?? new Date().toISOString(),
    lastRunId: runId,
    lastRunAt: new Date().toISOString(),
  });

  return {
    workspacePath,
    branch,
    baseBranch,
    freshClone: needsFreshClone,
  };
}

/**
 * Tenta tomar lock exclusivo do workspace. Retorna true se obtido.
 * False = outro run está em execução — daemon deve devolver job pra fila.
 */
export function acquireWorkspaceLock(
  workspacePath: string,
  meta: { runId: string; daemonId: string },
): boolean {
  return tryAcquireLock(workspacePath, { ...meta, pid: process.pid });
}

export function releaseWorkspaceLock(workspacePath: string): void {
  releaseLock(workspacePath);
}

/**
 * GC de workspaces inativos. Remove pastas em $FORGE_HOME/workspaces/ cujo
 * sentinel tem `lastRunAt` mais velho que `maxAgeDays` (default 30).
 *
 * Diferente da versão antiga (que indexava por runId), aqui o critério é
 * inatividade — projetos ativos ficam preservados indefinidamente.
 */
export function gcStaleWorkspaces(maxAgeDays = 30): string[] {
  const root = getWorkspacesRoot();
  if (!existsSync(root)) return [];

  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const workspacePath = resolve(root, entry.name);
    const sentinel = readSentinel(workspacePath);

    // Sem sentinel: olha mtime da pasta como fallback
    const lastTouchedMs = sentinel?.lastRunAt
      ? new Date(sentinel.lastRunAt).getTime()
      : statSync(workspacePath).mtimeMs;

    if (now - lastTouchedMs > maxAgeMs) {
      try {
        rmSync(workspacePath, { recursive: true, force: true });
        removed.push(entry.name);
      } catch {
        // ignore — best effort
      }
    }
  }

  return removed;
}

// ─── Internals ───────────────────────────────────────────────────────────────

function toProjectLike(p: ProjectRow): ForgeProjectLike {
  return { id: p.id, name: p.name, referenceKey: p.referenceKey };
}

function freshCloneInto(
  workspacePath: string,
  project: ProjectRow,
  baseBranch: string,
): void {
  // Limpa qualquer resto inválido antes de clonar
  if (existsSync(workspacePath)) {
    rmSync(workspacePath, { recursive: true, force: true });
  }
  mkdirSync(workspacePath, { recursive: true });

  const cloneUrl = buildCloneUrl(project.repoUrl as string, project.githubPat);

  try {
    execSync(
      `git clone --depth 1 --branch "${baseBranch}" "${cloneUrl}" "${workspacePath}"`,
      { stdio: "pipe", encoding: "utf-8" },
    );
  } catch (err) {
    // Tenta sem --branch (caso default branch tenha outro nome no remote)
    try {
      execSync(`git clone --depth 1 "${cloneUrl}" "${workspacePath}"`, {
        stdio: "pipe",
        encoding: "utf-8",
      });
    } catch (err2) {
      if (existsSync(workspacePath)) {
        rmSync(workspacePath, { recursive: true, force: true });
      }
      const message =
        err2 instanceof Error
          ? err2.message
          : err instanceof Error
            ? err.message
            : String(err2);
      throw new Error(
        `Failed to clone ${project.repoUrl} into ${workspacePath}: ${message}`,
      );
    }
  }
}

/**
 * Reset incremental: traz workspace persistente pra estado limpo equivalente
 * a um clone fresh, mas preservando caches de dependências (D4).
 *
 * Comandos:
 *   git fetch origin <baseBranch>
 *   git checkout <baseBranch>
 *   git reset --hard origin/<baseBranch>
 *   git clean -fdx -e node_modules -e .next ...
 */
function resetIncremental(
  workspacePath: string,
  project: ProjectRow,
  baseBranch: string,
): void {
  // Garante remote authenticated com PAT atualizado (rotação de credencial)
  const desiredUrl = buildCloneUrl(project.repoUrl as string, project.githubPat);
  try {
    execGit(workspacePath, `git remote set-url origin "${desiredUrl}"`);
  } catch {
    // Se origin não existe ainda (workspace meio inválido), recria
    execGit(workspacePath, `git remote add origin "${desiredUrl}"`);
  }

  // Repo do cliente recém-criado, sem 1º commit: o remote não tem NENHUMA
  // branch, então não há ref pra fetch — `git fetch origin <base>` falharia com
  // "couldn't find remote ref <base>". Re-clona limpo (clone de repo vazio é
  // no-op de conteúdo, mas deixa o workspace consistente) e deixa o agente
  // criar o primeiro commit; o push posterior materializa a base branch.
  if (!remoteHasBranches(workspacePath)) {
    freshCloneInto(workspacePath, project, baseBranch);
    return;
  }

  // Refspec explícito: senão `git fetch origin <branch> --depth 1` só atualiza
  // FETCH_HEAD, NÃO cria/atualiza refs/remotes/origin/<branch>. Daí o checkout
  // -B abaixo falha com "origin/main is not a commit".
  execGit(
    workspacePath,
    `git fetch origin "${baseBranch}:refs/remotes/origin/${baseBranch}" --depth 1`,
  );
  // -B cria OU reseta a branch local apontando pra origin/<base>. Robusto
  // ao caso onde workspace tem só branch forge/* (não tem main local ainda).
  execGit(workspacePath, `git checkout -B "${baseBranch}" "origin/${baseBranch}"`);
  execGit(workspacePath, `git reset --hard "origin/${baseBranch}"`);

  const excludes = PRESERVED_CACHE_PATTERNS.map((p) => `-e "${p}"`).join(" ");
  execGit(workspacePath, `git clean -fdx ${excludes}`);
}

/**
 * true se o remote `origin` tem ao menos uma branch. Um repo recém-criado no
 * GitHub (sem commits) responde sem nenhuma head — nesse caso não há ref pra
 * fetch e o caller deve tratar como bootstrap (fresh clone), não reset.
 * Em falha de rede/auth assume `true` e deixa o fetch reportar o erro real.
 */
function remoteHasBranches(workspacePath: string): boolean {
  try {
    const out = execSync("git ls-remote --heads origin", {
      cwd: workspacePath,
      stdio: "pipe",
      encoding: "utf-8",
    });
    return out.trim().length > 0;
  } catch {
    return true;
  }
}

function execGit(cwd: string, cmd: string): void {
  try {
    execSync(cmd, { cwd, stdio: "pipe", encoding: "utf-8" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git command failed: ${cmd}\n${message}`);
  }
}

/**
 * Lê branch atual via HEAD direto. Robusto a "phantom branch" (ref sem
 * commits ainda) — git symbolic-ref funciona mesmo quando git rev-parse
 * --abbrev-ref HEAD falha em branch novo.
 */
function currentBranch(cwd: string): string | null {
  try {
    const out = execSync("git symbolic-ref --short HEAD", {
      cwd,
      stdio: "pipe",
      encoding: "utf-8",
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function slugForBranch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * Constrói URL de clone com PAT injetado se disponível (apenas pra github.com).
 */
function buildCloneUrl(repoUrl: string, pat: string | null): string {
  if (!pat) return repoUrl;
  if (!repoUrl.includes("github.com")) return repoUrl;

  if (repoUrl.startsWith("https://")) {
    return repoUrl.replace("https://", `https://x-access-token:${pat}@`);
  }
  if (repoUrl.startsWith("git@")) {
    const withoutPrefix = repoUrl.replace("git@github.com:", "");
    return `https://x-access-token:${pat}@github.com/${withoutPrefix}`;
  }
  return repoUrl;
}

