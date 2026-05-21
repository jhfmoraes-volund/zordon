// Design tokens shared by the Design Session board primitives.
//
// Tint system (low-chroma, status-grade) — values backed by CSS vars in
// globals.css (--accent-{name}-{tint|tint-hover|ring|chip}). Class strings
// stay literal so Tailwind v4 detects them statically.
//
// The brand red (chroma 0.237) is reserved for primary CTAs and focus rings.
// Status red (and all other accents) max at chroma 0.18 — see globals.css.

export type Accent =
  | "sky"
  | "red"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "indigo"
  | "neutral";

export type SeverityTone = "high" | "medium" | "low";

type AccentClasses = {
  /** Outer <section> frame — flat card surface + diffuse white ring. */
  frame: string;
  /** Header eyebrow / count text color (chip). */
  countText: string;
  /** Dashed add-row border (idle / hover / focus-within). */
  dashedBorder: string;
  /** Default StickyCard tint when card adopts the column accent. */
  cardBg: string;
  /** Default StickyCard ring (idle — diffuse white). */
  cardRing: string;
  /** Hover ring (tonal — accent chip @ 35%). */
  cardRingHover: string;
  /** Hover background tint (chip @ 11%). */
  cardBgHover: string;
  /** Header icon-box background tint. */
  iconBg: string;
  /** Header icon-box ring (tonal). */
  iconRing: string;
  /** Icon / chip text color. */
  chip: string;
  /** Empty-state icon color (very pale). */
  emptyIcon: string;
};

