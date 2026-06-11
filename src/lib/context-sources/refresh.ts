import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import * as gsheetsAdapter from "@/lib/context-sources/adapters/gsheets";
import * as githubAdapter from "@/lib/context-sources/adapters/github";
import * as notionAdapter from "@/lib/context-sources/adapters/notion";
import * as driveAdapter from "@/lib/context-sources/adapters/drive";

type Supabase = SupabaseClient<Database>;
type ContextSource = Database["public"]["Tables"]["ContextSource"]["Row"];

/** Kinds com fonte externa viva — os que o cron re-resolve (runbook D13). */
export const EXTERNAL_KINDS = [
  "spreadsheet_gsheets",
  "github_repo",
  "github_pr",
  "github_issue",
  "gdrive_file",
  "notion",
] as const;

export function isExternalKind(kind: string): boolean {
  return (EXTERNAL_KINDS as readonly string[]).includes(kind);
}

/**
 * Re-resolve o fullText de um source externo ignorando o cache e persiste o
 * snapshot novo (fullText + capturedAt). Usado pelo refresh diário do cron
 * antes do wiki composer — snapshots estáticos não servem pra wiki nível A.
 *
 * Lança em erro (caller loga, marca e segue — não derruba o batch).
 */
export async function refreshExternalSource(
  supabase: Supabase,
  source: ContextSource
): Promise<void> {
  let fullText: string;
  switch (source.kind) {
    case "spreadsheet_gsheets":
      fullText = (
        await gsheetsAdapter.resolveContent(supabase, source, { force: true })
      ).fullText;
      break;
    case "github_repo":
    case "github_pr":
    case "github_issue":
      // GitHub e Notion não cacheiam — resolveContent já é live fetch.
      fullText = (await githubAdapter.resolveContent(supabase, source)).fullText;
      break;
    case "notion":
      fullText = (await notionAdapter.resolveContent(supabase, source)).fullText;
      break;
    case "gdrive_file":
      // O adapter do Drive persiste fullText + capturedAt sozinho.
      await driveAdapter.resolveContent(supabase, source, { force: true });
      return;
    default:
      throw new Error(`Kind ${source.kind} não é externo — sem refresh`);
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("ContextSource")
    .update({ fullText, capturedAt: now, updatedAt: now })
    .eq("id", source.id);
  if (error) {
    throw new Error(`persist do refresh falhou (${source.id}): ${error.message}`);
  }
}
