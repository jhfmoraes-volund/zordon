// Single source of truth for task-tag tone palette and project defaults.
// Mirrors the ChipTone palette from status-chips.ts so tags blend visually
// with status/type chips already in use across the app.

import type { ChipTone } from "@/lib/status-chips";

export const TAG_TONES: ChipTone[] = [
  "blue",
  "green",
  "amber",
  "red",
  "purple",
  "cyan",
  "teal",
  "pink",
  "slate",
  "brand",
  "muted",
];

export type TagDefault = { name: string; tone: ChipTone };

// Seeded into every project on creation and during the area→tags backfill.
export const DEFAULT_PROJECT_TAGS: TagDefault[] = [
  { name: "Front", tone: "blue" },
  { name: "Back",  tone: "purple" },
  { name: "Bug",   tone: "red" },
];

// Used during the one-off backfill from the legacy `task.area` enum.
export const AREA_TO_TAG: Record<string, TagDefault> = {
  front: { name: "Front", tone: "blue" },
  back:  { name: "Back",  tone: "purple" },
  infra: { name: "Infra", tone: "slate" },
  ops:   { name: "Ops",   tone: "teal" },
  mixed: { name: "Mixed", tone: "amber" },
};

export const TAG_NAME_MAX = 32;
export const TASK_TAG_LIMIT = 10;

export function pickRandomTone(): ChipTone {
  return TAG_TONES[Math.floor(Math.random() * TAG_TONES.length)];
}

// Stable tone derivation from any string id — same id always maps to the same
// tone. Useful for assignees/avatars where we want a chip color but no DB-level
// tone column. Uses djb2-ish hash; collisions are fine, we just want spread.
export function deriveToneFromId(id: string): ChipTone {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  // Avoid "muted" — it's the no-tone fallback and reads visually as disabled.
  const palette = TAG_TONES.filter((t) => t !== "muted");
  return palette[Math.abs(hash) % palette.length];
}
