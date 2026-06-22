/**
 * check-daemon-surface — guard de drift cross-repo NAME-ONLY entre o monorepo
 * (executa) e o zordon-daemon (anuncia schema). Roda sob `tsx` cru: lê só JSONs
 * committed (não importa registry), então é portável e não precisa do eval-tsconfig.
 *
 *   npx tsx scripts/check-daemon-surface.ts
 *
 * Inputs (committed):
 *   docs/platform/agent-surface.manifest.json          — surface do monorepo (SSOT)
 *   docs/platform/agent-surface.daemon.json            — surface do daemon (vendorizada)
 *   docs/platform/agent-surface.daemon-exclusions.json — { monorepoOnly: [...] }
 *
 * Invariante: daemon == (monorepo − exclusions), nos NOMES (união de superfícies).
 *  • daemon ⊄ monorepo  → daemon anuncia tool que o app não executa (schema fantasma).
 *  • (monorepo − exclusions) ⊄ daemon → tool do app sem stub no daemon → o modelo
 *    NUNCA a vê → ININVOCÁVEL (a falha #1 do runbook vitoria-agentic-planning).
 *
 * Pra atualizar o lado daemon: no zordon-daemon rode
 *   npx tsx scripts/gen-agent-surface.ts --write agent-surface.daemon.json
 * e copie pra docs/platform/agent-surface.daemon.json (vendoring).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (p: string) =>
  JSON.parse(readFileSync(resolve(root, p), "utf8")) as Record<string, unknown>;

const mono = read("docs/platform/agent-surface.manifest.json") as Record<string, string[]>;
const daemon = read("docs/platform/agent-surface.daemon.json") as Record<string, string[]>;
const excl = read("docs/platform/agent-surface.daemon-exclusions.json") as {
  monorepoOnly?: string[];
};
const exclusions = new Set(excl.monorepoOnly ?? []);

const monoUnion = new Set(Object.values(mono).flat());
const daemonUnion = new Set(Object.values(daemon).flat());

const extraInDaemon = [...daemonUnion].filter((n) => !monoUnion.has(n)).sort();
const missingInDaemon = [...monoUnion]
  .filter((n) => !daemonUnion.has(n) && !exclusions.has(n))
  .sort();

let failed = false;
if (extraInDaemon.length) {
  failed = true;
  console.error(
    `✗ daemon anuncia ${extraInDaemon.length} tool(s) que o monorepo NÃO executa (schema fantasma → execução 404):\n  ${extraInDaemon.join(", ")}`,
  );
}
if (missingInDaemon.length) {
  failed = true;
  console.error(
    `✗ ${missingInDaemon.length} tool(s) do monorepo SEM stub no daemon (modelo nunca vê → ININVOCÁVEL):\n  ${missingInDaemon.join(", ")}\n` +
      `  → espelhe no zordon-daemon (descriptor + regen agent-surface.daemon.json + vendore) OU adicione a agent-surface.daemon-exclusions.json se for monorepo-only deliberado.`,
  );
}

if (failed) {
  console.error(
    `\n  (regen do lado daemon: cd ../zordon-daemon && npx tsx scripts/gen-agent-surface.ts --write agent-surface.daemon.json && cp agent-surface.daemon.json ../zordon/docs/platform/)`,
  );
  process.exit(1);
}

console.log(
  `✓ daemon surface em sincronia: monorepo ${monoUnion.size} == daemon ${daemonUnion.size} (exclusions: ${exclusions.size})`,
);
