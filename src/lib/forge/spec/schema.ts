/**
 * Schema for spec.md — the immutable waist between Diamond 1 (Understand) and Diamond 2 (Build).
 *
 * A spec.md contains:
 * - 5 mandatory sections (Problem, Solution, Non-goals, User stories, Success criteria)
 * - 1 optional upstream section (references to DS/PRD/meeting that originated this spec)
 */
import { z } from "zod";

/**
 * Upstream reference: typed link to a Design Session, PRD, meeting, or other artifact
 * that generated this spec.
 */
export const UpstreamRefSchema = z.object({
  type: z.enum(["design-session", "prd", "meeting", "task", "other"]),
  id: z.string().min(1, "Upstream ref ID cannot be empty"),
  url: z.string().url().optional(),
  description: z.string().optional(),
});

export type UpstreamRef = z.infer<typeof UpstreamRefSchema>;

/**
 * User story within a spec (simplified from PRD story format).
 * Each story is a discrete unit of work that can be executed independently (modulo dependencies).
 */
export const SpecStorySchema = z.object({
  id: z.string().min(1, "Story ID cannot be empty"),
  title: z.string().min(1, "Story title cannot be empty"),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).min(1, "At least one acceptance criterion required"),
  estimateMinutes: z.number().int().positive().optional(),
  dependsOn: z.array(z.string()).optional(),
});

export type SpecStory = z.infer<typeof SpecStorySchema>;

/**
 * Success criterion: a measurable outcome that defines "done" for the spec.
 */
export const SuccessCriterionSchema = z.object({
  metric: z.string().min(1, "Metric name cannot be empty"),
  target: z.string().min(1, "Target value cannot be empty"),
  instrument: z.string().min(1, "Instrument (how to measure) cannot be empty"),
});

export type SuccessCriterion = z.infer<typeof SuccessCriterionSchema>;

/**
 * The complete spec.md schema.
 *
 * Section 1: Problem — what user pain are we solving?
 * Section 2: Solution — one-sentence solution statement
 * Section 3: Non-goals — explicit scope boundaries (what we won't do)
 * Section 4: User stories — discrete units of work
 * Section 5: Success criteria — measurable outcomes
 * Section 6 (optional): Upstream — references to artifacts that generated this spec
 */
export const SpecSchema = z.object({
  // Mandatory sections
  problem: z.string().min(50, "Problem section must be at least 50 characters"),
  solution: z.string().min(10, "Solution section must be at least 10 characters").max(500, "Solution should be concise (max 500 chars)"),
  nonGoals: z.array(z.string().min(1)).min(1, "At least one non-goal required"),
  userStories: z.array(SpecStorySchema).min(1, "At least one user story required"),
  successCriteria: z.array(SuccessCriterionSchema).min(1, "At least one success criterion required"),

  // Optional section
  upstream: z.array(UpstreamRefSchema).optional(),
});

export type Spec = z.infer<typeof SpecSchema>;
