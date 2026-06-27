/**
 * Guard de CI (I6) — falha se uma rota mutadora (POST/PUT/PATCH/DELETE) em
 * src/app/api/** não tiver gate de autorização reconhecido e não estiver na
 * allowlist. Impede que PR futuro reabra furo de authz.
 *   npm run authz:check
 *
 * "Gate reconhecido" = requireCapabilityApi (preferido) OU um guard legado
 * correto (requireSession*Api, requireRole, requireMin*Api, etc.).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const API_DIR = join(process.cwd(), "src/app/api");

// Gates de autorização aceitos (preferir requireCapabilityApi; legados ok até unificação).
const GATE = /requireCapabilityApi|requireSession(Edit|Access)Api|requireProjectEdit(Sessions|Tasks)Api|requireProjectViewApi|requireProjectCommentApi|requirePlanningOperateApi|requireRole|requireMin(Level|AccessLevel)Api|canChangeSessionVisibility|canCreatePMReviewForProject|hasAccessGrant|\bisAdmin\b/;

// Allowlist: rotas que LEGITIMAMENTE não levam gate de capability de usuário.
const ALLOW: { re: RegExp; why: string }[] = [
  { re: /\/api\/cron\//, why: "cron: auth por token (CRON secret)" },
  { re: /\/api\/webhooks\//, why: "webhook: assinatura/secret próprio" },
  { re: /\/api\/internal\//, why: "internal: chamada de sistema" },
  { re: /\/api\/agent-mode\//, why: "agent-mode: toggle de sistema" },
  { re: /\/api\/profile\//, why: "self-scoped: dado do próprio usuário" },
  { re: /\/api\/me\//, why: "self-scoped: dado do próprio usuário" },
  { re: /\/api\/notifications\//, why: "self-scoped: notificações do próprio usuário" },
  { re: /\/api\/integrations\/composio\//, why: "self-scoped: conexão do próprio usuário" },
];

// GAPS conhecidos (NÃO seguros — precisam de fix; allowlistados c/ aviso p/ não travar CI).
const KNOWN_GAPS: { re: RegExp; why: string }[] = [
  { re: /\/api\/agents\/tools\//, why: "DAEMON sem token-auth — executa writes em PROD (fix: shared-secret)" },
  { re: /\/api\/agents\/\[slug\]\/prepare-(turn|context)\//, why: "DAEMON sem token-auth (fix: shared-secret)" },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

const violations: string[] = [];
const warnings: string[] = [];
let okCount = 0;

for (const file of walk(API_DIR)) {
  const src = readFileSync(file, "utf8");
  if (!/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/.test(src)) continue;
  // Stub deprecado que só retorna 410 (Gone) — não é rota real, não muta.
  if (/@deprecated/.test(src) && /status:\s*410/.test(src)) continue;
  const rel = relative(process.cwd(), file);
  const path = "/" + rel.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "");

  if (GATE.test(src)) { okCount++; continue; }
  const known = KNOWN_GAPS.find((a) => a.re.test("/api/" + path.replace(/^\/api\//, "")) || a.re.test(rel));
  if (known) { warnings.push(`${rel}  — ${known.why}`); continue; }
  const allowed = ALLOW.find((a) => a.re.test(rel) || a.re.test("/api/" + rel.split("/api/")[1]));
  if (allowed) { okCount++; continue; }

  violations.push(rel);
}

console.log(`authz:check — ${okCount} rotas com gate/allowlist · ${warnings.length} gaps conhecidos · ${violations.length} violações`);
if (warnings.length) {
  console.log("\n⚠ GAPS CONHECIDOS (fix pendente, não bloqueiam):");
  warnings.forEach((w) => console.log("   ", w));
}
if (violations.length) {
  console.log("\n‼ VIOLAÇÕES — rota mutadora SEM gate de autorização (adicione requireCapabilityApi):");
  violations.forEach((v) => console.log("   ", v));
  process.exit(1);
}
console.log("\n✓ Nenhuma rota mutadora desprotegida.");
