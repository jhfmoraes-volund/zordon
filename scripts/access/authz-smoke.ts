/**
 * Smoke test de autorização — valida o boundary de NEGAÇÃO das rotas gateadas.
 *
 * Por que só negação: um 403 acontece ANTES de qualquer mutação, então o teste
 * é 100% seguro contra o banco (não cria/edita/deleta nada). O caminho de
 * PERMISSÃO (manager/admin consegue) deve ser verificado no app, pra não poluir
 * dados de PROD com requests de teste.
 *
 * Como rodar (com o dev server de pé):
 *   npm run dev                       # noutro terminal (localhost:3000)
 *   npx tsx scripts/access/authz-smoke.ts
 *   BASE_URL=https://staging... npx tsx scripts/access/authz-smoke.ts
 *   npx tsx scripts/access/authz-smoke.ts --cleanup   # remove os users de teste
 *
 * Cria 4 users idempotentes em auth.users: authz-smoke-{guest,builder,manager,admin}@volund.test
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── env ───────────────────────────────────────────────────────────────────
function loadEnv(): Record<string, string> {
  const txt = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  const out: Record<string, string> = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
if (!SUPABASE_URL || !ANON || !SERVICE) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY no .env");
  process.exit(1);
}

const PASSWORD = "authz-smoke-Pw!2026";
const PROFILES = ["guest", "builder", "manager", "admin"] as const;
type Profile = (typeof PROFILES)[number];
const emailFor = (p: Profile) => `authz-smoke-${p}@volund.test`;

// ─── Supabase admin (service_role) helpers via REST ──────────────────────────
const adminHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };

async function findUser(email: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: adminHeaders });
  const j = await r.json();
  const u = (j.users ?? []).find((x: { email?: string }) => x.email === email);
  return u?.id ?? null;
}
async function ensureUser(p: Profile): Promise<void> {
  const email = emailFor(p);
  const app_metadata = { access_level: p }; // guest|builder|manager|admin
  const existing = await findUser(email);
  if (existing) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existing}`, {
      method: "PUT", headers: adminHeaders,
      body: JSON.stringify({ password: PASSWORD, app_metadata, email_confirm: true }),
    });
  } else {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers: adminHeaders,
      body: JSON.stringify({ email, password: PASSWORD, app_metadata, email_confirm: true }),
    });
  }
}
async function deleteUser(p: Profile): Promise<void> {
  const id = await findUser(emailFor(p));
  if (id) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: adminHeaders });
}
async function signIn(p: Profile): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailFor(p), password: PASSWORD }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login falhou p/ ${p}: ${JSON.stringify(j)}`);
  return j.access_token;
}
async function sampleId(table: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, { headers: adminHeaders });
  const j = await r.json();
  return j?.[0]?.id ?? "00000000-0000-0000-0000-000000000000";
}

// ─── matriz de rotas (foco: NEGAÇÃO) ─────────────────────────────────────────
type Ids = Record<string, string>;
type Route = {
  cap: string; method: string; path: (ids: Ids) => string; body?: unknown;
  deny: Profile[]; // perfis que DEVEM receber 403
};
function buildRoutes(ids: Ids): Route[] {
  return [
    // admin-only (estrutura): manager TAMBÉM é negado
    { cap: "project.create", method: "POST", path: () => `/api/projects`, body: {}, deny: ["guest", "builder", "manager"] },
    { cap: "project.edit", method: "PUT", path: (i) => `/api/projects/${i.project}`, body: {}, deny: ["guest", "builder", "manager"] },
    { cap: "project.delete", method: "DELETE", path: (i) => `/api/projects/${i.project}`, deny: ["guest", "builder", "manager"] },
    { cap: "squad.write", method: "POST", path: () => `/api/squads`, body: {}, deny: ["guest", "builder", "manager"] },
    { cap: "squad.write", method: "DELETE", path: (i) => `/api/squads/${i.squad}`, deny: ["guest", "builder", "manager"] },
    { cap: "member.write(create)", method: "POST", path: () => `/api/members`, body: {}, deny: ["guest", "builder", "manager"] },
    { cap: "finance.access", method: "POST", path: () => `/api/finance/entries`, body: {}, deny: ["guest", "builder"] },
    { cap: "finance.access", method: "DELETE", path: (i) => `/api/finance/contract/${i.contract ?? "x"}`, deny: ["guest", "builder"] },
    // manager+ : builder e guest negados
    { cap: "opportunity.write", method: "POST", path: (i) => `/api/clients/${i.client}/opportunities`, body: {}, deny: ["guest", "builder"] },
    { cap: "client.write", method: "POST", path: () => `/api/clients`, body: {}, deny: ["guest", "builder"] },
    { cap: "prd.write", method: "POST", path: () => `/api/sessions/prd/approve`, body: {}, deny: ["guest", "builder"] },
    // contributor+ project-scoped : guest e builder-sem-acesso negados (manager passa por bypass)
    { cap: "sprint.write(create)", method: "POST", path: () => `/api/sprints`, body: { projectId: ids.project }, deny: ["guest", "builder"] },
    { cap: "sprint.write(complete)", method: "POST", path: (i) => `/api/sprints/${i.sprint}/complete`, body: {}, deny: ["guest", "builder"] },
    { cap: "sprint.delete", method: "DELETE", path: (i) => `/api/sprints/${i.sprint}`, deny: ["guest", "builder"] },
    { cap: "task.edit", method: "POST", path: () => `/api/tasks`, body: {}, deny: ["guest", "builder"] },
    { cap: "pm_review.write", method: "POST", path: () => `/api/pm-review`, body: { projectId: ids.project }, deny: ["guest", "builder"] },
    { cap: "ritual.planning", method: "POST", path: () => `/api/planning-sessions`, body: { projectId: ids.project }, deny: ["guest", "builder"] },
    { cap: "access_grant.manage", method: "POST", path: () => `/api/access-grants`, body: {}, deny: ["guest", "builder", "manager"] },
  ];
}

// ─── run ─────────────────────────────────────────────────────────────────────
async function main() {
  if (process.argv.includes("--cleanup")) {
    for (const p of PROFILES) await deleteUser(p);
    console.log("Users de teste removidos.");
    return;
  }
  console.log(`→ alvo: ${BASE_URL}\n→ preparando 4 users de teste...`);
  const tokens: Record<Profile, string> = {} as never;
  for (const p of PROFILES) { await ensureUser(p); tokens[p] = await signIn(p); }

  const ids: Ids = {
    project: await sampleId("Project"),
    client: await sampleId("Client"),
    sprint: await sampleId("Sprint"),
    squad: await sampleId("Squad"),
    contract: await sampleId("contract"),
  };
  const routes = buildRoutes(ids);

  let pass = 0, fail = 0;
  const fails: string[] = [];
  console.log(`\n${"CAP".padEnd(26)} ${"MÉTODO".padEnd(7)} PERFIL      STATUS  ESPERADO  RESULTADO`);
  console.log("─".repeat(78));
  for (const rt of routes) {
    for (const p of rt.deny) {
      let status = 0;
      try {
        const r = await fetch(`${BASE_URL}${rt.path(ids)}`, {
          method: rt.method,
          headers: { Authorization: `Bearer ${tokens[p]}`, "Content-Type": "application/json" },
          body: rt.body !== undefined ? JSON.stringify(rt.body) : undefined,
        });
        status = r.status;
      } catch (e) {
        fails.push(`${rt.cap} ${p}: erro de rede (server de pé em ${BASE_URL}?) ${(e as Error).message}`);
      }
      const ok = status === 403;
      if (ok) pass++; else { fail++; fails.push(`${rt.cap} [${rt.method}] perfil=${p}: esperava 403, veio ${status}`); }
      console.log(
        `${rt.cap.padEnd(26)} ${rt.method.padEnd(7)} ${p.padEnd(11)} ${String(status).padEnd(7)} 403       ${ok ? "PASS" : "‼ FAIL"}`,
      );
    }
  }
  console.log("─".repeat(78));
  console.log(`\nDENY boundary: ${pass} PASS · ${fail} FAIL`);
  if (fails.length) { console.log("\nFALHAS:"); fails.forEach((f) => console.log("  ‼", f)); }
  console.log(
    "\nNB: testa só NEGAÇÃO (seguro — 403 não muta). Caminho de PERMISSÃO (manager/admin) verifique no app.\n" +
    "Limpar users de teste: npx tsx scripts/access/authz-smoke.ts --cleanup",
  );
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
