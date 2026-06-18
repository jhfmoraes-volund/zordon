import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type ContextSource = Database["public"]["Tables"]["ContextSource"]["Row"];

export interface ResolvedContent {
  fullText: string;
  snapshotAt: string;
}

/**
 * Design system do projeto. Diferente do kind `document` (que stripa HTML), o
 * upload guarda o conteúdo CRU em `fullText` — HTML/CSS preservados, tokens e
 * componentes intactos — pra um agente (Forge/Vitor) gerar UI batendo com o
 * sistema. PDF/DOCX caem no texto extraído no upload. Aqui só devolvemos o
 * cache; a extração/raw acontece no DAL no momento do upload.
 */
export async function resolveContent(
  _supabase: SupabaseClient<Database>,
  source: ContextSource,
): Promise<ResolvedContent> {
  return {
    fullText:
      source.fullText ||
      source.summary ||
      "[Design system anexado sem conteúdo legível.]",
    snapshotAt: source.capturedAt || source.createdAt,
  };
}
