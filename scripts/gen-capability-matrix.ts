/**
 * gen-capability-matrix — gera a matriz HUMANA de capacidades dos agentes a
 * partir do TOOL_REGISTRY (descriptors). Doc que NÃO drifta (D5 do runbook
 * agent-capability-unification). Importa o registry → roda sob eval-tsconfig:
 *
 *   npx tsx --tsconfig tsconfig.eval.json scripts/gen-capability-matrix.ts --write agent-surface/agent-capability-matrix.md
 *   npx tsx --tsconfig tsconfig.eval.json scripts/gen-capability-matrix.ts --check agent-surface/agent-capability-matrix.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOOL_REGISTRY } from "../src/lib/agent/tools-registry";
import type { NeedGroup, Surface } from "../src/lib/agent/tool-descriptor";

const SURFACES: Surface[] = [
  "vitor",
  "vitoria:pm_review",
  "vitoria:planning",
  "vitoria:release_planning",
  "vitoria:wiki",
  "alpha",
];
const HEAD: Record<Surface, string> = {
  vitor: "vitor",
  "vitoria:pm_review": "pm_review",
  "vitoria:planning": "planning",
  "vitoria:release_planning": "release_pl",
  "vitoria:wiki": "wiki",
  alpha: "alpha",
};

function fmtNeeds(needs: NeedGroup[]): string {
  if (!needs.length) return "—";
  return needs
    .map((g) => (Array.isArray(g) ? `(${g.join("\\|")})` : g))
    .join(", ");
}

export function buildMatrix(): string {
  const rows = Object.values(TOOL_REGISTRY).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const counts = SURFACES.map(
    (s) => rows.filter((d) => d.surfaces.includes(s)).length,
  );

  const lines: string[] = [];
  lines.push("# Matriz de capacidades dos agentes — GERADA (não editar à mão)");
  lines.push("");
  lines.push(
    "> Gerada de `src/lib/agent/tools-registry.ts` (descriptors) por `scripts/gen-capability-matrix.ts`.",
  );
  lines.push(
    "> Regenere: `npx tsx --tsconfig tsconfig.eval.json scripts/gen-capability-matrix.ts --write agent-surface/agent-capability-matrix.md`.",
  );
  lines.push(
    "> Pertencimento (`surfaces`) e escopo (`needs`) vivem no descriptor — esta tabela é projeção. Drift cross-repo: `scripts/check-daemon-surface.ts`.",
  );
  lines.push("");
  lines.push(
    `**${rows.length} tools** · surfaces: ${SURFACES.map((s, i) => `${HEAD[s]} ${counts[i]}`).join(" · ")}`,
  );
  lines.push("");

  const header = `| tool | class | needs | ${SURFACES.map((s) => HEAD[s]).join(" | ")} |`;
  const sep = `|------|-------|-------|${SURFACES.map(() => "----").join("|")}|`;
  lines.push(header);
  lines.push(sep);
  for (const d of rows) {
    const marks = SURFACES.map((s) => (d.surfaces.includes(s) ? "✓" : "·"));
    lines.push(
      `| \`${d.name}\` | ${d.class} | ${fmtNeeds(d.needs)} | ${marks.join(" | ")} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const out = buildMatrix();
  const checkIdx = args.indexOf("--check");
  const writeIdx = args.indexOf("--write");

  if (checkIdx !== -1) {
    const target = args[checkIdx + 1];
    if (!target) {
      console.error("--check requer FILE");
      process.exit(2);
    }
    let current = "";
    try {
      current = readFileSync(resolve(target), "utf8");
    } catch {
      console.error(`✗ ${target} não existe. Rode com --write.`);
      process.exit(1);
    }
    if (current.trimEnd() !== out.trimEnd()) {
      console.error(
        `✗ ${target} fora de sincronia com o registry. Rode --write e commite.`,
      );
      process.exit(1);
    }
    console.log(`✓ ${target} em dia com o registry.`);
    return;
  }
  if (writeIdx !== -1) {
    const target = args[writeIdx + 1];
    if (!target) {
      console.error("--write requer FILE");
      process.exit(2);
    }
    writeFileSync(resolve(target), out + "\n", "utf8");
    console.log(`✓ Escrito em ${target}`);
    return;
  }
  process.stdout.write(out + "\n");
}

if (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import.meta as any).url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("gen-capability-matrix.ts")
) {
  main();
}
