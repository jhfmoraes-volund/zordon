/**
 * Matriz de autorização — testa a decisão PURA (decideCapability) contra o
 * catálogo, por perfil. Não toca DB nem server. Roda via tsx:
 *   npm run authz:matrix
 *
 * Cobre os formatos de regra: admin-only, manager+, contributor+ project-scoped,
 * grant override, denyGuest, e o sentinela ANY_PROJECT_GRANT.
 * Invariante de segurança central: guest-sem-nada é negado em TUDO.
 */
import { decideCapability, type AuthzContext } from "@/lib/access/decide";
import { AUTHZ_CATALOG, getRule } from "@/lib/access/authz-catalog";

const ctx: Record<string, AuthzContext> = {
  admin: { level: "admin" },
  manager: { level: "manager" },
  builderNo: { level: "builder" },
  builderContrib: { level: "builder", projectRole: "contributor", projectId: "P" },
  builderViewer: { level: "builder", projectRole: "viewer", projectId: "P" },
  guest: { level: "guest" },
  guestContribProj: { level: "guest", projectRole: "contributor", projectId: "P" },
  guestGrantPmReview: { level: "guest", projectId: "P", grants: [{ capabilityKey: "ritual.pm_review", projectId: "P" }] },
  builderGrantPlanning: { level: "builder", projectId: "P", grants: [{ capabilityKey: "ritual.planning", projectId: "P" }] },
  builderGrantFinance: { level: "builder", grants: [{ capabilityKey: "app.finance", projectId: null }] },
  builderAnyGrant: { level: "builder", projectId: "P", grants: [{ capabilityKey: "qualquer", projectId: "P" }] },
};

type Case = [cap: string, ctxName: keyof typeof ctx, expected: boolean];
const cases: Case[] = [
  // admin-only (estrutura): nem manager passa
  ["project.create", "admin", true], ["project.create", "manager", false], ["project.create", "builderNo", false], ["project.create", "guest", false],
  ["project.edit", "admin", true], ["project.edit", "manager", false],
  ["project.delete", "manager", false], ["project.delete", "admin", true],
  ["squad.write", "manager", false], ["squad.write", "admin", true],
  ["access_grant.manage", "manager", false], ["access_grant.manage", "admin", true],
  // manager+
  ["opportunity.write", "manager", true], ["opportunity.write", "builderNo", false], ["opportunity.write", "guest", false], ["opportunity.write", "admin", true],
  ["member.write", "manager", true], ["member.write", "builderNo", false],
  ["client.write", "manager", true], ["client.write", "builderNo", false],
  // contributor+ project-scoped
  ["sprint.write", "manager", true], ["sprint.write", "builderContrib", true], ["sprint.write", "builderViewer", false], ["sprint.write", "guest", false], ["sprint.write", "builderNo", false],
  ["task.edit", "builderContrib", true], ["task.edit", "builderViewer", false], ["task.edit", "guest", false],
  ["sprint.delete", "manager", true], ["sprint.delete", "builderContrib", false], // delete = manager-only
  // grant overrides
  ["pm_review.write", "manager", true], ["pm_review.write", "guest", false], ["pm_review.write", "guestGrantPmReview", true],
  ["ritual.planning", "builderContrib", true], ["ritual.planning", "builderGrantPlanning", true], ["ritual.planning", "guest", false],
  ["finance.access", "admin", true], ["finance.access", "manager", false], ["finance.access", "builderGrantFinance", true], ["finance.access", "builderNo", false],
  // denyGuest: guest com role no projeto AINDA é negado
  ["session.edit", "manager", true], ["session.edit", "builderContrib", true], ["session.edit", "guestContribProj", false],
  // viewer+ / ANY_PROJECT_GRANT
  ["project.view", "builderViewer", true], ["project.view", "builderAnyGrant", true], ["project.view", "guest", false],
];

let pass = 0, fail = 0;
const fails: string[] = [];
for (const [cap, ctxName, expected] of cases) {
  const rule = getRule(cap);
  if (!rule) { fail++; fails.push(`${cap}: NÃO existe no catálogo`); continue; }
  const got = decideCapability(rule, ctx[ctxName]);
  if (got === expected) pass++;
  else { fail++; fails.push(`${cap} × ${ctxName}: esperava ${expected}, veio ${got}`); }
}

// Invariante de segurança: guest-sem-nada negado em TODA capability
for (const cap of Object.keys(AUTHZ_CATALOG)) {
  const got = decideCapability(getRule(cap)!, ctx.guest);
  if (got === false) pass++;
  else { fail++; fails.push(`INVARIANTE: guest-sem-nada passou em "${cap}" (deveria negar)`); }
}

console.log(`Matriz de autorização: ${pass} PASS · ${fail} FAIL  (${Object.keys(AUTHZ_CATALOG).length} caps no catálogo)`);
if (fails.length) { console.log("\nFALHAS:"); fails.forEach((f) => console.log("  ‼", f)); }
process.exit(fail ? 1 : 0);
