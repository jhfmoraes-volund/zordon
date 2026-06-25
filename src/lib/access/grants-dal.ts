import "server-only";

import { db } from "@/lib/db";
import type { CapabilityScope } from "@/lib/access/capabilities";

/**
 * DAL server-only de MemberAccessGrant (concessões de acesso por membro).
 * Usa db() (service-role) — o gate é admin-only nas rotas (requireMinAccessLevelApi).
 */

export type ActiveGrant = {
  id: string;
  capabilityKey: string;
  scope: CapabilityScope;
  projectId: string | null;
  grantedAt: string;
  /** Nome do projeto (embed da FK), null para grants globais. */
  project: { name: string } | null;
};

/** Resolve Member.id → auth userId. Null se o membro não tem conta de login. */
export async function getMemberUserId(memberId: string): Promise<string | null> {
  const { data } = await db()
    .from("Member")
    .select("userId")
    .eq("id", memberId)
    .maybeSingle();
  return (data?.userId as string | null) ?? null;
}

/** Grants ATIVOS (revokedAt IS NULL) de um userId, com nome do projeto. */
export async function listActiveGrantsForUser(
  userId: string,
): Promise<ActiveGrant[]> {
  const { data } = await db()
    .from("MemberAccessGrant")
    .select("id, capabilityKey, scope, projectId, grantedAt, project:Project(name)")
    .eq("userId", userId)
    .is("revokedAt", null)
    .order("grantedAt", { ascending: false });
  return (data ?? []) as unknown as ActiveGrant[];
}

/** Grant ativo específico (para resolve-or-create em corrida/duplicata). */
export async function findActiveGrant(
  userId: string,
  capabilityKey: string,
  projectId: string | null,
): Promise<ActiveGrant | null> {
  let q = db()
    .from("MemberAccessGrant")
    .select("id, capabilityKey, scope, projectId, grantedAt, project:Project(name)")
    .eq("userId", userId)
    .eq("capabilityKey", capabilityKey)
    .is("revokedAt", null);
  q = projectId === null ? q.is("projectId", null) : q.eq("projectId", projectId);
  const { data } = await q.maybeSingle();
  return (data as unknown as ActiveGrant) ?? null;
}

export async function createGrant(input: {
  userId: string;
  capabilityKey: string;
  scope: CapabilityScope;
  projectId: string | null;
  grantedBy: string;
}) {
  return db()
    .from("MemberAccessGrant")
    .insert({
      userId: input.userId,
      capabilityKey: input.capabilityKey,
      scope: input.scope,
      projectId: input.projectId,
      grantedBy: input.grantedBy,
    })
    .select("id, capabilityKey, scope, projectId, grantedAt, project:Project(name)")
    .single();
}

/** Revoga (soft) um grant ativo. Retorna null se já estava revogado/inexistente. */
export async function revokeGrant(grantId: string, revokedBy: string) {
  return db()
    .from("MemberAccessGrant")
    .update({ revokedAt: new Date().toISOString(), revokedBy })
    .eq("id", grantId)
    .is("revokedAt", null)
    .select("id")
    .maybeSingle();
}
