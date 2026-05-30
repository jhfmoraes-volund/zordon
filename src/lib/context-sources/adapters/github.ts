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
  // GitHub stub — will be implemented in CTXSRC-009
  throw new Error(
    `GitHub adapter not yet implemented for source ${source.id}. Awaiting CTXSRC-009.`
  );
}
