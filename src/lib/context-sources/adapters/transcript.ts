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
  // For transcripts, fullText is already in the DB
  if (!source.fullText) {
    throw new Error(`Transcript ${source.id} missing fullText`);
  }

  return {
    fullText: source.fullText,
    snapshotAt: source.capturedAt || source.createdAt,
  };
}
