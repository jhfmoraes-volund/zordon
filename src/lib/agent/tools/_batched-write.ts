/**
 * defineBatchedWriteTool — fabrica uma `tool({...})` que aceita batch homogêneo
 * por action: `{ action, items: [...] }`.
 *
 * Motivação: tools tipo write_brainstorm eram chamadas N vezes em série pelo
 * modelo (1 step por solução) porque cada call mexia em 1 item. Cada step
 * paga prompt cheio mesmo com cache hit alto. Empacotando N items em 1 call,
 * o turno cai de N+1 steps pra ~2.
 *
 * Garantias:
 * - Schema é `z.discriminatedUnion("action", [{ action: literal, items: [item] }, ...])`.
 * - Execução: paralela por default (Promise.allSettled). Actions com side-effect
 *   ordenado (ex: orderIndex sequencial em create) devem declarar
 *   `sequential: true`.
 * - Erro per-item: handler retorna `{ ok: true, ... }` ou `{ ok: false, error, code? }`.
 *   Exceções viram `{ ok: false, error, code: "exception" }`. Um item ruim não
 *   afunda os demais.
 * - Resposta agregada: `{ ok, action, results, summary }`.
 *
 * O helper cobre o padrão CRUD 1:N. Tools com shape esquisito (joins, RPCs
 * heterogêneas, upsert 1:1) continuam usando `tool()` direto.
 */

import { tool } from "ai";
import { z } from "zod";

export type ActionItemResult =
  | { ok: true; [k: string]: unknown }
  | { ok: false; error: string; code?: string; [k: string]: unknown };

export type ActionHandler<TItem> = (
  item: TItem,
  ctx: { index: number; total: number },
) => Promise<ActionItemResult>;

export type ActionDef<TItem> = {
  /** Schema do item individual (sem o envelope `items: []`). */
  itemSchema: z.ZodType<TItem>;
  /** Executor por item. Deve retornar `{ ok, ... }` em vez de lançar quando o erro é esperado. */
  handler: ActionHandler<TItem>;
  /**
   * Se true, items rodam em ordem (útil quando há dependência tipo orderIndex
   * sequencial). Default: false (Promise.allSettled paralelo).
   */
  sequential?: boolean;
  /** Limite de items por call. Default: 50. Protege contra prompts absurdos. */
  maxItems?: number;
};

export type BatchedWriteToolOptions = {
  description: string;
  /** Map de actions disponíveis. A key vira o literal de `action`. */
  actions: Record<string, ActionDef<unknown>>;
};

type BatchResult = {
  ok: boolean;
  action: string;
  results: ActionItemResult[];
  summary: { total: number; succeeded: number; failed: number };
};

/**
 * Constrói uma tool batched. Cada action vira uma variant do union:
 *   { action: "<key>", items: [<itemSchema>, ...] }
 *
 * A tool retornada executa os items conforme a `sequential` flag da action.
 */
export function defineBatchedWriteTool(opts: BatchedWriteToolOptions) {
  const actionKeys = Object.keys(opts.actions);
  if (actionKeys.length === 0) {
    throw new Error("defineBatchedWriteTool: actions vazio");
  }

  // Monta um discriminatedUnion onde cada variant é { action: literal, items: [...] }.
  const variants = actionKeys.map((key) => {
    const def = opts.actions[key];
    const max = def.maxItems ?? 50;
    return z.object({
      action: z.literal(key),
      items: z.array(def.itemSchema).min(1).max(max),
    });
  });

  // z.discriminatedUnion exige ao menos 2 variants; pra 1 só, usa o objeto direto.
  // Os tipos da tupla de discriminatedUnion são chatos com refs dinâmicas; o
  // cast pra `any` aqui é local e isolado — a validação runtime continua estrita.
  const inputSchema =
    variants.length === 1
      ? variants[0]
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        z.discriminatedUnion("action", variants as any);

  return tool({
    description: opts.description,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: inputSchema as any,
    execute: async (raw): Promise<BatchResult> => {
      const input = raw as { action: string; items: unknown[] };
      const def = opts.actions[input.action];
      if (!def) {
        throw new Error(`action "${input.action}" não registrada`);
      }
      const items = input.items;
      const total = items.length;

      const runOne = async (item: unknown, index: number): Promise<ActionItemResult> => {
        try {
          return await def.handler(item, { index, total });
        } catch (err) {
          return {
            ok: false,
            code: "exception",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      };

      const results: ActionItemResult[] = def.sequential
        ? await runSequential(items, runOne)
        : await runParallel(items, runOne);

      const succeeded = results.filter((r) => r.ok).length;
      const failed = total - succeeded;

      return {
        ok: failed === 0,
        action: input.action,
        results,
        summary: { total, succeeded, failed },
      };
    },
  });
}

async function runSequential(
  items: unknown[],
  runOne: (item: unknown, index: number) => Promise<ActionItemResult>,
): Promise<ActionItemResult[]> {
  const out: ActionItemResult[] = [];
  for (let i = 0; i < items.length; i++) {
    out.push(await runOne(items[i], i));
  }
  return out;
}

async function runParallel(
  items: unknown[],
  runOne: (item: unknown, index: number) => Promise<ActionItemResult>,
): Promise<ActionItemResult[]> {
  const settled = await Promise.allSettled(items.map((it, i) => runOne(it, i)));
  return settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          ok: false,
          code: "exception",
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
          index: i,
        },
  );
}
