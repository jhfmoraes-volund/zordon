// structured-source — tool factories pra querying agêntico de insumos
// estruturados (JSON/CSV). Camada fina: resolve o ContextSource no DB, detecta
// o formato e delega o SQL pro engine (structured-query.ts, DuckDB in-process).
//
// Por quê: um ContextSource estruturado grande (ex: activity report de 3MB
// importado como `document`) NÃO cabe no contexto do chat — despejá-lo via
// read_context_source estoura a janela. Em vez de ler o blob, a Vitoria
// CONSULTA: `describe_structured_source` devolve o shape e
// `query_structured_source` roda SQL read-only orçado + self-correcting.
//
// ONDE roda: este execute roda no PROCESSO DO APP (Next.js). O daemon expõe a
// tool via MCP mas PROXIA a execução pro tool router (/api/agents/tools/*),
// então o DuckDB e o arquivo materializado vivem aqui, não no daemon. Ver
// runbook docs/runbooks/structured-context-sources-runbook.md §4.
import { tool, type Tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { detectStructuredFormat } from "./structured-detect";
import { describeStructured, queryStructured } from "./structured-query";

export { detectStructuredFormat } from "./structured-detect";
export type { StructuredFormat } from "./structured-detect";

async function fetchSource(sourceId: string): Promise<{
  id: string;
  kind: string | null;
  title: string | null;
  fullText: string | null;
} | null> {
  const { data, error } = await db()
    .from("ContextSource")
    .select("id, kind, title, fullText")
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const NOT_STRUCTURED_MSG =
  "Esta fonte não é estruturada (JSON/CSV consultável) — use read_context_source.";

export function createDescribeStructuredSourceTool(): Tool {
  return tool({
    description:
      "Inspeciona o SHAPE de uma fonte de contexto ESTRUTURADA (JSON/CSV grande) " +
      "sem ler o conteúdo: colunas, tipos e contagem de linhas. Chame ANTES de " +
      "query_structured_source pra saber o que dá pra consultar. Para insumos " +
      "estruturados grandes, use describe+query em vez de read_context_source " +
      "(que não devolve o blob, só um stub apontando pra cá).",
    inputSchema: z.object({
      sourceId: z.string().uuid().describe("ID do ContextSource estruturado"),
    }),
    execute: async ({ sourceId }) => {
      const source = await fetchSource(sourceId);
      if (!source) return { ok: false, error: "ContextSource não encontrado" };
      const format = detectStructuredFormat(source);
      if (!format) return { ok: false, error: NOT_STRUCTURED_MSG };
      try {
        return await describeStructured(sourceId, format, source.fullText ?? "");
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

export function createQueryStructuredSourceTool(): Tool {
  return tool({
    description:
      "Consulta uma fonte ESTRUTURADA (JSON/CSV) via SQL read-only (DuckDB). A " +
      "fonte está exposta como a tabela `src`. Resultado limitado a 200 linhas / " +
      "30k chars (pagine com LIMIT/OFFSET). Ancore decisões em agregados " +
      "(COUNT/SUM/GROUP BY), nunca em leitura de linhas cruas. Em erro de SQL, " +
      "devolve o schema pra você reescrever. Rode describe_structured_source antes.",
    inputSchema: z.object({
      sourceId: z.string().uuid().describe("ID do ContextSource estruturado"),
      sql: z
        .string()
        .describe(
          "SQL SELECT read-only referenciando a tabela `src`. Ex: " +
            "SELECT contributor, COUNT(*) AS commits FROM src GROUP BY contributor ORDER BY commits DESC",
        ),
    }),
    execute: async ({ sourceId, sql }) => {
      const source = await fetchSource(sourceId);
      if (!source) return { ok: false, error: "ContextSource não encontrado" };
      const format = detectStructuredFormat(source);
      if (!format) return { ok: false, error: NOT_STRUCTURED_MSG };
      return queryStructured(sourceId, format, source.fullText ?? "", sql);
    },
  });
}
