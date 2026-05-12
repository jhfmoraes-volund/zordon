export const STEP_KEYS = [
  "pre_work",
  "product_vision",
  "scope_definition",
  "personas_journeys",
  "brainstorm",
  "risks_gaps",
  "prioritization",
  "technical_specs",
  "hypotheses",
] as const;

export type StepKey = (typeof STEP_KEYS)[number];

export function isStepKey(value: unknown): value is StepKey {
  return typeof value === "string" && (STEP_KEYS as readonly string[]).includes(value);
}

export type StickyNote = {
  id: string;
  sessionId: string;
  stepKey: StepKey;
  text: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};
