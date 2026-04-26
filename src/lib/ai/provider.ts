import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

export function getModel(modelId: string) {
  // `usage: { include: true }` makes OpenRouter return token + cost info in
  // providerMetadata.openrouter.usage so the engine can persist it.
  return openrouter(modelId, { usage: { include: true } });
}

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
