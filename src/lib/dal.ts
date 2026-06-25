import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { db } from "./db";
import {
  hasMinLevel,
  ADMIN,
  MANAGER,
  BUILDER,
  GUEST,
  resolveAccessLevel,
  hasMinAccessLevel,
  type AccessLevel,
} from "./roles";

const NUMERIC_TO_ACCESS_LEVEL: Record<number, AccessLevel> = {
  [GUEST]: "guest",
  [BUILDER]: "builder",
  [MANAGER]: "manager",
  [ADMIN]: "admin",
};

function numericToAccessLevel(level: number): AccessLevel {
  return NUMERIC_TO_ACCESS_LEVEL[level] ?? "guest";
}
import type { Member } from "./supabase/types";

const IMPERSONATION_COOKIE = "volund_impersonate";

/**
 * Minimal user shape returned when the proxy already validated the JWT.
 * Avoids the ~300ms HTTP call to Supabase.
 */
type ProxyUser = {
  id: string;
  email: string | null;
  app_metadata: { role?: string; access_level?: string };
};

/**
 * Read user identity from headers injected by proxy.ts.
 * Returns null if the proxy didn't inject them (shouldn't happen with current matcher).
 */
const getUserFromHeaders = cache(async (): Promise<ProxyUser | null> => {
  const h = await headers();
  const id = h.get("x-user-id");
  if (!id) return null;
  return {
    id,
    email: h.get("x-user-email") || null,
    app_metadata: {
      role: h.get("x-user-role") || undefined,
      access_level: h.get("x-user-access-level") || undefined,
    },
  };
});

/**
 * Returns the authenticated Supabase user, or redirects to /login.
 * Reads from proxy headers first (~0ms), falls back to Supabase HTTP if missing.
 * Cached per request.
 */
export const verifySession = cache(async () => {
  // Fast path: proxy already validated the JWT
  const proxyUser = await getUserFromHeaders();
  if (proxyUser) return proxyUser;

  // Fallback: direct Supabase validation (should rarely happen)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  return user;
});

/**
 * Same as verifySession, but returns null instead of redirecting.
 * Use this in route handlers where you want to return 401 yourself.
 */
