/**
 * gen-agent-surface — gera o "advertised surface manifest" dos agentes a partir
 * do TOOL_REGISTRY (SSOT), pra servir de:
 *   1. golden de inércia (nenhuma tool entra/sai de uma superfície sem querer)
 *   2. entrada do guard de drift name-only contra o zordon-daemon
 *   3. (futuro) base da matriz de capacidade gerada
 *
 * Idioma espelhado de gen-phase-sql.ts (--check / --write / stdout).
 *
 * IMPORTANTE: importa tools-registry.ts → PRECISA rodar sob o eval-tsconfig
 * (aliasa `server-only`):
 *   npx tsx --tsconfig tsconfig.eval.json scripts/gen-agent-surface.ts --write agent-surface/agent-surface.manifest.json
 *   npx tsx --tsconfig tsconfig.eval.json scripts/gen-agent-surface.ts --check agent-surface/agent-surface.manifest.json
 *
 * NAME-ONLY por design: nomes anunciados por superfície, nada de needs/scope
 * (esses são internos ao monorepo; o daemon diverge legitimamente — ver runbook
 * agent-capability-unification §3.4).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getToolNamesForAgent } from "../src/lib/agent/tools-registry";

/** Lista canônica de superfícies. Mantém a ORDEM (chave estável no manifest). */
const SURFACES: Array<{ key: string; slug: string; surface: string | null }> = [
  { key: "vitor", slug: "vitor", surface: null },
  { key: "vitoria:pm_review", slug: "vitoria", surface: "pm_review" },
  { key: "vitoria:planning", slug: "vitoria", surface: "planning" },
  { key: "vitoria:release_planning", slug: "vitoria", surface: "release_planning" },
  { key: "vitoria:wiki", slug: "vitoria", surface: "wiki" },
  { key: "alpha", slug: "alpha", surface: null },
];

export function buildSurfaceManifest(): Record<string, string[]> {
  const manifest: Record<string, string[]> = {};
  for (const { key, slug, surface } of SURFACES) {
    manifest[key] = [...getToolNamesForAgent(slug, surface)].sort((a, b) =>
      a.localeCompare(b),
    );
  }
  return manifest;
}

/** Serialização canônica: ordem de SURFACES + nomes ordenados + 2 espaços. */
export function serializeManifest(manifest: Record<string, string[]>): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}

function main() {
  const args = process.argv.slice(2);
  const out = serializeManifest(buildSurfaceManifest());

  const checkIdx = args.indexOf("--check");
  const writeIdx = args.indexOf("--write");

  if (checkIdx !== -1) {
    const target = args[checkIdx + 1];
    if (!target) {
      console.error("--check requer FILE");
      process.exit(2);
    }
    let current: string;
    try {
      current = readFileSync(resolve(target), "utf8");
    } catch {
      console.error(`✗ ${target} não existe. Rode com --write primeiro.`);
      process.exit(1);
    }
    // Re-serializa o committed pra comparar normalizado (imune a ordem/espaço).
    const normalizedCurrent = serializeManifest(
      JSON.parse(current) as Record<string, string[]>,
    );
    if (normalizedCurrent !== out) {
      console.error(
        `✗ ${target} fora de sincronia com TOOL_REGISTRY.\n` +
          `  Rode \`npx tsx --tsconfig tsconfig.eval.json scripts/gen-agent-surface.ts --write ${target}\` e revise o diff.`,
      );
      process.exit(1);
    }
    console.log(`✓ ${target} em sincronia com o advertised surface do registry.`);
    return;
  }

  if (writeIdx !== -1) {
    const target = args[writeIdx + 1];
    if (!target) {
      console.error("--write requer FILE");
      process.exit(2);
    }
    writeFileSync(resolve(target), out, "utf8");
    console.log(`✓ Escrito em ${target}`);
    return;
  }

  process.stdout.write(out);
}

if (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import.meta as any).url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("gen-agent-surface.ts")
) {
  main();
}
