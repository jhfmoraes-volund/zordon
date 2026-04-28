/**
 * search_doc — busca em texto extraido de arquivos persistidos no pre_work.
 *
 * Estrategia: Vitor recebe ate 30k+ tokens de doc no turno 1 (ou via upload),
 * e a atencao do modelo dilui valores especificos (tabelas, faixas, limites)
 * que ficam no meio do contexto. Esta tool permite re-busca sob demanda —
 * Vitor chama com query e recebe trechos exatos com contexto.
 *
 * Input: { query, maxResults? }
 * Output: { ok, matches: [{ file, line, snippet, score }] }
 *
 * Algoritmo: substring match case-insensitive. Score = numero de termos da query
 * que aparecem no snippet (dividido pelo total de termos). Trechos sobrepostos sao
 * deduplicados — se duas matches estao a < 5 linhas uma da outra no mesmo arquivo,
 * sao mescladas em uma janela maior.
 */

import { tool } from "ai";
import { z } from "zod";
import { getStepData } from "../context";

interface PreWorkFile {
  id: string;
  name: string;
  size: number;
  type: string;
  extractedText: string;
}

interface RawMatch {
  file: string;
  line: number;
  snippet: string;
  score: number;
}

const SNIPPET_BEFORE = 3;
const SNIPPET_AFTER = 8;
const MERGE_GAP = 5;

function splitTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,;.()/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function search(file: PreWorkFile, terms: string[]): RawMatch[] {
  const lines = file.extractedText.split("\n");
  const lower = lines.map((l) => l.toLowerCase());
  const matches: RawMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const hits = terms.filter((t) => lower[i].includes(t)).length;
    if (hits === 0) continue;

    const start = Math.max(0, i - SNIPPET_BEFORE);
    const end = Math.min(lines.length, i + SNIPPET_AFTER + 1);
    const snippet = lines.slice(start, end).join("\n");

    matches.push({
      file: file.name,
      line: i + 1,
      snippet,
      score: hits / terms.length,
    });
  }

  return matches;
}

function mergeOverlapping(matches: RawMatch[]): RawMatch[] {
  if (matches.length <= 1) return matches;
  const sorted = [...matches].sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
  const merged: RawMatch[] = [];
  for (const m of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.file === m.file && m.line - last.line <= MERGE_GAP) {
      last.score = Math.max(last.score, m.score);
      continue;
    }
    merged.push({ ...m });
  }
  return merged;
}

export function createSearchDocTool(sessionId: string) {
  return tool({
    description:
      "Busca trechos literais nos documentos persistidos no pre_work. " +
      "Use SEMPRE que precisar verificar valor especifico (numero, faixa, prazo, percentual, regra com excecao) " +
      "antes de cravar em scope/risks/brainstorm/etc. Tambem use quando o usuario perguntar 'o que diz o doc sobre X'. " +
      "Nunca afirme valor citando 'os docs dizem' sem ter chamado esta tool ou get_step_data antes — sua memoria do doc e fraca pra detalhes. " +
      "Query suporta multiplos termos (separa por espaco). Retorna trechos com 3 linhas antes + 8 depois do match, ordenados por relevancia.",
    inputSchema: z.object({
      query: z
        .string()
        .min(2)
        .describe(
          "Termo(s) de busca. Multiplos termos sao tratados como AND parcial — quanto mais termos batem, maior o score. Ex: 'M_horario noturno', 'cap 2x multiplicador', 'aceite tacito 48h'.",
        ),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(15)
        .default(5)
        .describe("Numero maximo de trechos a retornar (default 5, max 15)."),
    }),
    execute: async ({
      query,
      maxResults,
    }: {
      query: string;
      maxResults: number;
    }) => {
      const data = await getStepData(sessionId, "pre_work");
      const files = (data.files as PreWorkFile[]) || [];

      if (files.length === 0) {
        return {
          ok: false,
          error:
            "Nenhum arquivo persistido no pre_work. Use get_step_data('pre_work') pra confirmar — pode ser que o doc nao tenha sido feito upload ou a sessao esteja vazia.",
        };
      }

      const terms = splitTerms(query);
      if (terms.length === 0) {
        return {
          ok: false,
          error: "Query sem termos uteis (>=2 chars cada). Tente algo mais especifico.",
        };
      }

      const allMatches = files.flatMap((f) => search(f, terms));
      if (allMatches.length === 0) {
        return {
          ok: true,
          matches: [],
          hint: `Nenhum match para '${query}'. Termos buscados: ${terms.join(", ")}. Tente sinonimos ou termos parciais.`,
        };
      }

      const merged = mergeOverlapping(allMatches);
      merged.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
      const top = merged.slice(0, maxResults);

      return {
        ok: true,
        query,
        terms,
        totalMatches: allMatches.length,
        returned: top.length,
        matches: top.map((m) => ({
          file: m.file,
          line: m.line,
          score: Math.round(m.score * 100) / 100,
          snippet: m.snippet,
        })),
      };
    },
  });
}
