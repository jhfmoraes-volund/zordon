import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

export function getModel(modelId: string) {
  return openrouter(modelId);
}

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
