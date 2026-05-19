import "server-only";
import { db } from "./db";
import { RoamClient } from "./roam";
import { GranolaClient } from "./granola";

/**
 * Per-member API credentials for third-party services.
 * Secrets are encrypted at rest via Supabase Vault; only service_role
 * (the server) can call the RPCs that read/write them.
 *
 * The caller is responsible for identity: always pass the memberId
 * resolved from the DAL (getCurrentMember), never from user input.
 */

export type IntegrationProvider = "roam" | "granola";

export interface IntegrationStatus {
  connected: boolean;
  tokenHint: string | null;
  updatedAt: string | null;
}

// ─── Reads ────────────────────────────────────────────────

export async function getMemberIntegrationStatus(
  memberId: string,
  provider: IntegrationProvider,
): Promise<IntegrationStatus> {
  const { data } = await db()
    .from("MemberIntegration")
    .select("tokenHint, updatedAt")
    .eq("memberId", memberId)
    .eq("provider", provider)
    .maybeSingle();

  if (!data) return { connected: false, tokenHint: null, updatedAt: null };
  return { connected: true, tokenHint: data.tokenHint, updatedAt: data.updatedAt };
}

/**
 * Returns the decrypted token for the member, or null if not connected.
 * Throws if the RPC fails (e.g. RLS or Vault permission error).
 */
export async function getMemberIntegrationToken(
  memberId: string,
  provider: IntegrationProvider,
): Promise<string | null> {
  const { data, error } = await db().rpc("get_member_integration_secret", {
    p_member_id: memberId,
    p_provider: provider,
  });
  if (error) throw new Error(`Failed to read ${provider} token: ${error.message}`);
  return data ?? null;
}

// ─── Writes ───────────────────────────────────────────────

/**
 * Validates the Roam token by making a lightweight authenticated call,
 * then persists it encrypted. Throws on invalid token so we never store
 * something that won't work.
 */
export async function setMemberRoamIntegration(
  memberId: string,
  token: string,
): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Token vazio");

  // Validate: list 1 transcript. Any 200 response proves the token is good.
  // (listUsers forces expand=email,status which the Roam API currently rejects.)
  const client = new RoamClient(trimmed);
  try {
    await client.listTranscripts({ limit: 1 });
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("401") || msg.includes("403")) {
      throw new Error("Token invalido — verifique se copiou corretamente do Roam.");
    }
    throw new Error(`Nao foi possivel validar o token: ${msg}`);
  }

  const hint = trimmed.slice(-4);
  const { error } = await db().rpc("set_member_integration", {
    p_member_id: memberId,
    p_provider: "roam",
    p_token: trimmed,
    p_token_hint: hint,
  });
  if (error) throw new Error(`Failed to save token: ${error.message}`);
}

/**
 * Validates the Granola token (Personal API key) by making a lightweight
 * authenticated call, then persists it encrypted. Throws on invalid token
 * so we never store something that won't work.
 */
export async function setMemberGranolaIntegration(
  memberId: string,
  token: string,
): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Token vazio");

  // Validate: listing 1 note proves the key is good. Granola returns 401/403
  // for invalid keys.
  const client = new GranolaClient(trimmed);
  try {
    await client.listNotes({ limit: 1 });
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("401") || msg.includes("403")) {
      throw new Error("Token invalido — verifique se copiou corretamente do Granola (Settings > Connectors > API keys).");
    }
    throw new Error(`Nao foi possivel validar o token: ${msg}`);
  }

  const hint = trimmed.slice(-4);
  const { error } = await db().rpc("set_member_integration", {
    p_member_id: memberId,
    p_provider: "granola",
    p_token: trimmed,
    p_token_hint: hint,
  });
  if (error) throw new Error(`Failed to save token: ${error.message}`);
}

export async function deleteMemberIntegration(
  memberId: string,
  provider: IntegrationProvider,
): Promise<void> {
  const { error } = await db().rpc("delete_member_integration", {
    p_member_id: memberId,
    p_provider: provider,
  });
  if (error) throw new Error(`Failed to delete integration: ${error.message}`);
}

// ─── Convenience ──────────────────────────────────────────

/**
 * Shortcut for the Roam flow. Returns a ready-to-use RoamClient or null
 * if the member has not connected their Roam account yet.
 */
export async function getMemberRoamClient(
  memberId: string,
): Promise<RoamClient | null> {
  const token = await getMemberIntegrationToken(memberId, "roam");
  if (!token) return null;
  return new RoamClient(token);
}

/**
 * Shortcut for the Granola flow. Returns a ready-to-use GranolaClient or
 * null if the member has not connected their Granola account yet.
 *
 * Per-member tokens take precedence over the GRANOLA_KEY env fallback.
 */
export async function getMemberGranolaClient(
  memberId: string,
): Promise<GranolaClient | null> {
  const token = await getMemberIntegrationToken(memberId, "granola");
  if (!token) return null;
  return new GranolaClient(token);
}
