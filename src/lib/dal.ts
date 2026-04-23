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
// Member id + project allocation helpers
// ═══════════════════════════════════════════════════════════

/**
 * Current user's Member.id, read from the header proxy.ts injects from
 * auth.users.app_metadata.member_id. Zero DB calls.
 * Returns null if the user has no linked member (shouldn't happen post-invite).
 */
export const getMemberId = cache(async (): Promise<string | null> => {
  const h = await headers();
  const id = h.get("x-member-id");
  return id && id.length > 0 ? id : null;
});

/**
 * Project ids the current member is allocated to (via ProjectMember).
 * Cached per request via React.cache — shared across sidebar, lists, guards.
 */
export const getAllocatedProjectIds = cache(
  async (): Promise<string[]> => {
    const memberId = await getMemberId();
    if (!memberId) return [];
    const { data } = await db()
      .from("ProjectMember")
      .select("projectId")
      .eq("memberId", memberId);
    return (data ?? []).map((r) => r.projectId);
  },
);

/**
 * True iff the current user can access the given project:
 *   - Manager (PM / head-ops / CEO): always yes
 *   - Builder: only if in ProjectMember for this project
 *
 * Uses real role (not effective) so admins keep their powers while impersonating.
 */
export async function isAllocatedTo(projectId: string): Promise<boolean> {
  const realRole = await getRealRole();
  if (hasMinLevel(realRole, MANAGER)) return true;
  const ids = await getAllocatedProjectIds();
  return ids.includes(projectId);
}

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

/**
 * Route Handler guard for project-scoped mutations. Returns 401/403 response
 * or null. Admin/PM always pass; Builders must be in ProjectMember(projectId).
 */
export async function requireProjectMemberApi(
  projectId: string,
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (await isAllocatedTo(projectId)) return null;
  return new Response("Forbidden — not allocated to this project", {
    status: 403,
  });
}

/**
 * Route Handler guard for DesignSession-scoped routes. Looks up the session's
 * projectId and gates access by allocation. Returns 401/403/404 or null.
 * Admin/PM pass without the lookup (role check happens first).
 */
export async function requireSessionAccessApi(
  sessionId: string,
): Promise<Response | null> {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const realRole = await getRealRole();
  if (hasMinLevel(realRole, MANAGER)) return null;

  const { data: session } = await db()
    .from("DesignSession")
    .select("projectId")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return new Response("Session not found", { status: 404 });

  if (await isAllocatedTo(session.projectId)) return null;
  return new Response("Forbidden — not allocated to this project", {
    status: 403,
  });
}
