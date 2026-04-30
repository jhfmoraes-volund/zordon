"use client";

/**
 * Pixel HP-bar — segmented arcade-style bar for skill scores.
 * Adapted from the volund-design-system reference: hard edges,
 * inner bevel, glow on filled cells. Tone shifts by score band.
 */

type Tone = { bar: string; glow: string; fg: string };

const EMPTY_TONE: Tone = {
  bar: "oklch(0.4 0 0)",
  glow: "transparent",
  fg: "oklch(0.5 0 0)",
};

/**
 * "skill" — higher is better (ramps from blue to green).
 * "load" — higher is worse (ramps from green to red).
 */
export type PixelBarVariant = "skill" | "load";

function skillTone(value: number | null | undefined): Tone {
  if (value === null || value === undefined) return EMPTY_TONE;
  if (value >= 95) return { bar: "oklch(0.74 0.18 145)", glow: "oklch(0.74 0.18 145 / 0.55)", fg: "oklch(0.82 0.18 145)" };
  if (value >= 70) return { bar: "oklch(0.637 0.237 22)", glow: "oklch(0.637 0.237 22 / 0.55)", fg: "oklch(0.82 0.2 22)" };
  if (value >= 50) return { bar: "oklch(0.7 0.16 65)", glow: "oklch(0.7 0.16 65 / 0.45)", fg: "oklch(0.82 0.15 65)" };
  if (value >= 10) return { bar: "oklch(0.6 0.13 250)", glow: "oklch(0.6 0.13 250 / 0.45)", fg: "oklch(0.78 0.13 250)" };
  return EMPTY_TONE;
}

function loadTone(value: number | null | undefined): Tone {
  if (value === null || value === undefined) return EMPTY_TONE;
  if (value >= 95) return { bar: "oklch(0.637 0.237 22)", glow: "oklch(0.637 0.237 22 / 0.55)", fg: "oklch(0.82 0.2 22)" };
  if (value >= 80) return { bar: "oklch(0.7 0.16 65)", glow: "oklch(0.7 0.16 65 / 0.45)", fg: "oklch(0.82 0.15 65)" };
  if (value >= 50) return { bar: "oklch(0.6 0.13 250)", glow: "oklch(0.6 0.13 250 / 0.45)", fg: "oklch(0.78 0.13 250)" };
  if (value >= 1)  return { bar: "oklch(0.74 0.18 145)", glow: "oklch(0.74 0.18 145 / 0.45)", fg: "oklch(0.82 0.18 145)" };
  return EMPTY_TONE;
}

export function pixelTone(value: number | null | undefined, variant: PixelBarVariant = "skill"): Tone {
  return variant === "load" ? loadTone(value) : skillTone(value);
}

type Props = {
  /** 0-100; null treated as empty bar */
  score: number | null | undefined;
  cells?: number;
  height?: number;
  glow?: boolean;
  variant?: PixelBarVariant;
};

export function PixelBar({ score, cells = 20, height = 12, glow = true, variant = "skill" }: Props) {
  const safe = Math.max(0, Math.min(100, score ?? 0));
  const filled = Math.round((safe / 100) * cells);
  const tone = pixelTone(score, variant);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cells}, 1fr)`,
        gap: 2,
        padding: 2,
        height,
        background: "oklch(0.1 0 0)",
        borderRadius: 3,
        boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.08), inset 0 1px 0 oklch(0 0 0 / 0.6)",
      }}
    >
      {Array.from({ length: cells }).map((_, i) => {
        const on = i < filled;
        return (
          <div
            key={i}
            style={{
              background: on ? tone.bar : "oklch(1 0 0 / 0.04)",
              borderRadius: 1,
              boxShadow: on
                ? `inset 0 1px 0 oklch(1 0 0 / 0.25), 0 0 ${glow ? 4 : 0}px ${tone.glow}`
                : "inset 0 0 0 1px oklch(0 0 0 / 0.4)",
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Single arcade-style pixel cell — 1:1 swatch que combina com PixelBar.
 * Use pra indicadores inline (▓done ▒open virou <PixelDot variant=...>).
 *
 *  - "done"   = cell ligada (verde sólido + glow leve)
 *  - "open"   = cell em progresso (azul muted, glow discreto)
 *  - "empty"  = cell apagada (placeholder)
 */
type PixelDotVariant = "done" | "open" | "empty";

const DOT_TONES: Record<PixelDotVariant, { bar: string; glow: string }> = {
  done:  { bar: "oklch(0.74 0.18 145)", glow: "oklch(0.74 0.18 145 / 0.55)" },
  open:  { bar: "oklch(0.6 0.13 250)",  glow: "oklch(0.6 0.13 250 / 0.4)" },
  empty: { bar: "oklch(1 0 0 / 0.04)",  glow: "transparent" },
};

export function PixelDot({
  variant = "done",
  size = 8,
  glow = true,
}: {
  variant?: PixelDotVariant;
  /** Lado do quadrado em px. Default 8 — ajustado pra ficar bom em texto pequeno. */
  size?: number;
  glow?: boolean;
}) {
  const tone = DOT_TONES[variant];
  const isEmpty = variant === "empty";
  return (
    <span
      aria-hidden
      className="inline-block align-[-1px]"
      style={{
        width: size,
        height: size,
        background: tone.bar,
        borderRadius: 1,
        boxShadow: isEmpty
          ? "inset 0 0 0 1px oklch(0 0 0 / 0.4)"
          : `inset 0 1px 0 oklch(1 0 0 / 0.25), 0 0 ${glow ? 3 : 0}px ${tone.glow}`,
      }}
    />
  );
}

/** Tone label for HUD-style score readouts (MAX / HIGH / MID / LOW / —). */
export function pixelBarLabel(score: number | null | undefined): {
  label: string;
  fg: string;
} {
  const tone = skillTone(score);
  if (score === null || score === undefined) return { label: "—", fg: tone.fg };
  if (score >= 95) return { label: "MAX", fg: tone.fg };
  if (score >= 70) return { label: "HIGH", fg: tone.fg };
  if (score >= 50) return { label: "MID", fg: tone.fg };
  if (score >= 10) return { label: "LOW", fg: tone.fg };
  return { label: "—", fg: tone.fg };
}

/**
 * HUD label — sans uppercase com tracking generoso.
 * Use pra: MAX/HIGH/MID/LOW, contadores tipo "01/20", labels de barra ("FP", "Torre primária"), versioning ("ZRD/v3").
 *
 * Pra números (score "85") use font-mono tabular-nums direto via className.
 */
type PixelHudProps = {
  children: React.ReactNode;
  size?: "xs" | "sm";
  tone?: "default" | "muted" | "accent";
  className?: string;
  style?: React.CSSProperties;
};

export function PixelHud({
  children,
  size = "sm",
  tone = "default",
  className = "",
  style,
}: PixelHudProps) {
  const sizeClass = size === "xs" ? "text-[10px]" : "text-[11px]";
  const toneClass =
    tone === "muted"
      ? "text-muted-foreground/70"
      : tone === "accent"
      ? "text-primary"
      : "text-foreground";
  return (
    <span
      className={`font-sans font-semibold ${sizeClass} ${toneClass} tracking-[0.12em] uppercase leading-none ${className}`}
      style={style}
    >
      {children}
    </span>
  );
}
