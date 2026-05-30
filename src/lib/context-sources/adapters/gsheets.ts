import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { executeTool, getConnectionStatus } from "@/lib/composio/client";

type ContextSource = Database["public"]["Tables"]["ContextSource"]["Row"];

export interface ResolvedContent {
  fullText: string;
  snapshotAt: string;
}

export class ComposioConnectionMissing extends Error {
  constructor(
    public toolkit: "googlesheets",
    public connectUrl: string
  ) {
    super(`Conexão com ${toolkit} não encontrada. Conecte via ${connectUrl}`);
    this.name = "ComposioConnectionMissing";
  }
}

/**
 * Google Sheets adapter via Composio — requer conexão OAuth do member.
 * externalId = spreadsheetId (extraído da URL).
 * Sem COMPOSIO_GSHEETS_AUTH_CONFIG_ID OU member sem conexão → ComposioConnectionMissing.
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

  if (!source.createdBy) {
    throw new Error(
      `ContextSource ${source.id} sem createdBy — não pode resolver conexão Composio`
    );
  }

  // Verifica conexão Composio do member
  const status = await getConnectionStatus(source.createdBy, "googlesheets");
  if (status.status !== "active") {
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const connectUrl = `${appUrl}/integrations/composio/connect?toolkit=googlesheets`;
    throw new ComposioConnectionMissing("googlesheets", connectUrl);
  }

  // Extrai spreadsheetId do externalId (URL completa ou só ID)
  const spreadsheetId = extractSpreadsheetId(source.externalId || "");
  if (!spreadsheetId) {
    throw new Error(
      `externalId inválido para Google Sheets: ${source.externalId} (source ${source.id})`
    );
  }

  // Chama GOOGLESHEETS_GET_SPREADSHEET_VALUES via Composio
  const result = await executeTool(
    source.createdBy,
    "GOOGLESHEETS_GET_SPREADSHEET_VALUES",
    {
      spreadsheetId,
      // Range vazio = pega toda a primeira sheet
      range: "",
    }
  );

  if (!result.ok) {
    throw new Error(
      `Falha ao buscar Google Sheet via Composio: ${result.error} (source ${source.id})`
    );
  }

  // Parse do resultado (formato: {values: string[][]})
  const data = result.data as { values?: string[][] };
  const rows = data.values || [];

  if (rows.length === 0) {
    return {
      fullText: `# ${source.title || "Google Sheet vazia"}\n\n(sem dados)`,
      snapshotAt: new Date().toISOString(),
    };
  }

  // Converte pra markdown table (primeira linha = headers)
  const headers = rows[0];
  const dataRows = rows.slice(1);

  const headerRow = `| ${headers.join(" | ")} |`;
  const separatorRow = `| ${headers.map(() => "---").join(" | ")} |`;
  const tableRows = dataRows.map((row) => {
    const cells = headers.map((_, i) => String(row[i] ?? "").replace(/\|/g, "\\|"));
    return `| ${cells.join(" | ")} |`;
  });

  const markdown = [
    `# ${source.title || "Google Sheet"}`,
    "",
    `**Fonte:** https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    `**Capturado em:** ${new Date().toISOString()}`,
    `**Total de linhas:** ${dataRows.length}`,
    "",
    headerRow,
    separatorRow,
    ...tableRows,
  ].join("\n");

  return {
    fullText: markdown,
    snapshotAt: new Date().toISOString(),
  };
}

/**
 * Extrai spreadsheetId de uma URL ou retorna o ID direto se já for um ID.
 * Exemplos:
 * - https://docs.google.com/spreadsheets/d/1ABC.../edit → 1ABC...
 * - 1ABC... → 1ABC...
 */
function extractSpreadsheetId(urlOrId: string): string | null {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  // Se não tem slash, assume que já é o ID
  if (!urlOrId.includes("/")) return urlOrId;
  return null;
}
