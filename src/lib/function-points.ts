/**
 * Auto-suggest PFV (Ponto de Função Volund) from scope × complexity.
 * Pure module — safe to import from client and server.
 *
 * The default matrix below is the seed value. The tuned matrix lives in
 * AgentConfig (key: "fp_matrix") and is loaded server-side via
 * `loadFpMatrix` in `src/lib/agent/config.ts`.
 */

/**
 * Nome canônico da unidade, exibido ao usuário: **PFV** (Ponto de Função Volund).
 *
 * Só o *display* usa este nome. Identificadores internos seguem `functionPoints`
 * / `fp*` / coluna `"functionPoints"` — renomeá-los seria churn sem valor (ninguém
 * os lê). Para rotular a unidade na UI/prompt, referencie `PFV` ou `formatPfv`.
 */
export const PFV = {
  abbr: "PFV",
  full: "Ponto de Função Volund",
  plural: "Pontos de Função Volund",
} as const;

export type FpMatrix = Record<string, Record<string, number>>;

export const FP_MATRIX_DEFAULT: FpMatrix = {
  micro:  { trivial: 3, low: 4,  medium: 5,  high: 7  },
  small:  { trivial: 4, low: 5,  medium: 7,  high: 10 },
  medium: { trivial: 5, low: 7,  medium: 10, high: 15 },
  large:  { trivial: 7, low: 10, medium: 15, high: 21 },
};

export function suggestFunctionPoints(
  scope: string,
  complexity: string,
  matrix: FpMatrix = FP_MATRIX_DEFAULT,
): number {
  return matrix[scope]?.[complexity] ?? 7;
}

export function isFpMatrix(value: unknown): value is FpMatrix {
  if (!value || typeof value !== "object") return false;
  for (const row of Object.values(value as Record<string, unknown>)) {
    if (!row || typeof row !== "object") return false;
    for (const cell of Object.values(row as Record<string, unknown>)) {
      if (typeof cell !== "number") return false;
    }
  }
  return true;
}

/** Open statuses — tasks que contam como carga em aberto (excl. done e backlog). */
export const OPEN_STATUSES = [
  "todo",
  "in_progress",
  "blocked",
  "review",
  "changes_requested",
] as const;
