/**
 * agent-surface.test.ts — harness de segurança do refactor de capabilities.
 * Standalone, sem framework — padrão do projeto. PRECISA do eval-tsconfig porque
 * tools-registry.ts puxa `server-only` transitivamente:
 *   npx tsx --tsconfig tsconfig.eval.json scripts/agent-surface.test.ts
 *
 * Invariantes que blindam a conversão pra ToolDescriptor:
 *  A. ADVERTISED SURFACE — nomes por superfície batem com o manifest committed.
 *  B. BIND-SMOKE — todo bind, com ctx completo, devolve um Tool sem throw.
 *     getToolNamesForAgent só lê surfaces — NÃO observa os binds; isto observa.
 *  C. needs↔bind (over-declared) — pra cada need declarado, zerá-lo faz o bind
 *     dar throw. Se não der, o `needs` mente (declara algo que o bind não exige).
 *  D. needs↔bind (under-declared) — todo descriptor com needs:[] buila com ctx
 *     MÍNIMO (só projectId). Se der throw, o bind exige algo que o needs não
 *     declara. C+D juntos provam: needs == exatamente o que o bind hard-guarda.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TOOL_REGISTRY, type ToolContext } from "../src/lib/agent/tools-registry";
import { findNeedsBindMismatch } from "../src/lib/agent/tool-descriptor";
import { buildSurfaceManifest, serializeManifest } from "./gen-agent-surface";

// db() lê env em call-time; dummy torna o bind-smoke portável (CI sem .env).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy-service-role-key-for-tests";

const manifestPath = resolve(
  process.cwd(),
  "agent-surface/agent-surface.manifest.json",
);

// ─── A. advertised surface == manifest committed ──────────────────────────
const committed = serializeManifest(
  JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string[]>,
);
const recomputed = serializeManifest(buildSurfaceManifest());
assert.equal(
  recomputed,
  committed,
  "advertised surface divergiu do manifest committed — rode `gen-agent-surface --write` e revise o diff",
);
console.log("✓ A. manifest em sincronia com o registry");

// ─── B/C/D. binds ─────────────────────────────────────────────────────────
const fullCtx: ToolContext = {
  sessionId: "00000000-0000-0000-0000-000000000001",
  projectId: "00000000-0000-0000-0000-000000000002",
  memberId: "00000000-0000-0000-0000-000000000003",
  pmReviewId: "00000000-0000-0000-0000-000000000004",
  planningId: "00000000-0000-0000-0000-000000000005",
  releasePlanningId: "00000000-0000-0000-0000-000000000006",
  workspacePath: "/tmp/acu-smoke",
  routeProjectId: "00000000-0000-0000-0000-000000000007",
  routeSprintId: "00000000-0000-0000-0000-000000000008",
};
const minimalCtx: ToolContext = {
  sessionId: null,
  projectId: "00000000-0000-0000-0000-000000000002",
};

function isTool(t: unknown): boolean {
  return (
    !!t &&
    typeof t === "object" &&
    (typeof (t as { execute?: unknown }).execute === "function" ||
      "inputSchema" in (t as object) ||
      "parameters" in (t as object))
  );
}

const descriptors = Object.values(TOOL_REGISTRY);
const smokeFails: string[] = [];
const overFails: string[] = [];
const underFails: string[] = [];

for (const d of descriptors) {
  // B. bind-smoke com ctx completo
  try {
    if (!isTool(d.bind(fullCtx))) smokeFails.push(`${d.name}: não devolveu Tool`);
  } catch (e) {
    smokeFails.push(`${d.name}: throw → ${e instanceof Error ? e.message : String(e)}`);
  }
  // C. needs over-declared (zerar need → throw)
  overFails.push(...findNeedsBindMismatch(d, fullCtx));
  // D. needs under-declared (needs:[] → buila com ctx mínimo)
  if (d.needs.length === 0) {
    try {
      d.bind(minimalCtx);
    } catch (e) {
      underFails.push(
        `${d.name}: needs:[] mas bind deu throw com ctx mínimo → ${e instanceof Error ? e.message : String(e)} (need não declarado?)`,
      );
    }
  }
}

assert.equal(smokeFails.length, 0, `B. bind-smoke falhou:\n  ${smokeFails.join("\n  ")}`);
console.log(`✓ B. bind-smoke verde — ${descriptors.length} binds devolvem Tool com ctx completo`);
assert.equal(overFails.length, 0, `C. needs over-declared:\n  ${overFails.join("\n  ")}`);
console.log("✓ C. needs↔bind — todo need declarado realmente gateia o bind");
assert.equal(underFails.length, 0, `D. needs under-declared:\n  ${underFails.join("\n  ")}`);
console.log("✓ D. needs↔bind — nenhum need escondido (needs:[] buila com ctx mínimo)");

console.log("\n✅ agent-surface harness OK");
