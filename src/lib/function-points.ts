/**
 * Auto-suggest Function Points from scope × complexity.
 * Pure module — safe to import from client and server.
 *
 * The default matrix below is the seed value. The tuned matrix lives in
 * AgentConfig (key: "fp_matrix") and is loaded server-side via
 * `loadFpMatrix` in `src/lib/agent/config.ts`.
 */

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

/** Active statuses that count toward capacity allocation */
export const ACTIVE_STATUSES = [
  "todo",
  "in_progress",
  "review",
] as const;
