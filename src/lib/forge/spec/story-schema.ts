/**
 * ForgeStory — schema único de story executável pelo Forge.
 *
 * Fonte da verdade do shape consumido por: planner (estende com `reuses`),
 * snapshotManifest (DB → ForgeRun.manifest) e o importer de backfill.
 *
 * Regra crítica (alinhada ao AGENTS.md e à literatura de specs p/ agentes):
 * toda story precisa de ≥1 `verifiable` automatizável — é o "done" objetivo
 * sem o qual o agente autônomo aluciná conclusão ou entra em loop.
 */
import { z } from "zod";

export const VerifiableCheckSchema = z.object({
  kind: z.enum(["typecheck", "lint", "sql", "http", "manual_browser"]),
  command_or_query: z.string(),
  expected: z.string(),
});

export type VerifiableCheck = z.infer<typeof VerifiableCheckSchema>;

/** Perfis de agente canônicos do Forge. */
export const AGENT_PROFILES = ["db", "api", "ui", "wiring", "test", "doc"] as const;

export const ForgeStorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).min(1, "At least one acceptance criterion required"),
  estimateMinutes: z
    .number()
    .int()
    .positive()
    .max(30, "Stories must be ≤30min to fit in one context window"),
  dependsOn: z.array(z.string()).default([]),
  agentProfile: z.enum(AGENT_PROFILES),
  verifiable: z
    .array(VerifiableCheckSchema)
    .min(1, "Each story needs ≥1 verifiable check"),
  touches: z.array(z.string()).default([]),
  passes: z.boolean().optional(),
});

export type ForgeStory = z.infer<typeof ForgeStorySchema>;
