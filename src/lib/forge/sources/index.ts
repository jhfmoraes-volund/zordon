import type { ForgeSource } from "../source";
import { createMockSource } from "./mock";
import { createSSESource } from "./sse";
import { createSupabaseSource } from "./supabase";

export type SourceType = "mock" | "sse" | "supabase";

/**
 * Auto-detect source strategy:
 * 1. SSE was removed in FUI-004 - detection will always fail
 * 2. Falls back to Supabase realtime (primary method now)
 * 3. Manual override via ?source=mock|sse|supabase (sse will fail)
 */
export async function createAutoSource(
  runId: string,
  override?: SourceType
): Promise<ForgeSource> {
  // Manual override for debugging
  if (override === "mock") {
    return createMockSource();
  }
  if (override === "sse") {
    return createSSESource(runId);
  }
  if (override === "supabase") {
    return createSupabaseSource(runId);
  }

  // Auto-detect: try SSE first
  const sseAvailable = await checkSSEAvailable(runId);
  if (sseAvailable) {
    console.log("[ForgeSource] Using SSE (local)");
    return createSSESource(runId);
  }

  // Fallback to Supabase
  console.log("[ForgeSource] SSE unavailable, falling back to Supabase realtime");
  return createSupabaseSource(runId);
}

/**
 * DEPRECATED: SSE endpoint check
 * Endpoint was removed in FUI-004 - this will always return false
 */
async function checkSSEAvailable(_runId: string): Promise<boolean> {
  // SSE endpoint removed in FUI-004 - always return false
  // This causes auto-detection to fall back to Supabase Realtime
  return false;
}

// Re-export individual sources for manual use
export { createMockSource } from "./mock";
export { createSSESource } from "./sse";
export { createSupabaseSource } from "./supabase";
