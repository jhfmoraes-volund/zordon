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

/** Teto de blocos buscados na página inteira (proteção de custo/loop). */
const MAX_BLOCKS = 2000;
/** Profundidade máxima de recursão: página → container → conteúdo. */
const MAX_DEPTH = 4;
/** page_size do Notion (máximo permitido pela API). */
const PAGE_SIZE = 100;

/**
 * Notion adapter via Composio — requer conexão OAuth do member.
 * externalUrl = URL da página/base do Notion (ou o ID cru).
 *
 * Deep-read (runbook Fase 1): busca TODOS os blocos da página com paginação
 * (has_more/next_cursor), RECORRE em containers (toggle, coluna, callout,
 * subpágina, itens de lista aninhados) até MAX_DEPTH, e renderiza child_database
 * como tabela markdown (linhas = páginas da base). Conteúdo é limitado por
 * MAX_BLOCKS pra não estourar custo. Sem conexão → ComposioConnectionMissing.
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

  const memberId = source.createdBy;
  const budget: Budget = { remaining: MAX_BLOCKS };

  // Top-level: falha aqui é erro real (página inexistente / sem acesso).
  const topBlocks = await fetchAllChildren(memberId, pageId, budget, /* topLevel */ true);
  const body =
    topBlocks.length > 0
      ? await renderBlockList(memberId, topBlocks, 0, budget)
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

/** Orçamento de blocos compartilhado em toda a travessia (mutável). */
type Budget = { remaining: number };

/**
 * Tipos de bloco que contêm filhos a serem recorridos. child_page é tratado à
 * parte (vira heading + recursão no corpo da subpágina).
 */
const CONTAINER_TYPES = new Set<string>([
  "toggle",
  "callout",
  "quote",
  "column_list",
  "column",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "synced_block",
  "table",
]);

/**
 * Slugs candidatos do Composio pra consultar linhas de uma base do Notion.
 * O repo só usa NOTION_FETCH_BLOCK_CONTENTS hoje; tentamos os nomes prováveis
 * em ordem e degradamos pro badge de título se nenhum existir no catálogo.
 */
const DB_QUERY_SLUGS = ["NOTION_QUERY_DATABASE", "NOTION_FETCH_DATABASE"];

/**
 * Busca todos os filhos de um bloco/página, paginando até has_more=false ou
 * até o orçamento acabar. topLevel=true propaga falha (erro real); aninhado
 * engole a falha (ramo inacessível não derruba a página inteira).
 */
async function fetchAllChildren(
  memberId: string,
  blockId: string,
  budget: Budget,
  topLevel = false
): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | undefined;
  do {
    const args: Record<string, unknown> = { block_id: blockId, page_size: PAGE_SIZE };
    if (cursor) args.start_cursor = cursor;
    const result = await executeTool(memberId, "NOTION_FETCH_BLOCK_CONTENTS", args);
    if (!result.ok) {
      if (topLevel) {
        throw new Error(`Falha ao buscar página do Notion via Composio: ${result.error}`);
      }
      break;
    }
    const blocks = extractBlocks(result.data);
    all.push(...blocks);
    budget.remaining -= blocks.length;
    cursor = extractNextCursor(result.data);
  } while (cursor && budget.remaining > 0);
  return all;
}

/** Renderiza uma lista de blocos (com recursão nos filhos) em markdown. */
async function renderBlockList(
  memberId: string,
  blocks: any[],
  depth: number,
  budget: Budget
): Promise<string> {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];

  for (const block of blocks) {
    if (budget.remaining <= 0) {
      lines.push(`${indent}… (conteúdo truncado — limite de ${MAX_BLOCKS} blocos)`);
      break;
    }
    const type: string = block?.type;
    if (!type) continue;

    if (type === "child_database") {
      const table = await renderDatabase(memberId, block, budget);
      if (table) lines.push(indentBlock(table, indent));
      continue;
    }

    const md = renderBlock(block);
    if (md) lines.push(indentBlock(md, indent));

    // Recursão: subpágina sempre; demais containers só se has_children.
    const recurse =
      depth < MAX_DEPTH &&
      (type === "child_page" || (block?.has_children && CONTAINER_TYPES.has(type)));
    if (recurse && block?.id) {
      const children = await fetchAllChildren(memberId, block.id, budget);
      if (children.length > 0) {
        const nested = await renderBlockList(memberId, children, depth + 1, budget);
        if (nested) lines.push(nested);
      }
    }
  }

  return lines.join("\n");
}

