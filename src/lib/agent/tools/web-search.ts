import { tool } from "ai";
import { z } from "zod";
import { tavily } from "@tavily/core";

const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });

/**
 * Web search tool powered by Tavily.
 * Enables the agent to search the internet for benchmark,
 * market research, competitor analysis, etc.
 */
export const webSearchTool = tool({
  description:
    "Busca na internet para pesquisa de mercado, benchmark, análise de concorrentes, referências de design, ou qualquer informação pública relevante para o projeto.",
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
    const response = await client.search(query, {
      maxResults: maxResults ?? 5,
      searchDepth: "basic",
      includeAnswer: true,
    });

    return {
      answer: response.answer,
      results: response.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 500),
      })),
    };
  },
});
