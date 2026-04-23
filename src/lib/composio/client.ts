import type { ToolSet } from "ai";

/**
 * Fetches Composio tools for a given user and set of toolkits.
 * Returns an empty ToolSet if Composio is not configured.
 *
 * TODO: Wire the actual Composio SDK once COMPOSIO_API_KEY is set
 * and the OAuth flow for GitHub/Calendar/Roam is implemented.
 * See Volund OS reference: lib/agent/core/tools/composio.ts
 */
export async function getComposioTools(
  _userId: string,
  _toolkits: string[]
): Promise<ToolSet> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    console.debug("[composio] COMPOSIO_API_KEY not set — skipping tool loading");
    return {};
  }

  try {
    // Dynamic import to avoid build errors when SDK evolves
    const { Composio } = await import("@composio/core");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const composio = new Composio({ apiKey }) as any;

    const tools = await composio.getTools({
      apps: _toolkits,
      entityId: _userId,
    });

    // Convert to AI SDK ToolSet format
    const toolSet: ToolSet = {};
    for (const t of tools) {
      if (t.name && t.execute) {
        toolSet[t.name] = t;
      }
    }
    return toolSet;
  } catch (err) {
    console.warn("[composio] Failed to load tools:", (err as Error).message);
    return {};
  }
}
