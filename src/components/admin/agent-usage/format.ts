export function fmtUsd(n: number, opts?: { precision?: 2 | 3 | 4 | "auto" }): string {
  if (!Number.isFinite(n)) return "—";
  const precision = opts?.precision ?? "auto";
  if (precision === "auto") {
    if (Math.abs(n) >= 100) return `$${n.toFixed(0)}`;
    if (Math.abs(n) >= 10) return `$${n.toFixed(2)}`;
    if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
    if (Math.abs(n) >= 0.01) return `$${n.toFixed(3)}`;
    return `$${n.toFixed(4)}`;
  }
  return `$${n.toFixed(precision)}`;
}

export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR");
}

export function fmtCompactInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toString();
}

export function fmtPct(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtMs(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 60_000) return `${(n / 60_000).toFixed(1)}min`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}

/** Delta vs prior period; returns null if prior is 0 (no baseline). */
export function delta(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return (curr - prev) / prev;
}

export function fmtDelta(d: number | null): string {
  if (d === null) return "—";
  const sign = d > 0 ? "+" : "";
  return `${sign}${(d * 100).toFixed(0)}%`;
}

/** Stable color from a string (hash → HSL). Used for stacked chart series. */
export function colorFromKey(key: string, alpha = 1): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsla(${hue}, 55%, 55%, ${alpha})`;
}
