import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type ContextSource = Database["public"]["Tables"]["ContextSource"]["Row"];

export interface ResolvedContent {
  fullText: string;
  snapshotAt: string;
}

/**
 * Documentos (PDF/DOCX/CSV/XLSX/TXT/...) têm o texto extraído no upload e
 * cacheado em `fullText`. Se a extração não rendeu texto (formato não
 * suportado ou falha), devolve uma nota em vez de quebrar.
 */
export async function resolveContent(
  _supabase: SupabaseClient<Database>,
  source: ContextSource,
): Promise<ResolvedContent> {
  return {
    fullText:
      source.fullText ||
      source.summary ||
      "[Documento sem texto extraído — formato não suportado ou falha na leitura.]",
    snapshotAt: source.capturedAt || source.createdAt,
  };
}
