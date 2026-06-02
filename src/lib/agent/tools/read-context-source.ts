import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import * as transcriptAdapter from "@/lib/context-sources/adapters/transcript";
import * as meetingAdapter from "@/lib/context-sources/adapters/meeting";
import * as csvAdapter from "@/lib/context-sources/adapters/csv";
import * as gsheetsAdapter from "@/lib/context-sources/adapters/gsheets";
import * as githubAdapter from "@/lib/context-sources/adapters/github";
import * as documentAdapter from "@/lib/context-sources/adapters/document";

/**
 * Factory de tool read_context_source — compartilhada entre Vitoria e Vitor.
 * Lê o conteúdo de qualquer ContextSource linkado (transcript, meeting, planilha, GitHub).
 * Dispatcha por kind para o adapter correto.
 */
export function createReadContextSourceTool() {
  return tool({
    description:
      "Lê o conteúdo de uma fonte de contexto linkada (transcript, meeting, planilha, GitHub). Use para extrair insights detalhados antes de criar notas ou propostas.",
    inputSchema: z.object({
      sourceId: z.string().uuid().describe("ID do ContextSource"),
    }),
    execute: async ({ sourceId }) => {
      const supabase = db();

      // Fetch ContextSource metadata
      const { data: source, error } = await supabase
        .from("ContextSource")
        .select("*")
        .eq("id", sourceId)
        .single();

      if (error || !source) {
        return {
          ok: false,
          error: "ContextSource não encontrado",
        };
      }

      try {
        // Dispatch to adapter based on kind
        let resolvedContent;
        switch (source.kind) {
          case "transcript":
            resolvedContent = await transcriptAdapter.resolveContent(
              supabase,
              source
            );
            break;
          case "meeting":
            resolvedContent = await meetingAdapter.resolveContent(
              supabase,
              source
            );
            break;
          case "spreadsheet_csv":
            resolvedContent = await csvAdapter.resolveContent(supabase, source);
            break;
          case "spreadsheet_gsheets":
            resolvedContent = await gsheetsAdapter.resolveContent(
              supabase,
              source
            );
            break;
          case "github_repo":
          case "github_pr":
          case "github_issue":
            resolvedContent = await githubAdapter.resolveContent(
              supabase,
              source
            );
            break;
          case "document":
            resolvedContent = await documentAdapter.resolveContent(
              supabase,
              source
            );
            break;
          default:
            return {
              ok: false,
              error: `Unsupported ContextSource kind: ${source.kind}`,
            };
        }

        return {
          ok: true,
          id: source.id,
          kind: source.kind,
          title: source.title,
          externalUrl: source.externalUrl,
          capturedAt: source.capturedAt,
          summary: source.summary,
          fullText: resolvedContent.fullText,
          snapshotAt: resolvedContent.snapshotAt,
        };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "Failed to resolve ContextSource content",
        };
      }
    },
  });
}