/** Prefixa cada linha de um bloco markdown com a indentação do nível. */
function indentBlock(md: string, indent: string): string {
  if (!indent) return md;
  return md
    .split("\n")
    .map((l) => indent + l)
    .join("\n");
}

/** Consulta as linhas de uma child_database e renderiza como tabela markdown. */
async function renderDatabase(
  memberId: string,
  block: any,
  budget: Budget
): Promise<string> {
  const dbId: string | undefined = block?.id;
  const title =
    block?.child_database?.title || richText(block?.child_database?.rich_text) || "Base de dados";
  if (!dbId) return `🗃️ **${title}**`;

  let rows: any[] = [];
  for (const slug of DB_QUERY_SLUGS) {
    const result = await executeTool(memberId, slug, {
      database_id: dbId,
      page_size: PAGE_SIZE,
    });
    if (result.ok) {
      rows = extractBlocks(result.data);
      break;
    }
  }
  budget.remaining -= rows.length;

  const table = renderDatabaseRows(rows);
  return table
    ? `**🗃️ ${title}**\n\n${table}`
    : `🗃️ **${title}** (sem linhas acessíveis à integração)`;
}

/** Renderiza um array de páginas (linhas de base) como tabela markdown. */
function renderDatabaseRows(rows: any[]): string {
  if (!rows.length) return "";
  // Ordem de colunas pela 1ª linha; união cobre props que faltem em algumas.
  const cols = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r?.properties ?? {})) cols.add(k);
  }
  const colList = [...cols];
  if (!colList.length) return "";

  const header = `| ${colList.join(" | ")} |`;
  const sep = `| ${colList.map(() => "---").join(" | ")} |`;
  const body = rows
    .map(
      (r) => `| ${colList.map((c) => renderProp(r?.properties?.[c])).join(" | ")} |`
    )
    .join("\n");
  return [header, sep, body].join("\n");
}

/** Achata um valor de propriedade do Notion pra célula de tabela. */
function renderProp(prop: any): string {
  if (!prop) return "";
  const type: string = prop.type;
  const v = prop[type];
  let out = "";
  switch (type) {
    case "title":
    case "rich_text":
      out = richText(v);
      break;
    case "number":
      out = v == null ? "" : String(v);
      break;
    case "select":
    case "status":
      out = v?.name ?? "";
      break;
    case "multi_select":
      out = Array.isArray(v) ? v.map((s: any) => s?.name).filter(Boolean).join(", ") : "";
      break;
    case "date":
      out = v?.start ? (v.end ? `${v.start} → ${v.end}` : v.start) : "";
      break;
    case "checkbox":
      out = v ? "✓" : "✗";
      break;
    case "people":
      out = Array.isArray(v) ? v.map((p: any) => p?.name).filter(Boolean).join(", ") : "";
      break;
    case "url":
    case "email":
    case "phone_number":
      out = v ?? "";
      break;
    case "created_time":
    case "last_edited_time":
      out = v ?? "";
      break;
    case "formula":
      out = v ? (v.string ?? v.number ?? (v.boolean != null ? String(v.boolean) : v.date?.start) ?? "") : "";
      break;
    case "relation":
      out = Array.isArray(v) ? `${v.length} rel.` : "";
      break;
    case "rollup":
      out = v?.array ? `${v.array.length} itens` : (v?.number != null ? String(v.number) : "");
      break;
    default:
      out = richText(v?.rich_text) || "";
  }
  // Célula segura: sem pipe nem quebra de linha.
  return String(out).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

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

/** Cursor de paginação do Notion, se há mais blocos. */
function extractNextCursor(data: unknown): string | undefined {
  const d = data as any;
  if (!d) return undefined;
  const hasMore = d.has_more ?? d.response_data?.has_more ?? d.data?.has_more ?? false;
  const cursor = d.next_cursor ?? d.response_data?.next_cursor ?? d.data?.next_cursor ?? null;
  return hasMore && cursor ? String(cursor) : undefined;
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
      return `### 📄 ${content.title ?? "Subpágina"}`;
    case "child_database":
      return `🗃️ **${content.title ?? "Base de dados"}**`;
    default:
      return text ? text : "";
  }
}
