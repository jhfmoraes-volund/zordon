import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parse } from "csv-parse/sync";

type ContextSource = Database["public"]["Tables"]["ContextSource"]["Row"];

export interface ResolvedContent {
  fullText: string;
  snapshotAt: string;
}

/**
 * CSV adapter — snapshot-only (sem refresh).
 * File storage: bucket 'context-source-files', name = source.id (UUID).
 * Parsing: csv-parse → array de rows → markdown table.
 */
export async function resolveContent(
  supabase: SupabaseClient<Database>,
  source: ContextSource
): Promise<ResolvedContent> {
  // Se já temos fullText cacheado, retorna direto
  if (source.fullText) {
    return {
      fullText: source.fullText,
      snapshotAt: source.capturedAt || source.createdAt,
    };
  }

  // Download do arquivo CSV do bucket
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("context-source-files")
    .download(source.id);

  if (downloadError) {
    throw new Error(
      `Falha ao baixar CSV do storage: ${downloadError.message} (source ${source.id})`
    );
  }

  if (!fileData) {
    throw new Error(`Arquivo CSV não encontrado no storage (source ${source.id})`);
  }

  // Parse CSV
  const text = await fileData.text();
  const records = parse(text, {
    columns: true, // primeira linha = headers
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    return {
      fullText: `# ${source.title || "CSV vazio"}\n\n(sem dados)`,
      snapshotAt: source.capturedAt || source.createdAt,
    };
  }

  // Converte pra markdown table
  const headers = Object.keys(records[0]);
  const headerRow = `| ${headers.join(" | ")} |`;
  const separatorRow = `| ${headers.map(() => "---").join(" | ")} |`;
  const dataRows = records.map((row) => {
    const cells = headers.map((h) => String(row[h] ?? "").replace(/\|/g, "\\|"));
    return `| ${cells.join(" | ")} |`;
  });

  const markdown = [
    `# ${source.title || "Planilha CSV"}`,
    "",
    `**Fonte:** ${source.externalId || "upload local"}`,
    `**Capturado em:** ${source.capturedAt || source.createdAt}`,
    `**Total de linhas:** ${records.length}`,
    "",
    headerRow,
    separatorRow,
    ...dataRows,
  ].join("\n");

  return {
    fullText: markdown,
    snapshotAt: source.capturedAt || source.createdAt,
  };
}
