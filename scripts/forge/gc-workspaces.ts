#!/usr/bin/env tsx
/**
 * Forge Workspace Garbage Collection
 *
 * Standalone script to clean up stale workspaces (default: 24h per D8).
 * Can be run manually or via pg_cron (scheduled daily).
 *
 * Usage:
 *   tsx scripts/forge/gc-workspaces.ts [--max-age-hours N]
 *
 * Examples:
 *   tsx scripts/forge/gc-workspaces.ts              # default 24h
 *   tsx scripts/forge/gc-workspaces.ts --max-age-hours 48
 */
import { gcStaleWorkspaces } from "../../src/lib/forge/workspace";

const args = process.argv.slice(2);
const maxAgeHoursIdx = args.indexOf("--max-age-hours");
const maxAgeHours =
  maxAgeHoursIdx >= 0 && args[maxAgeHoursIdx + 1]
    ? parseInt(args[maxAgeHoursIdx + 1], 10)
    : 24;

if (isNaN(maxAgeHours) || maxAgeHours <= 0) {
  console.error("Invalid --max-age-hours value (must be > 0)");
  process.exit(1);
}

console.log(`→ Garbage collecting workspaces older than ${maxAgeHours}h...`);

try {
  const removed = gcStaleWorkspaces(maxAgeHours);

  if (removed.length === 0) {
    console.log("✓ No stale workspaces found");
  } else {
    console.log(`✓ Removed ${removed.length} stale workspace(s):`);
    for (const runId of removed) {
      console.log(`  - ${runId}`);
    }
  }

  process.exit(0);
} catch (err: unknown) {
  console.error("✗ GC failed:");
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
