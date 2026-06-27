/**
 * Gate ÚNICO de autorização — interpreta o AUTHZ_CATALOG.
 *
 * Toda rota mutadora chama `requireCapabilityApi(key, { projectId })`. É o
 * único ponto onde a regra de "quem pode" é resolvida no app-layer (a barreira
 * real, já que `db()` = service_role bypassa RLS — docs/platform/authz-*.md).
 *
 *   const denied = await requireCapabilityApi("project.delete", { projectId });
 *   if (denied) return denied;
 *
 * Ordem de resolução (primeiro que casar PERMITE):
 *   1. managerBypass  → manager/admin global (P2: PM opera tudo)
 *   2. globalMin      → piso de access_level (ex.: admin-only)
 *   3. grantKey       → MemberAccessGrant ativo (override pontual, P4)
 *   4. projectMin     → ProjectAccess.role no projeto (gradua não-managers, P3)
 */
import "server-only";
import {
  getUser,
  getEffectiveAccessLevel,
  getProjectAccessList,
  getAccessGrantList,
} from "@/lib/dal";
import { getRule } from "./authz-catalog";
import { decideCapability } from "./decide";

/** Resolve se o usuário ACTING pode executar a capability (honra impersonation). */
export async function canDo(
  capability: string,
  opts: { projectId?: string } = {},
): Promise<boolean> {
  const rule = getRule(capability);
  if (!rule) {
    throw new Error(
      `authz: capability desconhecida "${capability}" — declare em authz-catalog.ts`,
    );
  }
  const { projectId } = opts;
  const level = await getEffectiveAccessLevel();
  const grants = await getAccessGrantList();
  let projectRole = null;
  if (projectId) {
    const list = await getProjectAccessList();
    projectRole = list.find((r) => r.projectId === projectId)?.role ?? null;
  }
  return decideCapability(rule, { level, projectRole, grants, projectId });
}

/**
 * Route Handler guard. Retorna uma Response (401/403) pra retornar do handler,
 * ou null quando autorizado. Mesmo contrato de `requireMinAccessLevelApi`.
 */
export async function requireCapabilityApi(
  capability: string,
  opts: { projectId?: string } = {},
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (await canDo(capability, opts)) return null;
  return new Response(`Forbidden — sem permissão para "${capability}"`, {
    status: 403,
  });
}
