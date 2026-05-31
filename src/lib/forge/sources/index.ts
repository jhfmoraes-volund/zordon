import type { ForgeSource } from "../source";
import { createMockSource } from "./mock";
import { createSSESource } from "./sse";
import { createSupabaseSource } from "./supabase";

export type SourceType = "mock" | "sse" | "supabase";

/**
 * Auto-detect source strategy:
 * 1. Try SSE first (local dev, lowest latency)
 * 2. Fallback to Supabase realtime if SSE unavailable
 * 3. Manual override via ?source=mock|sse|supabase
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
 * Check if SSE endpoint is available by attempting a HEAD request
 * Timeout after 500ms to avoid blocking UI
 */
async function checkSSEAvailable(runId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 500);

    const response = await fetch(`/api/forge/runs/${runId}/stream`, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    // Network error, timeout, or 404 = SSE not available
    return false;
  }
}

// Re-export individual sources for manual use
export { createMockSource } from "./mock";
export { createSSESource } from "./sse";
export { createSupabaseSource } from "./supabase";
