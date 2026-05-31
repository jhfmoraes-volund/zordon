/**
 * Anthropic Claude API pricing table (as of 2026-05-31).
 *
 * Source: https://www.anthropic.com/pricing
 *
 * All prices in USD per million tokens (MTok).
 */

export type ModelPricing = {
  inputPerMTok: number;
  outputPerMTok: number;
};

export const PRICING: Record<string, ModelPricing> = {
  // Claude 4 Opus (most capable)
  "claude-opus-4-20250514": {
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
  },

  // Claude 4.5 Sonnet (flagship, balanced)
  "claude-sonnet-4-5-20250929": {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
  },

  // Claude 4 Sonnet
  "claude-sonnet-4-20250514": {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
  },

  // Claude 4 Haiku (fast, affordable)
  "claude-haiku-4-20250514": {
    inputPerMTok: 0.8,
    outputPerMTok: 4.0,
  },

  // Legacy fallback (3.5 Sonnet)
  "claude-3-5-sonnet-20241022": {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
  },
};

/**
 * Calculate cost in USD from token counts and model ID.
 *
 * @param tokensIn - Input tokens consumed
 * @param tokensOut - Output tokens generated
 * @param model - Model ID (e.g., "claude-sonnet-4-5-20250929")
 * @returns Cost in USD
 */
export function calculateCost(
  tokensIn: number,
  tokensOut: number,
  model: string,
): number {
  const pricing = PRICING[model];
  if (!pricing) {
    console.warn(`Unknown model "${model}", defaulting to Sonnet 4.5 pricing`);
    return calculateCost(tokensIn, tokensOut, "claude-sonnet-4-5-20250929");
  }

  const costIn = (tokensIn / 1_000_000) * pricing.inputPerMTok;
  const costOut = (tokensOut / 1_000_000) * pricing.outputPerMTok;

  return costIn + costOut;
}
