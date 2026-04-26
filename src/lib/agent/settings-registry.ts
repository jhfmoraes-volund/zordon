import { ALPHA_SETTINGS } from "./agents/alpha/settings";
import type { SettingsSchema } from "./settings-schema";

/**
 * Registry mapping Agent.slug → tunable settings schema.
 * When adding a new agent with settings, register it here.
 *
 * Agents without a schema registered still show up in /agents but the
 * Settings tab displays "no tunable parameters".
 */
export const AGENT_SETTINGS_REGISTRY: Record<string, SettingsSchema> = {
  ops: ALPHA_SETTINGS,
  // "design-session": VITOR_SETTINGS,  (adicionar quando o Vitor for tunável)
};

export function getSettingsSchema(slug: string): SettingsSchema | null {
  return AGENT_SETTINGS_REGISTRY[slug] ?? null;
}
