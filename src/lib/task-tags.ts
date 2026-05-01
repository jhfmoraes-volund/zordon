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
