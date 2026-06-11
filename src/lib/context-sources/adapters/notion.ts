import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { executeTool, getConnectionStatus } from "@/lib/composio/client";

type ContextSource = Database["public"]["Tables"]["ContextSource"]["Row"];

export interface ResolvedContent {
  fullText: string;
  snapshotAt: string;
}

/**
 * Thrown when the member has no active Composio connection for Notion.
 * Endpoint should catch this and return 412 Precondition Failed with connectUrl.
 */
export class ComposioConnectionMissing extends Error {
  constructor(
    public toolkit: string,
    public connectUrl?: string
  ) {
    super(`Composio connection missing for toolkit: ${toolkit}`);
    this.name = "ComposioConnectionMissing";
  }
}

/**
 * Notion adapter via Composio — requer conexão OAuth do member.
 * externalUrl = URL da página/base do Notion (ou o ID cru).
 * Busca os blocos de primeiro nível (NOTION_FETCH_BLOCK_CONTENTS) e renderiza
 * como markdown. Conteúdo aninhado (toggles/colunas) pode ficar truncado — v1.
 * Sem COMPOSIO_NOTION_AUTH_CONFIG_ID OU member sem conexão → ComposioConnectionMissing.
 */
export async function resolveContent(
  supabase: SupabaseClient<Database>,
  source: ContextSource
): Promise<ResolvedContent> {
  void supabase;

  const ref = source.externalUrl || source.externalId;
  if (!ref) {
    throw new Error(`Notion source ${source.id} sem externalUrl (URL da página)`);
  }
  if (!source.createdBy) {
    throw new Error(`Notion source ${source.id} sem createdBy (member ID)`);
  }

  const pageId = extractNotionId(ref);
  if (!pageId) {
    throw new Error(
      `URL do Notion inválida: ${ref} (não consegui extrair o ID da página) — source ${source.id}`
    );
  }

  // Verifica conexão Composio do member
  const status = await getConnectionStatus(source.createdBy, "notion");
  if (status.status !== "active") {
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const connectUrl = `${appUrl}/api/integrations/composio/connect?toolkit=notion`;
    throw new ComposioConnectionMissing("notion", connectUrl);
  }

  const result = await executeTool(source.createdBy, "NOTION_FETCH_BLOCK_CONTENTS", {
    block_id: pageId,
    page_size: 100,
  });

  if (!result.ok) {
    throw new Error(
      `Falha ao buscar página do Notion via Composio: ${result.error} (source ${source.id})`
    );
  }

  const blocks = extractBlocks(result.data);
  const body =
    blocks.length > 0
      ? blocks.map(renderBlock).filter(Boolean).join("\n")
      : "(página sem conteúdo de blocos ou conteúdo não acessível à integração)";

  const snapshotAt = new Date().toISOString();
  const fullText = [
    `# ${source.title || "Página do Notion"}`,
    "",
    `**Fonte:** ${source.externalUrl || ref}`,
    `**Capturado em:** ${snapshotAt}`,
    "",
    body,
  ].join("\n");

  return { fullText, snapshotAt };
}

/**
 * Extrai o ID da página/base de uma URL do Notion (ou retorna o ID se já vier
 * cru). Notion usa UUID de 32 hex no fim do slug, com ou sem hífens.
 */
function extractNotionId(urlOrId: string): string | null {
  // UUID já com hífens
  const dashed = urlOrId.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  if (dashed) return dashed[1].toLowerCase();

  // 32 hex contíguos (pega o último — o slug pode ter outros números antes)
  const matches = urlOrId.match(/[0-9a-f]{32}/gi);
  if (matches && matches.length > 0) {
    const raw = matches[matches.length - 1].toLowerCase();
    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
  }
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Composio normaliza o payload de formas diferentes — varre os shapes comuns. */
function extractBlocks(data: unknown): any[] {
  const d = data as any;
  if (!d) return [];
  if (Array.isArray(d)) return d;
  return (
    d.results ??
    d.response_data?.results ??
    d.data?.results ??
    d.blocks ??
    []
  );
}

/** Junta um array de rich_text do Notion no texto plano. */
function richText(rt: any): string {
  if (!Array.isArray(rt)) return "";
  return rt.map((t: any) => t?.plain_text ?? t?.text?.content ?? "").join("");
}

/** Renderiza um bloco do Notion em markdown. Cobre os tipos mais comuns. */
function renderBlock(block: any): string {
  const type: string = block?.type;
  if (!type) return "";
  const content = block[type] ?? {};
  const text = richText(content.rich_text);

  switch (type) {
    case "paragraph":
      return text;
    case "heading_1":
      return `## ${text}`;
    case "heading_2":
      return `### ${text}`;
    case "heading_3":
      return `#### ${text}`;
    case "bulleted_list_item":
      return `- ${text}`;
    case "numbered_list_item":
      return `1. ${text}`;
    case "to_do":
      return `- [${content.checked ? "x" : " "}] ${text}`;
    case "toggle":
      return `- ${text}`;
    case "quote":
      return `> ${text}`;
    case "callout":
      return `> ${text}`;
    case "code":
      return `\`\`\`${content.language ?? ""}\n${text}\n\`\`\``;
    case "divider":
      return "---";
    case "child_page":
      return `📄 **${content.title ?? "Subpágina"}**`;
    case "child_database":
      return `🗃️ **${content.title ?? "Base de dados"}**`;
    default:
      return text ? text : "";
  }
}
