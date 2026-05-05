import "server-only";
import { db } from "@/lib/db";
import type { Json } from "@/lib/supabase/database.types";

export type QualityCategory =
  | "story_created"
  | "module_classified"
  | "module_proposed"
  | "plan_proposed"
  | "plan_executed"
  | "ac_managed";

/**
 * Records a structured Alpha decision for quality tracking. Fire-and-forget
 * by design — failures don't block the agent flow, only log to console.
 *
 * Filled later by either a cron heuristic, PM review, or auto-detect:
 *   humanVerdict: 'correct' | 'wrong' | 'edited' | null
 *
 * Used by /docs/alpha-roadmap-v4.md §6 for the post-30d dashboard.
 */
export async function logAgentQuality(input: {
  agentSlug?: string;
  projectId?: string | null;
  memberId?: string | null;
  threadId?: string | null;
  category: QualityCategory;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await db()
      .from("AgentQualityLog")
      .insert({
        agentSlug: input.agentSlug ?? "alpha",
        projectId: input.projectId ?? null,
        memberId: input.memberId ?? null,
        threadId: input.threadId ?? null,
        category: input.category,
        payload: input.payload as unknown as Json,
      });
    if (error) {
      console.warn("[quality-log] insert failed:", error.message);
    }
  } catch (err) {
    console.warn(
      "[quality-log] unexpected error:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