export const getUser = cache(async () => {
  // Fast path: proxy already validated the JWT
  const proxyUser = await getUserFromHeaders();
  if (proxyUser) return proxyUser;

  // Fallback: direct Supabase validation
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * @deprecated Use `getAccessLevel()` for authz, or read `position` from
 * Member for cargo. The legacy `role` mixed both axes.
 *
 * The role used for authorization decisions, sourced from auth.users.app_metadata.
 * NEVER use user_metadata for authz — it's user-editable.
 * Falls back to null if missing (treat as "no role" / forbidden).
 */
export const getRealRole = cache(async (): Promise<string | null> => {
  const user = await verifySession();
  const role = user.app_metadata?.role;
  return typeof role === "string" ? role : null;
});

/**
 * Real access level of the authenticated user, sourced from
 * `auth.users.app_metadata.access_level`. While JWTs are still rotating after
 * the migration, falls back to `mapPositionToAccessLevel(role)` so older
 * sessions keep working. Use this for authorization decisions.
 */
export const getAccessLevel = cache(async (): Promise<AccessLevel> => {
  const user = await verifySession();
  return resolveAccessLevel(
    user.app_metadata?.access_level,
    user.app_metadata?.role,
  );
});

export type CurrentMember = Member & {
  /** When set, the request is being impersonated by this admin's auth user id. */
  _impersonatedBy?: string;
};

/**
 * Returns the Member row for the current request, honoring impersonation.
 * - Real user: Member where userId = auth.user.id
 * - Admin (head-ops/ceo) with `volund_impersonate` cookie: that Member instead
 *
 * Returns null if the user has no linked Member (shouldn't happen post-invite,
 * but possible during bootstrap).
 */
export const getCurrentMember = cache(
  async (): Promise<CurrentMember | null> => {
    const user = await verifySession();
    const realRole = await getRealRole();

    // Read impersonation from proxy header (avoids cookies() which blocks Suspense)
    const h = await headers();
    const impersonatedId = h.get("x-impersonate-id") || undefined;
    const isAdmin = hasMinLevel(realRole, ADMIN);

    if (impersonatedId && isAdmin) {
      const { data: impersonated } = await db()
        .from("Member")
        .select("*")
        .eq("id", impersonatedId)
        .maybeSingle();
      if (impersonated) {
        return { ...impersonated, _impersonatedBy: user.id };
      }
    }

    const { data: member } = await db()
      .from("Member")
      .select("*")
      .eq("userId", user.id)
      .maybeSingle();
    return member;
  },
);

/**
 * The role used for UI visibility and read-route gating. Reflects impersonation:
 *   - Non-admin user: always their real role
 *   - Admin not impersonating: their real role
 *   - Admin impersonating: the impersonated member's role
 *
 * Use this (not `getRealRole`) to decide what menus/pages a user should see.
 * For mutations, keep using `getRealRole` / `requireRole` so admins keep their
 * powers while impersonating.
 */
export const getEffectiveRole = cache(async (): Promise<string | null> => {
  const realRole = await getRealRole();
  const member = await getCurrentMember();
  if (member?._impersonatedBy) return member.role;
  return realRole;
});

/**
 * Access level used for UI visibility / read-route gating, honoring impersonation:
 *   - Real user / not impersonating: real `access_level` from JWT.
 *   - Admin impersonating: the impersonated user's real `access_level`
 *     (looked up from `auth.users.app_metadata.access_level` via admin client).
 *
 * Use this for UI/menu/page visibility. For mutation gates that should keep
 * admin powers during impersonation, use `getAccessLevel()` (real) instead.
 */
export const getEffectiveAccessLevel = cache(async (): Promise<AccessLevel> => {
  const real = await getAccessLevel();
  const member = await getCurrentMember();
  if (!member?._impersonatedBy || !member.userId) return real;

  // Look up the impersonated user's access_level from auth.users.
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(member.userId);
  if (error || !data?.user) {
    // Fallback to deriving from member.role/position if the lookup fails.
    return resolveAccessLevel(undefined, member.role);
  }
  return resolveAccessLevel(
    (data.user.app_metadata as { access_level?: string } | null)?.access_level,
    (data.user.app_metadata as { role?: string } | null)?.role,
  );
});

/**
 * Guard for pages/layouts: redirects to /profile if the effective role does
 * not meet the given minimum level. Use in server components / layouts to
 * gate entire route subtrees.
 *
 * Example:
 *   // src/app/(dashboard)/tasks/layout.tsx
 *   import { requireMinLevel } from "@/lib/dal";
 *   import { MANAGER } from "@/lib/roles";
 *   export default async function TasksLayout({ children }) {
 *     await requireMinLevel(MANAGER);
 *     return children;
 *   }
 */
export async function requireMinLevel(
  level: number,
  opts?: { redirectTo?: string },
): Promise<void> {
  const effective = await getEffectiveAccessLevel();
  if (!hasMinAccessLevel(effective, numericToAccessLevel(level))) {
    redirect(opts?.redirectTo ?? "/profile");
  }
}

/**
 * Throws (via redirect or 403) if the current user's real role is not in `roles`.
 * Use in Route Handlers and Server Actions for role-gated mutations.
 *
 * Note: checks the *real* role, not the impersonated one, so admins keep their
 * powers while impersonating.
 */
export async function requireRole(roles: string[]): Promise<void> {
  const realRole = await getRealRole();
  if (!realRole || !roles.includes(realRole)) {
    throw new ForbiddenError(
      `Required role: ${roles.join(" | ")}; got: ${realRole ?? "none"}`,
    );
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Helper to wrap a route handler body with auth + standard error handling.
 * Returns 401 if not authenticated, 403 if ForbiddenError thrown.
 */
export async function withAuth<T extends Response>(
  handler: () => Promise<T>,
): Promise<Response> {
  try {
    const user = await getUser();
    if (!user) return new Response("Unauthorized", { status: 401 });
    return await handler();
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return new Response(e.message, { status: 403 });
    }
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════
// Member id + project access helpers
//
// Visibility (and edit permission) is sourced from ProjectAccess,
// the single source of truth. ProjectMember now exclusively models
// PFV allocation; it's no longer a visibility gate.
//
// Impersonation note:
//   - getMemberId / verifySession / getRealRole → REAL user.
//     Use for admin-only gates (e.g., requireMinLevelApi) so admins
//     can stop impersonating + reach admin routes.
//   - getActorMemberId / getActorUserId / getEffectiveRole → IMPERSONATED
//     when applicable, otherwise real. Use for visibility / data fetching
//     so admins see exactly what the impersonated member sees.
// ═══════════════════════════════════════════════════════════

/**
 * Current user's Member.id, read from the header proxy.ts injects from
 * auth.users.app_metadata.member_id. Zero DB calls.
 * Returns null for users without a linked Member (e.g., guests).
 */
export const getMemberId = cache(async (): Promise<string | null> => {
  const h = await headers();
  const id = h.get("x-member-id");
  return id && id.length > 0 ? id : null;
});

/**
 * Member.id of the *acting* user, honoring impersonation.
 *   - Admin impersonating: impersonated Member.id
 *   - Otherwise: real user's Member.id (same as getMemberId)
 */
export const getActorMemberId = cache(async (): Promise<string | null> => {
  const member = await getCurrentMember();
  if (member?._impersonatedBy) return member.id;
  return getMemberId();
});

/**
 * auth.users.id of the *acting* user, honoring impersonation.
 *   - Admin impersonating: impersonated Member.userId
 *   - Otherwise: real auth user id
 */
export const getActorUserId = cache(async (): Promise<string | null> => {
  const member = await getCurrentMember();
  if (member?._impersonatedBy && member.userId) return member.userId;
  const user = await getUser();
  return user?.id ?? null;
});

type ProjectAccessRole =
  | "viewer"
  | "session_participant"
  | "contributor"
  | "lead";

/**
 * All ProjectAccess rows for the current user. One row per (userId, projectId).
 * Cached per request via React.cache.
 */
export const getProjectAccessList = cache(
  async (): Promise<{ projectId: string; role: ProjectAccessRole }[]> => {
    const userId = await getActorUserId();
    if (!userId) return [];
    const { data } = await db()
      .from("ProjectAccess")
      .select("projectId, role")
      .eq("userId", userId);
    return (data ?? []) as { projectId: string; role: ProjectAccessRole }[];
  },
);

/** Project ids the current user can view (from ProjectAccess). */
export const getAccessibleProjectIds = cache(async (): Promise<string[]> => {
  const list = await getProjectAccessList();
  return list.map((r) => r.projectId);
});

/**
 * Active capability grants (overrides) for the *acting* user — the net-new
 * third authz axis (MemberAccessGrant). Só linhas ativas (revokedAt IS NULL).
 * Catálogo de capabilityKey vive em src/lib/access/capabilities.ts.
 * Cached per request. Honra impersonation via getActorUserId.
 */
export const getAccessGrantList = cache(
  async (): Promise<{ capabilityKey: string; projectId: string | null }[]> => {
    const userId = await getActorUserId();
    if (!userId) return [];
    const { data } = await db()
      .from("MemberAccessGrant")
      .select("capabilityKey, projectId")
      .eq("userId", userId)
      .is("revokedAt", null);
    return (data ?? []) as {
      capabilityKey: string;
      projectId: string | null;
    }[];
  },
);

/**
 * Project ids alcançáveis SÓ via grant (sem ProjectAccess). Mantido SEPARADO
 * de getAccessibleProjectIds de propósito: um grant confere alcance VIEW-level
 * (visibilidade do projeto + ler/chat no ritual concedido), NÃO o alcance
 * edit-level que getAccessibleProjectIds implica (canEditSessions / listagem
 * de design sessions). Misturar vazaria escrita além do ritual concedido.
 */
export const getGrantedProjectIds = cache(async (): Promise<string[]> => {
  const grants = await getAccessGrantList();
  return [
    ...new Set(
      grants.map((g) => g.projectId).filter((p): p is string => p !== null),
    ),
  ];
});

/**
 * True iff o usuário ACTING tem grant ativo de `capabilityKey` (opcionalmente
 * escopado a `projectId`; grant global — projectId null — casa qualquer projeto).
 * Espelha o SQL has_access_grant().
 */
export async function hasAccessGrant(
  capabilityKey: string,
  projectId?: string,
): Promise<boolean> {
  const grants = await getAccessGrantList();
  return grants.some(
    (g) =>
      g.capabilityKey === capabilityKey &&
      (projectId === undefined ||
        g.projectId === projectId ||
        g.projectId === null),
  );
}

/**
 * True iff the *acting* user can VIEW the project:
 *   - Manager (PM / head-ops / CEO / CRO): always yes
 *   - Anyone else: needs a ProjectAccess row (any role)
 *
 * Honors impersonation: admin impersonating a builder will be filtered
 * exactly like the impersonated member.
 */
export async function canViewProject(projectId: string): Promise<boolean> {
  const level = await getEffectiveAccessLevel();
  if (hasMinAccessLevel(level, "manager")) return true;
  const ids = await getAccessibleProjectIds();
  if (ids.includes(projectId)) return true;
  // Override: um grant de capability project-scoped destrava a visibilidade
  // mínima do projeto (espelho TS de can_view_project + has_any_project_grant).
  return (await getGrantedProjectIds()).includes(projectId);
}

/**
 * True iff the *acting* user can EDIT TASKS in the project:
 *   - Manager: yes
 *   - Builder/guest: needs ProjectAccess.role IN (contributor, lead)
 */
export async function canEditTasks(projectId: string): Promise<boolean> {
  const level = await getEffectiveAccessLevel();
  if (hasMinAccessLevel(level, "manager")) return true;
  const list = await getProjectAccessList();
  const row = list.find((r) => r.projectId === projectId);
  return row?.role === "contributor" || row?.role === "lead";
}

/**
 * True iff the *acting* user can INTERACT with design sessions in the project.
 *   - Manager: yes
 *   - Guest: NÃO (read-only em DS pública; nunca edita) — Fase guest hardening.
 *   - Builder com ProjectAccess: yes (qualquer role)
 *
 * Espelha can_edit_session() em SQL pós migration 20260526_guest_access_hardening
 * — guest é bloqueado mesmo com ProjectAccess.
 */
export async function canEditSessions(projectId: string): Promise<boolean> {
  const level = await getEffectiveAccessLevel();
  if (hasMinAccessLevel(level, "manager")) return true;
  if (isGuest(level)) return false;
  const ids = await getAccessibleProjectIds();
  return ids.includes(projectId);
}

/**
 * True iff o *acting* user pode OPERAR o ritual de Planning do projeto — com
 * poder de PM, sem fricção (criar, editar metadados, anexar transcript, linkar
 * contexto, editar PRD, concluir/aplicar o plano).
 *   - Manager: yes
 *   - ProjectAccess contributor/lead: yes
 *   - Grant ativo de `ritual.planning` no projeto: yes (override — opera como PM
 *     SÓ no Planning; NÃO destrava as APIs de editar tasks/design sessions
 *     soltas, que continuam em canEditTasks/canEditSessions).
 *
 * Por que um guard dedicado: as rotas do Planning rodam via service-role (db()),
 * gated por TS. Usar este guard (em vez de canEditTasks/canEditSessions, que são
 * compartilhados) confina o poder do grant ao ritual concedido.
 */
export async function canOperatePlanning(projectId: string): Promise<boolean> {
  const level = await getEffectiveAccessLevel();
  if (hasMinAccessLevel(level, "manager")) return true;
  if (await hasAccessGrant("ritual.planning", projectId)) return true;
  const list = await getProjectAccessList();
  const row = list.find((r) => r.projectId === projectId);
  return row?.role === "contributor" || row?.role === "lead";
}

/** True se o nível efetivo é guest. Helper p/ filtros de visibility e PFV. */
export function isGuest(level: AccessLevel | null | undefined): boolean {
  return level === "guest";
}

/**
 * True iff guest viewer pode VER esta DS específica.
 *   - DS 'public' + ProjectAccess no projeto: yes
 *   - DS 'internal': nunca
 * Para não-guests, delega a `canViewProject`.
 */
export async function canViewDesignSession(
  session: { projectId: string; visibility: "public" | "internal" } | null,
): Promise<boolean> {
  if (!session) return false;
  const level = await getEffectiveAccessLevel();
  if (hasMinAccessLevel(level, "manager")) return true;
  if (!(await canViewProject(session.projectId))) return false;
  if (isGuest(level) && session.visibility !== "public") return false;
  return true;
}

/**
 * True iff o usuário pode mudar a visibility (public/internal) de uma DS.
 * Regra (espelho do SQL `can_change_session_visibility`):
 *   - admin/manager global: yes
 *   - ProjectAccess.role IN ('lead','contributor') no projeto: yes
 *   - resto (incl. guest): no
 */
export async function canChangeSessionVisibility(
  projectId: string,
): Promise<boolean> {
  const level = await getEffectiveAccessLevel();
  if (hasMinAccessLevel(level, "manager")) return true;
  if (isGuest(level)) return false;
  const list = await getProjectAccessList();
  const row = list.find((r) => r.projectId === projectId);
  return row?.role === "lead" || row?.role === "contributor";
}

/** @deprecated Use {@link canViewProject}. Kept for in-flight callers. */
export const isAllocatedTo = canViewProject;
/** @deprecated Use {@link getAccessibleProjectIds}. */
export const getAllocatedProjectIds = getAccessibleProjectIds;

/**
 * @deprecated Use `requireMinAccessLevelApi(level)` with an `AccessLevel` string.
 *
 * Route Handler guard. Returns a Response to return from the handler when the
 * caller is not authorized; returns null when OK to proceed.
 *
 *   const denied = await requireMinLevelApi(MANAGER);
 *   if (denied) return denied;
 */
export async function requireMinLevelApi(
  level: number,
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const accessLevel = await getAccessLevel();
  if (!hasMinAccessLevel(accessLevel, numericToAccessLevel(level))) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

/**
 * Route Handler guard. Same as `requireMinLevelApi` but uses the new
 * `AccessLevel` axis (read from `app_metadata.access_level`, with fallback
 * to legacy `role` while JWTs rotate).
 *
 *   const denied = await requireMinAccessLevelApi("manager");
 *   if (denied) return denied;
 */
export async function requireMinAccessLevelApi(
  min: AccessLevel,
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const level = await getAccessLevel();
  if (!hasMinAccessLevel(level, min)) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

/** Route Handler guard: caller can VIEW the project. 401/403 or null. */
export async function requireProjectViewApi(
  projectId: string,
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (await canViewProject(projectId)) return null;
  return new Response("Forbidden — no access to this project", { status: 403 });
}

/** Route Handler guard: caller can EDIT TASKS in the project. 401/403 or null. */
export async function requireProjectEditTasksApi(
  projectId: string,
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (await canEditTasks(projectId)) return null;
  return new Response("Forbidden — cannot edit tasks in this project", {
    status: 403,
  });
}

/**
 * Route Handler guard: caller can COMMENT on tasks in the project.
 * Mais permissivo que `requireProjectEditTasksApi` — qualquer ProjectAccess
 * (incl. viewer/guest) pode comentar. Espelha a regra "guest deixa comentário".
 */
export async function requireProjectCommentApi(
  projectId: string,
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (await canViewProject(projectId)) return null;
  return new Response("Forbidden — no access to this project", { status: 403 });
}

/** Route Handler guard: caller can EDIT DESIGN SESSIONS in the project. 401/403 or null. */
export async function requireProjectEditSessionsApi(
  projectId: string,
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (await canEditSessions(projectId)) return null;
  return new Response("Forbidden — cannot edit sessions in this project", {
    status: 403,
  });
}

/**
 * Route Handler guard: caller can OPERATE the Planning ritual (PM-equivalente,
 * grant-aware). Use nas rotas de ESCRITA/operação do Planning (criar, editar,
 * concluir, anexar) — confina o poder do grant de ritual.planning ao Planning.
 */
export async function requirePlanningOperateApi(
  projectId: string,
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (await canOperatePlanning(projectId)) return null;
  return new Response("Forbidden — cannot operate planning in this project", {
    status: 403,
  });
}

/** @deprecated Tasks-mutation guard. Use {@link requireProjectEditTasksApi}. */
export const requireProjectMemberApi = requireProjectEditTasksApi;

// ═══════════════════════════════════════════════════════════
// Meeting visibility (mirror of can_view_meeting RLS in DB)
//
// API routes use db() = service_role, which bypasses RLS, so
// these helpers re-implement the rule for app-layer filtering.
// ═══════════════════════════════════════════════════════════

type MeetingVisibilityCtx = {
  /** Eixo de acesso. `type` permanece só como rótulo legado (não governa). */
  visibility: string;
  attendeeMemberIds: string[];
  linkedProjectPmIds: string[];
  createdById?: string | null;
};

/**
 * Mirror of public.can_view_meeting(meetingId) — agora governado por
 * VISIBILITY (não mais por type). Dado a visibilidade da reunião, seus
 * attendees, e os pmIds dos projetos linkados, decide se o caller (acting) vê.
 *
 *   - private: SÓ o creator. Admin NÃO vê (privada é privada).
 *   - public:  admin vê tudo; senão, quem participou (attendee) OU é PM
 *              de um projeto linkado (cerimônias legadas como Meeting).
 *
 * Builder visibility is intentional: builder adicionado como attendee numa
 * reunião pública tem leitura. Honors impersonation: admin impersonando PM
 * Pedro é filtrado exatamente como Pedro.
 */
export async function canViewMeeting(
  ctx: MeetingVisibilityCtx,
): Promise<boolean> {
  const memberId = await getActorMemberId();

  if (ctx.visibility === "private") {
    // Sem admin bypass — só quem criou vê.
    return !!memberId && !!ctx.createdById && ctx.createdById === memberId;
  }

  // public
  const level = await getEffectiveAccessLevel();
  if (hasMinAccessLevel(level, "admin")) return true;
  if (!memberId) return false;
  return (
    ctx.attendeeMemberIds.includes(memberId) ||
    ctx.linkedProjectPmIds.includes(memberId)
  );
}

/**
 * Mirror of public.can_edit_meeting — admin OR creator (acting).
 */
export async function canEditMeeting(
  createdById: string | null,
): Promise<boolean> {
  const level = await getEffectiveAccessLevel();
  if (hasMinAccessLevel(level, "admin")) return true;
  if (!createdById) return false;
  const memberId = await getActorMemberId();
  return !!memberId && memberId === createdById;
}

async function lookupSession(
  sessionId: string,
): Promise<{ projectId: string; visibility: "public" | "internal" } | null> {
  const { data } = await db()
    .from("DesignSession")
    .select("projectId, visibility")
    .eq("id", sessionId)
    .maybeSingle();
  if (!data) return null;
  return {
    projectId: data.projectId as string,
    visibility: (data.visibility ?? "internal") as "public" | "internal",
  };
}

/** @deprecated retorna só projectId. Prefira `lookupSession`. */
async function lookupSessionProject(
  sessionId: string,
): Promise<string | null> {
  const s = await lookupSession(sessionId);
  return s?.projectId ?? null;
}

/**
 * Route Handler guard for DesignSession-scoped routes. Looks up the session's
 * projectId + visibility and gates access. Returns 401/403/404 or null.
 *   - Admin/manager: pass.
 *   - Guest: precisa de ProjectAccess no projeto E DS visibility='public'.
 *   - Builder com ProjectAccess: pass.
 */
export async function requireSessionAccessApi(
  sessionId: string,
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const level = await getEffectiveAccessLevel();
  if (hasMinAccessLevel(level, "manager")) return null;

  const session = await lookupSession(sessionId);
  if (!session) return new Response("Session not found", { status: 404 });

  if (await canViewDesignSession(session)) return null;
  return new Response("Forbidden — no access to this session", { status: 403 });
}

/**
 * Stricter session guard for mutations. Requires session_participant+ role
 * (or manager). Returns 401/403/404 or null.
 */
export async function requireSessionEditApi(
  sessionId: string,
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const level = await getEffectiveAccessLevel();
  if (hasMinAccessLevel(level, "manager")) return null;

  const projectId = await lookupSessionProject(sessionId);
  if (!projectId) return new Response("Session not found", { status: 404 });

  if (await canEditSessions(projectId)) return null;
  return new Response("Forbidden — cannot edit this session", { status: 403 });
}
