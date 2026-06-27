/**
 * Decisão de autorização — núcleo PURO (sem IO, sem server-only).
 *
 * Separado de require-capability.ts de propósito: aqui não há `import
 * "server-only"` nem acesso a DB, então a regra é testável em isolamento
 * (scripts/access/catalog-matrix.test.ts) e reutilizável (ex.: preview do
 * "acesso efetivo" no app Acessos — I8).
 *
 * Ordem (primeiro que casar PERMITE): managerBypass → globalMin → grant → projectMin.
 */
import { hasMinAccessLevel, type AccessLevel, type ProjectAccessRole } from "@/lib/roles";
import { PROJECT_ROLE_RANK, type AuthzRule } from "./authz-catalog";

/** Sentinela: qualquer grant project-scoped destrava (espelha canViewProject). */
export const ANY_PROJECT_GRANT = "__any_project_grant__";

export type AuthzContext = {
  /** access_level efetivo (honra impersonation a montante). */
  level: AccessLevel;
  /** role do ator NO projeto alvo (só relevante p/ não-managers). */
  projectRole?: ProjectAccessRole | null;
  /** grants ativos do ator (MemberAccessGrant). */
  grants?: { capabilityKey: string; projectId: string | null }[];
  /** projeto alvo, quando a capability é project-scoped. */
  projectId?: string;
};

export function decideCapability(rule: AuthzRule, ctx: AuthzContext): boolean {
  // 1. manager/admin global (P2)
  if (rule.managerBypass !== false && hasMinAccessLevel(ctx.level, "manager")) {
    return true;
  }
  // 2. piso global (ex.: admin-only)
  if (rule.globalMin && hasMinAccessLevel(ctx.level, rule.globalMin)) return true;

  // 3. override por grant (P4)
  if (rule.grantKey) {
    const grants = ctx.grants ?? [];
    if (rule.grantKey === ANY_PROJECT_GRANT) {
      if (
        ctx.projectId &&
        grants.some((g) => g.projectId === ctx.projectId || g.projectId === null)
      ) {
        return true;
      }
    } else if (
      grants.some(
        (g) =>
          g.capabilityKey === rule.grantKey &&
          (ctx.projectId === undefined ||
            g.projectId === ctx.projectId ||
            g.projectId === null),
      )
    ) {
      return true;
    }
  }

  // 4. graduação por-projeto — só NÃO-managers (P3); guest barrado se denyGuest
  if (
    rule.projectMin &&
    ctx.projectId &&
    !(rule.denyGuest && ctx.level === "guest")
  ) {
    const role = ctx.projectRole;
    if (role && PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[rule.projectMin]) {
      return true;
    }
  }

  return false;
}
