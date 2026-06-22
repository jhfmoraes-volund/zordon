// Sem "server-only": consumido por rotas Next.js E pelo composer espelhado no
// repo zordon-daemon (CLI). server-only quebra em CLI (mesmo motivo de chat-turn.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Ênfase da Wiki (WCP-001): steer livre do PM, 1 por projeto, que o composer
 * honra em TODA geração. Escrita via service role (tool set_wiki_emphasis da
 * Vitoria); leitura por quem vê o projeto (RLS).
 */

type Client = SupabaseClient<Database>;

/** Ênfase vigente do projeto, ou "" se nunca setada. */
export async function getWikiEmphasis(
  supabase: Client,
  projectId: string,
): Promise<string> {
  const { data } = await supabase
    .from("ProjectWikiEmphasis")
    .select("emphasis")
    .eq("projectId", projectId)
    .maybeSingle();
  return data?.emphasis ?? "";
}

/** Upsert da ênfase (1 por projeto). `memberId` carimba updatedBy. */
export async function setWikiEmphasis(
  supabase: Client,
  projectId: string,
  emphasis: string,
  memberId: string | null,
): Promise<void> {
  const { error } = await supabase.from("ProjectWikiEmphasis").upsert(
    {
      projectId,
      emphasis,
      updatedBy: memberId,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "projectId" },
  );
  if (error) throw new Error(error.message);
}
