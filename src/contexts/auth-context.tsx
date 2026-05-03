"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AccessLevel } from "@/lib/roles";

export type SessionMember = {
  id: string;
  name: string;
  /** Job title (renamed from `role`). */
  position: string;
  /** @deprecated mirror of `position` while callers migrate. */
  role: string;
  fpCapacity: number;
  email: string | null;
};

export type AuthValue = {
  /** Supabase user id (auth.users.id). Source of truth for who is logged in. */
  userId: string;
  /** Email from the auth user. */
  userEmail: string | null;
  /**
   * @deprecated use `realAccessLevel` (authz) or `member.position` (cargo).
   * The real legacy role from app_metadata.
   */
  realRole: string | null;
  /**
   * @deprecated use `effectiveAccessLevel` (authz) or `member.position` (cargo).
   */
  effectiveRole: string | null;
  /**
   * Real access level of the logged-in user (`guest`/`builder`/`manager`/`admin`).
   * Use this to decide whether to show the impersonation dropdown — only real
   * admins can impersonate.
   */
  realAccessLevel: AccessLevel;
  /**
   * Effective access level for UI/read gating. Equal to `realAccessLevel`,
   * except when an admin is impersonating another user (then it reflects that
   * user's real access level). Use this for sidebar visibility and page access.
   */
  effectiveAccessLevel: AccessLevel;
  /**
   * The "current" Member — usually the one linked to userId, but if the real
   * user is admin and impersonating, this is the impersonated member.
   */
  member: SessionMember | null;
  /** True iff the current member is impersonated (only possible for admins). */
  isImpersonating: boolean;
  /**
   * All members — populated only when the real user is admin (head-ops/ceo).
   * Used to feed the impersonation dropdown.
   */
  members: SessionMember[];
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({
  value,
  children,
}: {
  value: AuthValue;
  children: ReactNode;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
