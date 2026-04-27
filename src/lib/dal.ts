import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { db } from "./db";
import { hasMinLevel, ADMIN, MANAGER } from "./roles";
import type { Member } from "./supabase/types";

const IMPERSONATION_COOKIE = "volund_impersonate";

/**
 * Minimal user shape returned when the proxy already validated the JWT.
 * Avoids the ~300ms HTTP call to Supabase.
 */
type ProxyUser = {
  id: string;
  email: string | null;
  app_metadata: { role?: string };
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
    app_metadata: { role: h.get("x-user-role") || undefined },
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
 * The role used for authorization decisions, sourced from auth.users.app_metadata.
 * NEVER use user_metadata for authz — it's user-editable.
 * Falls back to null if missing (treat as "no role" / forbidden).
 */
export const getRealRole = cache(async (): Promise<string | null> => {
  const user = await verifySession();
  const role = user.app_metadata?.role;
  return typeof role === "string" ? role : null;
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
  const effective = await getEffectiveRole();
  if (!hasMinLevel(effective, level)) {
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
// FP allocation; it's no longer a visibility gate.
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
    const user = await getUser();
    if (!user) return [];
    const { data } = await db()
      .from("ProjectAccess")
      .select("projectId, role")
      .eq("userId", user.id);
    return (data ?? []) as { projectId: string; role: ProjectAccessRole }[];
  },
);

/** Project ids the current user can view (from ProjectAccess). */
export const getAccessibleProjectIds = cache(async (): Promise<string[]> => {
  const list = await getProjectAccessList();
  return list.map((r) => r.projectId);
});

/**
 * True iff the current user can VIEW the project:
 *   - Manager (PM / head-ops / CEO): always yes
 *   - Anyone else: needs a ProjectAccess row (any role)
 */
export async function canViewProject(projectId: string): Promise<boolean> {
  const realRole = await getRealRole();
  if (hasMinLevel(realRole, MANAGER)) return true;
  const ids = await getAccessibleProjectIds();
  return ids.includes(projectId);
}

/**
 * True iff the current user can EDIT TASKS in the project:
 *   - Manager: yes
 *   - Builder/guest: needs ProjectAccess.role IN (contributor, lead)
 */
export async function canEditTasks(projectId: string): Promise<boolean> {
  const realRole = await getRealRole();
  if (hasMinLevel(realRole, MANAGER)) return true;
  const list = await getProjectAccessList();
  const row = list.find((r) => r.projectId === projectId);
  return row?.role === "contributor" || row?.role === "lead";
}

/**
 * True iff the current user can EDIT DESIGN SESSIONS in the project:
 *   - Manager: yes
 *   - Builder/guest: needs ProjectAccess.role IN (session_participant, contributor, lead)
 */
export async function canEditSessions(projectId: string): Promise<boolean> {
  const realRole = await getRealRole();
  if (hasMinLevel(realRole, MANAGER)) return true;
  const list = await getProjectAccessList();
  const row = list.find((r) => r.projectId === projectId);
  return (
    row?.role === "session_participant" ||
    row?.role === "contributor" ||
    row?.role === "lead"
  );
}

/** @deprecated Use {@link canViewProject}. Kept for in-flight callers. */
export const isAllocatedTo = canViewProject;
/** @deprecated Use {@link getAccessibleProjectIds}. */
export const getAllocatedProjectIds = getAccessibleProjectIds;

/**
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
  const realRole = await getRealRole();
  if (!hasMinLevel(realRole, level)) {
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

/** @deprecated Tasks-mutation guard. Use {@link requireProjectEditTasksApi}. */
export const requireProjectMemberApi = requireProjectEditTasksApi;

async function lookupSessionProject(
  sessionId: string,
): Promise<string | null> {
  const { data } = await db()
    .from("DesignSession")
    .select("projectId")
    .eq("id", sessionId)
    .maybeSingle();
  return data?.projectId ?? null;
}

/**
 * Route Handler guard for DesignSession-scoped routes. Looks up the session's
 * projectId and gates access by VIEW permission. Returns 401/403/404 or null.
 * Admin/PM pass without the lookup.
 */
export async function requireSessionAccessApi(
  sessionId: string,
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const realRole = await getRealRole();
  if (hasMinLevel(realRole, MANAGER)) return null;

  const projectId = await lookupSessionProject(sessionId);
  if (!projectId) return new Response("Session not found", { status: 404 });

  if (await canViewProject(projectId)) return null;
  return new Response("Forbidden — no access to this project", { status: 403 });
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

  const realRole = await getRealRole();
  if (hasMinLevel(realRole, MANAGER)) return null;

  const projectId = await lookupSessionProject(sessionId);
  if (!projectId) return new Response("Session not found", { status: 404 });

  if (await canEditSessions(projectId)) return null;
  return new Response("Forbidden — cannot edit this session", { status: 403 });
}
