import { z } from "zod";

export const PrdAcceptanceCriterion = z.object({
  given: z.string().min(1),
  when:  z.string().min(1),
  then:  z.string().min(1),
});

export const PrdJourneyStep = z.object({
  actor: z.string().min(1),
  action: z.string().min(1),
  expectation: z.string().min(1),
});

export const PrdMetric = z.object({
  metric: z.string().min(1),
  baseline: z.string().optional(),
  target: z.string().min(1),
});

export const PrdDependency = z.object({
  prdId: z.string().uuid(),
  kind: z.enum(["blocks","enables","shares-data"]),
});

export const PrdRiskOrAssumption = z.object({
  kind: z.enum(["risk","assumption"]),
  text: z.string().min(1),
  mitigation: z.string().optional(),
});

export const ProposePrdInput = z.object({
  projectId: z.string().uuid(),
  designSessionId: z.string().uuid(),
  moduleId: z.string().uuid().optional(),
  title: z.string().min(3).max(140),
  oneLiner: z.string().min(10).max(200),
  personaIds: z.array(z.string().uuid()).default([]),
  problem: z.string().min(50),
  goal: z.string().min(20),
  userJourney: z.array(PrdJourneyStep).default([]),
  acceptanceCriteria: z.array(PrdAcceptanceCriterion).min(3),
  successMetrics: z.array(PrdMetric).default([]),
  outOfScope: z.array(z.string()).default([]),
  technicalNotes: z.string().default(""),
  risksAndAssumptions: z.array(PrdRiskOrAssumption).default([]),
  sourceCardIds: z.array(z.string()).default([]),
});

export const UpdatePrdInput = ProposePrdInput.partial().extend({
  id: z.string().uuid(),
});

export const ApprovePrdInput = z.object({ id: z.string().uuid() });
export const LinkPrdDependencyInput = z.object({
  fromPrdId: z.string().uuid(),
  toPrdId: z.string().uuid(),
  kind: z.enum(["blocks","enables","shares-data"]),
});
