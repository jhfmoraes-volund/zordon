/**
 * Forge Worker Profiles — specialized agent configurations with anti-patterns.
 *
 * Each profile defines:
 * - systemPrompt: Context-specific instructions and patterns
 * - allowedTools: Tool restrictions (future use)
 * - requiredMemories: Memory files to inject
 * - antiPatterns: Regex patterns to detect violations in diff
 * - maxRetries: Maximum retry attempts before pivot
 *
 * Anti-pattern detection:
 * - Runs after worker completion, before marking task as done
 * - Searches git diff for each pattern
 * - severity='block' → fail task immediately
 * - severity='warn' → log warning but allow
 */

export type AntiPattern = {
  pattern: RegExp;
  severity: "block" | "warn";
  message: string;
};

export type Profile = {
  name: string;
  systemPrompt: string;
  allowedTools?: string[];
  requiredMemories?: string[];
  antiPatterns: AntiPattern[];
  maxRetries: number;
};

import { dbProfile } from "./db";
import { apiProfile } from "./api";
import { uiProfile } from "./ui";
import { wiringProfile } from "./wiring";
import { testProfile } from "./test";
import { docProfile } from "./doc";

const profiles: Record<string, Profile> = {
  db: dbProfile,
  api: apiProfile,
  ui: uiProfile,
  wiring: wiringProfile,
  test: testProfile,
  doc: docProfile,
};

/**
 * Get profile by name.
 * Throws if profile doesn't exist.
 */
export function getProfile(name: string): Profile {
  const profile = profiles[name];
  if (!profile) {
    throw new Error(`Unknown profile: ${name}. Available: ${Object.keys(profiles).join(", ")}`);
  }
  return profile;
}

/**
 * Detect anti-patterns in git diff.
 * Returns list of violations with severity='block'.
 */
export function detectAntiPatterns(diff: string, profile: Profile): AntiPattern[] {
  const violations: AntiPattern[] = [];

  for (const antiPattern of profile.antiPatterns) {
    if (antiPattern.pattern.test(diff)) {
      violations.push(antiPattern);
    }
  }

  return violations.filter((v) => v.severity === "block");
}