export const ACCENT_CLASSES: Record<Accent, AccentClasses> = {
  sky: {
    frame: "border-[var(--accent-surface-ring)] bg-card",
    countText: "text-[var(--accent-sky-chip)]",
    dashedBorder:
      "border-[var(--accent-sky-ring)] hover:border-[var(--accent-sky-ring)] focus-within:border-[var(--accent-sky-ring)]",
    cardBg: "bg-[var(--accent-sky-tint)]",
    cardRing: "ring-1 ring-inset ring-[var(--accent-surface-ring-soft)]",
    cardRingHover: "hover:ring-[var(--accent-sky-ring)]",
    cardBgHover: "hover:bg-[var(--accent-sky-tint-hover)]",
    iconBg: "bg-[var(--accent-sky-tint)]",
    iconRing: "ring-1 ring-inset ring-[var(--accent-sky-ring)]",
    chip: "text-[var(--accent-sky-chip)]",
    emptyIcon: "text-[var(--accent-sky-ring)]",
  },
  red: {
    frame: "border-[var(--accent-surface-ring)] bg-card",
    countText: "text-[var(--accent-red-chip)]",
    dashedBorder:
      "border-[var(--accent-red-ring)] hover:border-[var(--accent-red-ring)] focus-within:border-[var(--accent-red-ring)]",
    cardBg: "bg-[var(--accent-red-tint)]",
    cardRing: "ring-1 ring-inset ring-[var(--accent-surface-ring-soft)]",
    cardRingHover: "hover:ring-[var(--accent-red-ring)]",
    cardBgHover: "hover:bg-[var(--accent-red-tint-hover)]",
    iconBg: "bg-[var(--accent-red-tint)]",
    iconRing: "ring-1 ring-inset ring-[var(--accent-red-ring)]",
    chip: "text-[var(--accent-red-chip)]",
    emptyIcon: "text-[var(--accent-red-ring)]",
  },
  emerald: {
    frame: "border-[var(--accent-surface-ring)] bg-card",
    countText: "text-[var(--accent-emerald-chip)]",
    dashedBorder:
      "border-[var(--accent-emerald-ring)] hover:border-[var(--accent-emerald-ring)] focus-within:border-[var(--accent-emerald-ring)]",
    cardBg: "bg-[var(--accent-emerald-tint)]",
    cardRing: "ring-1 ring-inset ring-[var(--accent-surface-ring-soft)]",
    cardRingHover: "hover:ring-[var(--accent-emerald-ring)]",
    cardBgHover: "hover:bg-[var(--accent-emerald-tint-hover)]",
    iconBg: "bg-[var(--accent-emerald-tint)]",
    iconRing: "ring-1 ring-inset ring-[var(--accent-emerald-ring)]",
    chip: "text-[var(--accent-emerald-chip)]",
    emptyIcon: "text-[var(--accent-emerald-ring)]",
  },
  amber: {
    frame: "border-[var(--accent-surface-ring)] bg-card",
    countText: "text-[var(--accent-amber-chip)]",
    dashedBorder:
      "border-[var(--accent-amber-ring)] hover:border-[var(--accent-amber-ring)] focus-within:border-[var(--accent-amber-ring)]",
    cardBg: "bg-[var(--accent-amber-tint)]",
    cardRing: "ring-1 ring-inset ring-[var(--accent-surface-ring-soft)]",
    cardRingHover: "hover:ring-[var(--accent-amber-ring)]",
    cardBgHover: "hover:bg-[var(--accent-amber-tint-hover)]",
    iconBg: "bg-[var(--accent-amber-tint)]",
    iconRing: "ring-1 ring-inset ring-[var(--accent-amber-ring)]",
    chip: "text-[var(--accent-amber-chip)]",
    emptyIcon: "text-[var(--accent-amber-ring)]",
  },
  rose: {
    frame: "border-[var(--accent-surface-ring)] bg-card",
    countText: "text-[var(--accent-rose-chip)]",
    dashedBorder:
      "border-[var(--accent-rose-ring)] hover:border-[var(--accent-rose-ring)] focus-within:border-[var(--accent-rose-ring)]",
    cardBg: "bg-[var(--accent-rose-tint)]",
    cardRing: "ring-1 ring-inset ring-[var(--accent-surface-ring-soft)]",
    cardRingHover: "hover:ring-[var(--accent-rose-ring)]",
    cardBgHover: "hover:bg-[var(--accent-rose-tint-hover)]",
    iconBg: "bg-[var(--accent-rose-tint)]",
    iconRing: "ring-1 ring-inset ring-[var(--accent-rose-ring)]",
    chip: "text-[var(--accent-rose-chip)]",
    emptyIcon: "text-[var(--accent-rose-ring)]",
  },
  violet: {
    frame: "border-[var(--accent-surface-ring)] bg-card",
    countText: "text-[var(--accent-violet-chip)]",
    dashedBorder:
      "border-[var(--accent-violet-ring)] hover:border-[var(--accent-violet-ring)] focus-within:border-[var(--accent-violet-ring)]",
    cardBg: "bg-[var(--accent-violet-tint)]",
    cardRing: "ring-1 ring-inset ring-[var(--accent-surface-ring-soft)]",
    cardRingHover: "hover:ring-[var(--accent-violet-ring)]",
    cardBgHover: "hover:bg-[var(--accent-violet-tint-hover)]",
    iconBg: "bg-[var(--accent-violet-tint)]",
    iconRing: "ring-1 ring-inset ring-[var(--accent-violet-ring)]",
    chip: "text-[var(--accent-violet-chip)]",
    emptyIcon: "text-[var(--accent-violet-ring)]",
  },
  indigo: {
    frame: "border-[var(--accent-surface-ring)] bg-card",
    countText: "text-[var(--accent-indigo-chip)]",
    dashedBorder:
      "border-[var(--accent-indigo-ring)] hover:border-[var(--accent-indigo-ring)] focus-within:border-[var(--accent-indigo-ring)]",
    cardBg: "bg-[var(--accent-indigo-tint)]",
    cardRing: "ring-1 ring-inset ring-[var(--accent-surface-ring-soft)]",
    cardRingHover: "hover:ring-[var(--accent-indigo-ring)]",
    cardBgHover: "hover:bg-[var(--accent-indigo-tint-hover)]",
    iconBg: "bg-[var(--accent-indigo-tint)]",
    iconRing: "ring-1 ring-inset ring-[var(--accent-indigo-ring)]",
    chip: "text-[var(--accent-indigo-chip)]",
    emptyIcon: "text-[var(--accent-indigo-ring)]",
  },
  neutral: {
    frame: "border-[var(--accent-surface-ring)] bg-card",
    countText: "text-muted-foreground",
    dashedBorder:
      "border-[var(--accent-neutral-ring)] hover:border-[var(--accent-neutral-ring)] focus-within:border-[var(--accent-neutral-ring)]",
    cardBg: "bg-[var(--accent-neutral-tint)]",
    cardRing: "ring-1 ring-inset ring-[var(--accent-surface-ring-soft)]",
    cardRingHover: "hover:ring-[var(--accent-neutral-ring)]",
    cardBgHover: "hover:bg-[var(--accent-neutral-tint-hover)]",
    iconBg: "bg-[var(--accent-neutral-tint)]",
    iconRing: "ring-1 ring-inset ring-[var(--accent-neutral-ring)]",
    chip: "text-muted-foreground",
    emptyIcon: "text-[var(--accent-neutral-ring)]",
  },
};

// Severity uses status reds/ambers/emeralds at the SAME low chroma as the
// accent tints — these are status colors, not brand. The 4px left border is
// the canonical severity affordance across boards.
export const SEVERITY_BORDER: Record<SeverityTone, string> = {
  high: "border-l-[var(--accent-red-chip)]",
  medium: "border-l-[var(--accent-amber-chip)]",
  low: "border-l-[var(--accent-emerald-chip)]",
};

export const SEVERITY_TONE_CHIP: Record<SeverityTone, string> = {
  high: "bg-[var(--accent-red-tint)] text-[var(--accent-red-chip)] border border-[var(--accent-red-ring)]",
  medium:
    "bg-[var(--accent-amber-tint)] text-[var(--accent-amber-chip)] border border-[var(--accent-amber-ring)]",
  low: "bg-[var(--accent-emerald-tint)] text-[var(--accent-emerald-chip)] border border-[var(--accent-emerald-ring)]",
};

export const SEVERITY_LABEL: Record<SeverityTone, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baixa",
};
