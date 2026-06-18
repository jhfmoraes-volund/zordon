import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import * as transcriptAdapter from "@/lib/context-sources/adapters/transcript";
import * as meetingAdapter from "@/lib/context-sources/adapters/meeting";
import * as csvAdapter from "@/lib/context-sources/adapters/csv";
import * as gsheetsAdapter from "@/lib/context-sources/adapters/gsheets";
import * as githubAdapter from "@/lib/context-sources/adapters/github";
import * as documentAdapter from "@/lib/context-sources/adapters/document";
import * as notionAdapter from "@/lib/context-sources/adapters/notion";
import * as driveAdapter from "@/lib/context-sources/adapters/drive";
import * as designSystemAdapter from "@/lib/context-sources/adapters/design-system";

/**
 * Teto de caracteres por leitura. O resultado da tool entra no message array
 * e é reenviado em CADA step do loop (maxSteps até 40), então um único insumo
 * gigante (ex: dump JSON de 3MB importado como `document`) estoura a janela de
 * contexto do modelo (1M tokens). Os adapters não capam de forma uniforme
 * (Drive capa em 1MB, document/transcript/csv não capam), então este é o
 * chokepoint compartilhado que garante o teto. ~200k chars ≈ 50k tokens —
 * generoso pra docs/transcripts reais, seguro mesmo lendo várias fontes.
 */
const MAX_FULLTEXT_CHARS = 200_000;

function capFullText(text: string): { fullText: string; truncated: boolean } {
  if (text.length <= MAX_FULLTEXT_CHARS) {
    return { fullText: text, truncated: false };
  }
  const head = text.slice(0, MAX_FULLTEXT_CHARS);
  return {
    fullText: `${head}\n\n[Conteúdo truncado: ${text.length.toLocaleString("pt-BR")} caracteres no total, exibindo os primeiros ${MAX_FULLTEXT_CHARS.toLocaleString("pt-BR")}. Para detalhes além deste ponto, consulte a fonte original ou peça um recorte específico.]`,
    truncated: true,
  };
}

/**
 * Factory de tool read_context_source — compartilhada entre Vitoria e Vitor.
 * Lê o conteúdo de qualquer ContextSource linkado (transcript, meeting, planilha, GitHub).
 * Dispatcha por kind para o adapter correto.
 */
export function createReadContextSourceTool() {
  return tool({
    description:
      "Lê o conteúdo de uma fonte de contexto linkada (transcript, meeting, documento/anexo, planilha, GitHub, Notion, design system do projeto). Use para extrair insights detalhados antes de criar notas ou propostas — inclusive para ler documentos anexados (PDF/DOCX/HTML/TXT/MD/CSV), o design system do projeto (HTML cru com tokens/componentes) ou páginas do Notion pelo seu contextSourceId.",
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
          case "notion":
            resolvedContent = await notionAdapter.resolveContent(
              supabase,
              source
            );
            break;
          case "gdrive_file":
            resolvedContent = await driveAdapter.resolveContent(
              supabase,
              source
            );
            break;
          case "design_system":
            resolvedContent = await designSystemAdapter.resolveContent(
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

        const { fullText, truncated } = capFullText(resolvedContent.fullText);

        return {
          ok: true,
          id: source.id,
          kind: source.kind,
          title: source.title,
          externalUrl: source.externalUrl,
          capturedAt: source.capturedAt,
          summary: source.summary,
          fullText,
          truncated,
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
