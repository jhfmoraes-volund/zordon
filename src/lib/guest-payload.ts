import "server-only";

/**
 * Filtros de payload pra guests — defesa em profundidade.
 *
 * Pontos de Função são considerados informação interna (capacidade contratual,
 * alocação por membro, sugestão de PFV por task). Cliente externo (guest) nunca
 * vê. A UI também esconde — mas o backend zera antes de mandar pra garantir
 * que um componente novo não vaze por esquecimento.
 *
 * Uso: chama `stripFP*` quando o ator é guest, passando o payload de saída.
 * Quando não é guest, devolve o payload original sem alocação.
 */

import { getEffectiveAccessLevel } from "./dal";
import { isGuest } from "./dal";

/** True se o ator atual é guest (acesso efetivo). Cacheado via dal. */
export async function isGuestActor(): Promise<boolean> {
  const level = await getEffectiveAccessLevel();
  return isGuest(level);
}

type WithFP = Record<string, unknown> & {
  functionPoints?: unknown;
  fpAllocation?: unknown;
  fpCapacity?: unknown;
};

/**
 * Zera campos PFV em um objeto. Não muta — devolve cópia rasa.
 * Use em payloads de saída de Task/Member/ProjectMember.
 */
export function stripFPFields<T extends WithFP>(obj: T): T {
  const out = { ...obj };
  if ("functionPoints" in out) out.functionPoints = null;
  if ("fpAllocation" in out) out.fpAllocation = null;
  if ("fpCapacity" in out) out.fpCapacity = null;
  return out;
}

/** Aplica `stripFPFields` em uma lista. */
export function stripFPList<T extends WithFP>(list: T[]): T[] {
  return list.map(stripFPFields);
}

/**
 * Helper de uma linha: se `isGuest=true`, retorna versão sem PFV; caso contrário,
 * devolve o objeto intacto.
 */
export function maskFPIfGuest<T extends WithFP>(obj: T, isGuest: boolean): T {
  return isGuest ? stripFPFields(obj) : obj;
}

/** Versão lista do `maskFPIfGuest`. */
export function maskFPListIfGuest<T extends WithFP>(
  list: T[],
  isGuest: boolean,
): T[] {
  return isGuest ? stripFPList(list) : list;
}
