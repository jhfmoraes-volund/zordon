import { db } from "@/lib/db";
import { FP_MATRIX_DEFAULT, isFpMatrix, type FpMatrix } from "@/lib/function-points";

/**
 * Loads structured tuning values for an agent (AgentConfig rows).
 * Returns a key→value map. Values are raw JSONB — caller casts to expected type.
 * Cached per-process for 30s.
 */
const configCache = new Map<string, { value: Record<string, unknown>; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

export async function loadAgentConfig(
  agentId: string,
): Promise<Record<string, unknown>> {
  const cached = configCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data } = await db()
    .from("AgentConfig")
    .select("key, value")
    .eq("agentId", agentId);

  const map: Record<string, unknown> = {};
  for (const row of data || []) map[row.key] = row.value;

  configCache.set(agentId, { value: map, expiresAt: Date.now() + CACHE_TTL_MS });
  return map;
}

/** Invalidate cached config for an agent (call after AgentConfig updates). */
export function invalidateAgentConfigCache(agentId: string): void {
  configCache.delete(agentId);
}

// ─── Heuristics ──────────────────────────────────────────────────────────────

export interface HeuristicIndexEntry {
  name: string;
  title: string;
  description: string;
  category: string | null;
}

export async function loadAgentHeuristicsIndex(
  agentId: string,
): Promise<HeuristicIndexEntry[]> {
  const { data } = await db()
    .from("AgentHeuristic")
    .select("name, title, description, category")
    .eq("agentId", agentId)
    .eq("isActive", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  return (data || []) as HeuristicIndexEntry[];
}

/**
 * Loads the tuned FP matrix for an agent from AgentConfig.
 * Falls back to FP_MATRIX_DEFAULT if the key is absent or malformed.
 * Cached per-process for 60s.
 */
const matrixCache = new Map<string, { value: FpMatrix; expiresAt: number }>();
const FP_CACHE_TTL_MS = 60_000;

export async function loadFpMatrix(agentId: string): Promise<FpMatrix> {
  const cached = matrixCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data } = await db()
    .from("AgentConfig")
    .select("value")
    .eq("agentId", agentId)
    .eq("key", "fp_matrix")
    .maybeSingle();

  const matrix = isFpMatrix(data?.value) ? (data!.value as FpMatrix) : FP_MATRIX_DEFAULT;
  matrixCache.set(agentId, { value: matrix, expiresAt: Date.now() + FP_CACHE_TTL_MS });
  return matrix;
}

export async function loadAgentHeuristic(
  agentId: string,
  name: string,
): Promise<{ title: string; body: string } | null> {
  const { data } = await db()
    .from("AgentHeuristic")
    .select("title, body")
    .eq("agentId", agentId)
    .eq("name", name)
    .eq("isActive", true)
    .maybeSingle();

  return data ? { title: data.title, body: data.body } : null;
}
