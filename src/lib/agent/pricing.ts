// Pricing table for the models Volund currently uses via OpenRouter.
// Values are USD per 1M tokens. Source: Anthropic public pricing.
// `costUsd` already stored in AgentUsage comes from OpenRouter with cache
// discounts applied. This table is used to *estimate* cache savings vs a
// hypothetical "no cache" baseline, and to fall back when needed.

type Rate = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

const PER_MTOK = 1_000_000;

const RATES: Record<string, Rate> = {
  "anthropic/claude-sonnet-4.6":  { input: 3.0,  output: 15.0, cacheRead: 0.3,  cacheWrite: 3.75 },
  "anthropic/claude-sonnet-4-5":  { input: 3.0,  output: 15.0, cacheRead: 0.3,  cacheWrite: 3.75 },
  "anthropic/claude-sonnet-4":    { input: 3.0,  output: 15.0, cacheRead: 0.3,  cacheWrite: 3.75 },
  "anthropic/claude-haiku-4.5":   { input: 1.0,  output: 5.0,  cacheRead: 0.1,  cacheWrite: 1.25 },
  "anthropic/claude-haiku-4-5":   { input: 1.0,  output: 5.0,  cacheRead: 0.1,  cacheWrite: 1.25 },
  "anthropic/claude-opus-4-1":    { input: 15.0, output: 75.0, cacheRead: 1.5,  cacheWrite: 18.75 },
  "anthropic/claude-opus-4":      { input: 15.0, output: 75.0, cacheRead: 1.5,  cacheWrite: 18.75 },
};

const DEFAULT_RATE: Rate = RATES["anthropic/claude-sonnet-4.6"];

export function rateFor(modelId: string): Rate {
  return RATES[modelId] ?? DEFAULT_RATE;
}

/**
 * Estimated USD saved by prompt caching, vs a baseline where every cached
 * token would be billed at the full input rate. cached × (input − cacheRead).
 */
export function estimateCacheSavingsUsd(modelId: string, cachedTokens: number): number {
  if (!cachedTokens || cachedTokens <= 0) return 0;
  const r = rateFor(modelId);
  return (cachedTokens * (r.input - r.cacheRead)) / PER_MTOK;
}

/**
 * Family label for grouping inconsistent model ids (e.g. "claude-haiku-4.5"
 * vs "claude-haiku-4-5"). Returns the model id stripped of "anthropic/" and
 * dot/dash normalized to a single family slug.
 */
export function modelFamily(modelId: string): string {
  const base = modelId.replace(/^anthropic\//, "");
  return base.replace(/[.\-]/g, "-").replace(/-+/g, "-");
}
