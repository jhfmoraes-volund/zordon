/**
 * Suggested-capacity model.
 *
 * Capacity is the FP/sprint a member can deliver. We compute a
 * recommendation from 4 inputs:
 *
 *   capacity = baseRole × seniorityMult × dedicationFactor × externalFactor
 *
 * The result is a number; the admin can apply it as Member.fpCapacity
 * (which stays the source of truth used everywhere else) or override
 * manually when reality differs.
 */

import type { Role } from "./roles";

// ─── Tunable tables ─────────────────────────────────────

/** Base FP/sprint for a "mid", full-time, internal member of each role. */
export const ROLE_BASE: Record<Role, number> = {
  "product-builder": 90,
  "principal-engineer": 40,
  "pm": 35,
  "head-ops": 0, // strategic, doesn't carry tasks
  "ceo": 0,
};

export type Seniority = "junior" | "mid" | "senior" | "principal";

export const SENIORITY_LABELS: Record<Seniority, string> = {
  junior: "Junior",
  mid: "Pleno",
  senior: "Sênior",
  principal: "Principal",
};

export const SENIORITY_ORDER: Seniority[] = ["junior", "mid", "senior", "principal"];

/** Throughput multiplier by maturity level. */
export const SENIORITY_MULTIPLIER: Record<Seniority, number> = {
  junior: 0.7,
  mid: 1.0,
  senior: 1.2,
  principal: 1.4,
};

/** Penalty when the member is external (cedido — extra integration overhead). */
export const EXTERNAL_FACTOR = 0.9;

// ─── Calculation ────────────────────────────────────────

export type CapacityInputs = {
  role: string;
  seniority: Seniority | null;
  /** 0-100, percentage of a full-time week */
  dedicationPercent: number;
  isExternal: boolean;
};

export type CapacityBreakdown = {
  base: number;
  seniorityMult: number;
  dedication: number;
  externalMult: number;
  /** Final suggested FP/sprint (rounded). */
  suggested: number;
};

export function computeSuggestedCapacity(inputs: CapacityInputs): CapacityBreakdown {
  const base = ROLE_BASE[inputs.role as Role] ?? 0;
  const seniority = inputs.seniority ?? "mid";
  const seniorityMult = SENIORITY_MULTIPLIER[seniority];
  const dedication = Math.max(0, Math.min(100, inputs.dedicationPercent)) / 100;
  const externalMult = inputs.isExternal ? EXTERNAL_FACTOR : 1.0;

  const suggested = Math.round(base * seniorityMult * dedication * externalMult);
  return { base, seniorityMult, dedication, externalMult, suggested };
}

/** Human-friendly formula breakdown for the UI tooltip / debug. */
export function formulaText(b: CapacityBreakdown): string {
  const parts = [
    `${b.base} (base)`,
    `× ${b.seniorityMult.toFixed(1)} senioridade`,
    `× ${Math.round(b.dedication * 100)}% dedicação`,
  ];
  if (b.externalMult !== 1) parts.push(`× ${b.externalMult.toFixed(2)} externo`);
  return parts.join(" ");
}
