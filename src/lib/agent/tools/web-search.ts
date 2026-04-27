import { tool } from "ai";
import { z } from "zod";
import { tavily, type TavilyClient } from "@tavily/core";
import { db } from "@/lib/db";

let client: TavilyClient | null = null;
function getClient(): TavilyClient {
  if (!client) {
    client = tavily({ apiKey: process.env.TAVILY_API_KEY! });
  }
  return client;
}

interface SearchSource {
  title: string;
  url: string;
  snippet?: string;
}

/**
 * Persists a research entry. Fire-and-forget — failure logs but does NOT
 * break the tool call. The LLM still gets the result; auto-capture is best-effort.
 */
async function captureResearch(
  sessionId: string,
  projectId: string,
  query: string,
  summary: string,
  sources: SearchSource[],
): Promise<void> {
  try {
    const { error } = await db()
      .from("DesignSessionResearch")
      .insert({
        sessionId,
        projectId,
        query,
        summary,
        sources: sources as never,
      });
    if (error) {
      console.error("[research auto-capture] insert failed:", error.message);
    }
  } catch (e) {
    console.error("[research auto-capture] threw:", e);
  }
}

/**
 * Web search tool powered by Tavily. Auto-captures every successful search
 * into DesignSessionResearch — provenance never depends on the LLM remembering.
 *
 * Factory pattern: closes over sessionId + projectId so the tool can persist
 * without needing them as input args (which would let the LLM lie about scope).
 */
export function createWebSearchTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Busca na internet para pesquisa de mercado, benchmark, análise de concorrentes, referências de design, ou qualquer informação pública relevante para o projeto. Resultados são automaticamente registrados no log de pesquisas da session.",
    inputSchema: z.object({
      query: z.string().describe("Termo de busca em linguagem natural"),
      maxResults: z
        .number()
        .min(1)
        .max(10)
        .default(5)
        .describe("Número máximo de resultados (1-10)"),
    }),
    execute: async ({ query, maxResults }) => {
      const response = await getClient().search(query, {
        maxResults: maxResults ?? 5,
        searchDepth: "basic",
        includeAnswer: true,
      });

      const sources: SearchSource[] = response.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 500),
      }));

      const summary =
        response.answer ?? response.results.map((r) => r.title).join("; ");

      // Fire-and-forget; do NOT await before returning to LLM.
      void captureResearch(sessionId, projectId, query, summary, sources);

      return {
        answer: response.answer,
        results: sources,
      };
    },
  });
}
