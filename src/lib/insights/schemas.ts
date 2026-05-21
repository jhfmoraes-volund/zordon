import { z } from "zod";

// Schemas are deliberately minimal. We tried adding maxLength/maxItems/format
// constraints; OpenRouter routes some requests to Amazon Bedrock, whose
// validator rejects features that Anthropic's native API accepts. We
// compensate by stating the limits in the prompt and re-validating on parse.
// See supabase/functions/run-alpha-insights/schemas.ts (mirror).

export const HEALTH_LEVELS = ["healthy", "watch", "at_risk", "critical"] as const;
export type HealthLevel = (typeof HEALTH_LEVELS)[number];
export const healthSchema = z.enum(HEALTH_LEVELS);

export const relationalSignalSchema = z.object({
  signal: z.string().min(1),
  evidence: z.string().min(1),
  meetingId: z.string().uuid().optional(),
});

export const relationalWatchSchema = z.object({
  point: z.string().min(1),
  why: z.string().min(1),
});

export const relationalAnalysisSchema = z.object({
  health: healthSchema,
  summary: z.string().min(1),
  signals: z.array(relationalSignalSchema),
  watch: z.array(relationalWatchSchema),
});

export type RelationalSignal = z.infer<typeof relationalSignalSchema>;
export type RelationalWatch = z.infer<typeof relationalWatchSchema>;
export type RelationalAnalysis = z.infer<typeof relationalAnalysisSchema>;

export const technicalRiskSchema = z.object({
  risk: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  evidence: z.string().min(1),
});

export const technicalWatchSchema = z.object({
  metric: z.string().min(1),
  value: z.string().min(1),
  why: z.string().min(1),
});

export const technicalAnalysisSchema = z.object({
  health: healthSchema,
  summary: z.string().min(1),
  risks: z.array(technicalRiskSchema),
  watch: z.array(technicalWatchSchema),
});

export type TechnicalRisk = z.infer<typeof technicalRiskSchema>;
export type TechnicalWatch = z.infer<typeof technicalWatchSchema>;
export type TechnicalAnalysis = z.infer<typeof technicalAnalysisSchema>;
