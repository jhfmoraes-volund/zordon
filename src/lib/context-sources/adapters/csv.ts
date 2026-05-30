import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type ContextSource = Database["public"]["Tables"]["ContextSource"]["Row"];

export interface ResolvedContent {
  fullText: string;
  snapshotAt: string;
}

export async function resolveContent(
  supabase: SupabaseClient<Database>,
  source: ContextSource
): Promise<ResolvedContent> {
  // CSV stub — will be implemented in CTXSRC-010
  // For now, return fullText from DB if available
  if (source.fullText) {
    return {
      fullText: source.fullText,
      snapshotAt: source.capturedAt || source.createdAt,
    };
  }

  throw new Error(
    `CSV adapter not yet implemented for source ${source.id}. Awaiting CTXSRC-010.`
  );
}
