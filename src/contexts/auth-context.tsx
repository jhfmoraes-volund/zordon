"use client";

import { createContext, useContext, type ReactNode } from "react";

export type SessionMember = {
  id: string;
  name: string;
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
   * The real role from app_metadata. Use this to decide whether to show the
   * impersonation dropdown — only real admins can impersonate.
   */
  realRole: string | null;
  /**
   * The effective role for UI/read gating. Equal to realRole, except when an
   * admin is impersonating another member (then it equals that member's role).
   * Use this for sidebar visibility and page access decisions.
   */
  effectiveRole: string | null;
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
