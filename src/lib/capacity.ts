/**
 * Suggested-capacity model.
 *
 * Capacity is the PFV/sprint a member can deliver. We compute a
 * recommendation from 3 inputs:
 *
 *   capacity = baseRole × seniorityMult × dedicationFactor
 *
 * Senior at 100% dedication = 500 PFV/sprint (the baseline observed in
 * actual team throughput). Other seniority levels scale ±15% per step.
 */

import type { Role } from "./roles";

// ─── Tunable tables ─────────────────────────────────────

/** Base PFV/sprint for a senior, full-time member of each role. */
export const ROLE_BASE: Record<Role, number> = {
  "product-builder": 500,
  "principal-engineer": 500,
  "pm": 500,
  "head-ops": 500,
  "ceo": 500,
  "cro": 500,
  "guest": 0, // external, never carries tasks
};

export type Seniority = "junior" | "mid" | "senior" | "principal";

export const SENIORITY_LABELS: Record<Seniority, string> = {
  junior: "Junior",
  mid: "Pleno",
  senior: "Sênior",
  principal: "Principal",
};

export const SENIORITY_ORDER: Seniority[] = ["junior", "mid", "senior", "principal"];

/** Throughput multiplier by maturity level. Senior is the baseline (1.0). */
export const SENIORITY_MULTIPLIER: Record<Seniority, number> = {
  junior: 0.70,
  mid: 0.85,
  senior: 1.00,
  principal: 1.15,
};

// ─── Calculation ────────────────────────────────────────

export type CapacityInputs = {
  role: string;
  seniority: Seniority | null;
  /** 0-100, percentage of a full-time week */
  dedicationPercent: number;
};

export type CapacityBreakdown = {
  base: number;
  seniorityMult: number;
  dedication: number;
  /** Final suggested PFV/sprint (rounded). */
  suggested: number;
};

export function computeSuggestedCapacity(inputs: CapacityInputs): CapacityBreakdown {
  const base = ROLE_BASE[inputs.role as Role] ?? 0;
  const seniority = inputs.seniority ?? "mid";
  const seniorityMult = SENIORITY_MULTIPLIER[seniority];
  const dedication = Math.max(0, Math.min(100, inputs.dedicationPercent)) / 100;

  const suggested = Math.round(base * seniorityMult * dedication);
  return { base, seniorityMult, dedication, suggested };
}

/** Human-friendly formula breakdown for the UI tooltip / debug. */
export function formulaText(b: CapacityBreakdown): string {
  return [
    `${b.base} (base)`,
    `× ${b.seniorityMult.toFixed(2)} senioridade`,
    `× ${Math.round(b.dedication * 100)}% dedicação`,
  ].join(" ");
}
