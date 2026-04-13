/**
 * Auto-suggest Function Points from scope × complexity.
 * Based on IFPUG weight ranges adapted for task-level estimation.
 */

const FP_MATRIX: Record<string, Record<string, number>> = {
  micro:  { trivial: 3, low: 4,  medium: 5,  high: 7  },
  small:  { trivial: 4, low: 5,  medium: 7,  high: 10 },
  medium: { trivial: 5, low: 7,  medium: 10, high: 15 },
  large:  { trivial: 7, low: 10, medium: 15, high: 21 },
};

export function suggestFunctionPoints(scope: string, complexity: string): number {
  return FP_MATRIX[scope]?.[complexity] ?? 7;
}

/** Active statuses that count toward capacity allocation */
export const ACTIVE_STATUSES = [
  "todo",
  "in_progress",
  "review",
  "changes_requested",
] as const;
