/**
 * Parse cost from Claude Code stream-json output.
 *
 * Stream-json format (ndjson):
 * Each line is a JSON object with a "type" field:
 * - { type: "usage", usage: { input_tokens: N, output_tokens: M } }
 * - { type: "message_start", message: { model: "claude-...", usage: {...} } }
 * - { type: "content_block_delta", delta: { ... } }
 * - etc.
 *
 * We extract:
 * 1. Model ID from message_start
 * 2. Token counts from usage events
 */

import { calculateCost } from "./pricing";

export type CostSummary = {
  tokensIn: number;
  tokensOut: number;
  usd: number;
  model: string;
};

/**
 * Parse cost from stream-json output (ndjson).
 *
 * @param stream - Raw stream-json output (newline-delimited JSON)
 * @returns Cost summary
 */
export async function parseCost(stream: string): Promise<CostSummary> {
  const lines = stream.split("\n").filter((line) => line.trim());

  let tokensIn = 0;
  let tokensOut = 0;
  let model = "claude-sonnet-4-5-20250929"; // default fallback

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;

      // Extract model from message_start
      if (event.type === "message_start") {
        const message = event.message as Record<string, unknown>;
        if (message && typeof message.model === "string") {
          model = message.model;
        }
      }

      // Extract usage from various event types
      if (event.usage && typeof event.usage === "object") {
        const usage = event.usage as Record<string, unknown>;
        if (typeof usage.input_tokens === "number") {
          tokensIn = Math.max(tokensIn, usage.input_tokens);
        }
        if (typeof usage.output_tokens === "number") {
          tokensOut = Math.max(tokensOut, usage.output_tokens);
        }
      }

      // Also check message.usage for message_start events
      if (event.type === "message_start" && event.message) {
        const message = event.message as Record<string, unknown>;
        if (message.usage && typeof message.usage === "object") {
          const usage = message.usage as Record<string, unknown>;
          if (typeof usage.input_tokens === "number") {
            tokensIn = Math.max(tokensIn, usage.input_tokens);
          }
          if (typeof usage.output_tokens === "number") {
            tokensOut = Math.max(tokensOut, usage.output_tokens);
          }
        }
      }
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  const usd = calculateCost(tokensIn, tokensOut, model);

  return {
    tokensIn,
    tokensOut,
    usd,
    model,
  };
}
