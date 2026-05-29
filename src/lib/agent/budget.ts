/**
 * Sub-agent budget tracker — guard rails contra runaway de telemetria de
 * agentes. Cap de chamadas por sessão (keyed por threadId) mantido in-memory.
 *
 * Limites:
 *  - maxSubAgentCalls: cap duro de chamadas extract/enrich/estimate por
 *    sessão. Atingiu → tool retorna erro estruturado pro modelo, que
 *    decide o que fazer (default: pedir aprovação do PM pra elevar).
 *
 * Cap de custo (USD) não é enforced ainda — vai entrar quando o painel
 * /admin/agent-usage gerar dados sobre custo real por sessão. Por ora a
 * telemetria mostra, a decisão de cortar fica no humano.
 *
 * Multi-instância: cada process tem seu Map. Serverless cold-start zera.
 * Aceitável pro MVP porque uma planning costuma cair na mesma instância
 * durante sua duração. Migrar pra Redis se virar dor.
 */

const DEFAULT_MAX_SUB_AGENT_CALLS = 20;

type Counter = {
  calls: number;
  startedAt: number;
};

const COUNTERS = new Map<string, Counter>();

export type BudgetCheckResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: string; calls: number; cap: number };

/**
 * Verifica + incrementa contagem antes de uma chamada de sub-agente.
 * Atomic: se exceder o cap, NÃO incrementa (sub-agente não roda).
 */
export function reserveSubAgentCall(
  threadId: string,
  opts: { cap?: number } = {},
): BudgetCheckResult {
  const cap = opts.cap ?? DEFAULT_MAX_SUB_AGENT_CALLS;
  const counter = COUNTERS.get(threadId) ?? { calls: 0, startedAt: Date.now() };

  if (counter.calls >= cap) {
    return {
      ok: false,
      reason: `Budget de sub-agentes atingido (${counter.calls}/${cap} chamadas nesta sessão). Continue com tools de leitura ou peça aprovação do PM no chat pra elevar o cap.`,
      calls: counter.calls,
      cap,
    };
  }

  counter.calls += 1;
  COUNTERS.set(threadId, counter);
  return { ok: true, remaining: cap - counter.calls };
}

/** Útil pra debug/painel: estado atual sem incrementar. */
export function peekSubAgentBudget(
  threadId: string,
  opts: { cap?: number } = {},
): { calls: number; cap: number; remaining: number } {
  const cap = opts.cap ?? DEFAULT_MAX_SUB_AGENT_CALLS;
  const counter = COUNTERS.get(threadId) ?? { calls: 0, startedAt: Date.now() };
  return { calls: counter.calls, cap, remaining: Math.max(0, cap - counter.calls) };
}

/** Reset manual — usado em testes ou quando o PM pede pra "zerar". */
export function resetSubAgentBudget(threadId: string): void {
  COUNTERS.delete(threadId);
}
