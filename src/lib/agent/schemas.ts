import { z } from "zod";

// ─── Shared sub-schemas ──────────────────────────────────

export const journeyStepSchema = z.object({
  id: z.string(),
  description: z.string().min(1),
  painOrGain: z.string().min(1),
});

// ─── Step schemas ────────────────────────────────────────

export const personaSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  context: z.string().min(1),
  asIsSteps: z.array(journeyStepSchema).min(1),
  toBeSteps: z.array(journeyStepSchema).min(1),
});

export const solutionSchema = z.object({
  title: z.string().min(1),
  howItSolves: z.string().min(1),
  targetPersona: z.string().min(1),
  keyScreens: z.string().optional(),
  userFlows: z.string().optional(),
  painPointRef: z.string().optional(),
  technicalNotes: z.string().optional(),
  archived: z.boolean().optional(),
});

export const hypothesisSchema = z.object({
  hypothesis: z.string().min(1),
  indicator: z.string().min(1),
  target: z.string().min(1),
  expectedResult: z.string().min(1),
  evidence: z.string().optional(),
});

export const prioritizationItemSchema = solutionSchema.extend({
  bucket: z.enum(["mvp", "next", "out"]),
});

export const integrationSchema = z.object({
  text: z.string().min(1),
});

export const ruleSchema = z.object({
  text: z.string().min(1),
});

// ─── Derived types (UI imports these) ────────────────────

export type JourneyStep = z.infer<typeof journeyStepSchema>;
export type Persona = z.infer<typeof personaSchema> & { id: string };
export type SolutionCard = z.infer<typeof solutionSchema> & { id: string };
export type Hypothesis = z.infer<typeof hypothesisSchema> & { id: string };
export type PrioritizationItem = z.infer<typeof prioritizationItemSchema> & { id: string };

// ─── Schema doc generator (for prompt injection) ────────

const STEP_SCHEMA_DOCS: Record<string, string> = {
  product_vision:
    "Campos texto: problem, whoSuffers, consequences, successVision, impactMetrics",
  scope_definition: [
    'Quatro arrays paralelos com items {id, text}:',
    '"is" (o que o produto E em essencia),',
    '"isNot" (o que o produto NAO E — clarifica mal-entendidos),',
    '"does" (o que o produto FAZ — capacidades),',
    '"doesNot" (o que o produto NAO FAZ — fronteiras explicitas).',
  ].join(" "),
  personas_journeys: [
    'Array "personas", cada persona tem: id, name, role, context,',
    "asIsSteps (array de {id, description, painOrGain}),",
    "toBeSteps (idem)",
  ].join(" "),
  brainstorm: [
    'Array "solutions", cada solucao tem: id, title, howItSolves, targetPersona,',
    "keyScreens (opcional), userFlows (opcional),",
    "painPointRef (opcional), technicalNotes (opcional)",
  ].join(" "),
  prioritization: [
    'Array "items", cada item tem: id, title, howItSolves, targetPersona,',
    "keyScreens, userFlows, painPointRef, technicalNotes,",
    'bucket ("mvp" | "next" | "out")',
  ].join(" "),
  technical_specs: [
    "Campos texto: stack, performance, notes",
    "Arrays de items: integrations ({id, text}), rules ({id, text})",
  ].join("\n"),
  hypotheses: [
    'Array "hypotheses", cada hipotese tem: id, hypothesis, indicator,',
    "target, expectedResult, evidence",
  ].join(" "),
};

/**
 * Generates the "data structure per step" section for the system prompt.
 * Single source of truth — kept in sync with the Zod schemas above.
 */
export function generateSchemaDocsForPrompt(): string {
  const lines = Object.entries(STEP_SCHEMA_DOCS).map(
    ([key, doc]) => `### ${key}\n${doc}`
  );
  return lines.join("\n\n");
}
