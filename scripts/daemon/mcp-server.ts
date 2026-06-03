#!/usr/bin/env -S npx tsx
/**
 * mcp-server.ts — Zordon MCP server stdio.
 *
 * Spawned por Claude CLI via `--mcp-config /tmp/mcp-<turnId>.json` (Story 11).
 * Registra TOOL_REGISTRY (Story 13) e proxia cada tools/call pra
 * POST /api/agents/tools/:toolName no Zordon.
 *
 * Env:
 *   AGENT_SLUG=vitor|vitoria|alpha     # qual subset de tools expor
 *   CHAT_TURN_ID=<uuid>                # passado no body do proxy HTTP
 *   ZORDON_URL=http://localhost:3333    # base do webapp
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodTypeAny } from "zod";
import {
  TOOL_REGISTRY,
  getToolNamesForAgent,
  type ToolContext,
} from "../../src/lib/agent/tools-registry";

const AGENT_SLUG = (process.env.AGENT_SLUG ?? "vitor").toLowerCase();
const CHAT_TURN_ID = process.env.CHAT_TURN_ID;
const ZORDON_URL =
  process.env.ZORDON_URL ?? "http://localhost:3333";

const SUPPORTED_AGENTS = new Set(["vitor", "vitoria", "alpha"]);
if (!SUPPORTED_AGENTS.has(AGENT_SLUG)) {
  process.stderr.write(
    `[mcp-server] Unsupported AGENT_SLUG=${AGENT_SLUG}. Use vitor|vitoria|alpha.\n`,
  );
  process.exit(2);
}

if (!CHAT_TURN_ID) {
  process.stderr.write(
    "[mcp-server] CHAT_TURN_ID env required (set pelo daemon ao spawn).\n",
  );
  process.exit(2);
}

// ── Server setup ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: `zordon-mcp-${AGENT_SLUG}`,
  version: "0.1.0",
});

// FAKE_CTX só pra extrair schemas estáticos das factories. Schemas não
// dependem de sessionId/projectId/pmReviewId — eles vêm do .inputSchema do
// tool(). Todos campos preenchidos pra passar os runtime guards das factories.
const FAKE_CTX: ToolContext = {
  sessionId: "mcp-init",
  projectId: "mcp-init",
  pmReviewId: "mcp-init",
  memberId: null,
};

const toolNames = getToolNamesForAgent(AGENT_SLUG);

for (const name of toolNames) {
  const factory = TOOL_REGISTRY[name];
  if (!factory) continue;

  let toolDef;
  try {
    toolDef = factory(FAKE_CTX);
  } catch (err) {
    process.stderr.write(
      `[mcp-server] skip ${name}: factory error: ${(err as Error).message}\n`,
    );
    continue;
  }

  const description = (toolDef as { description?: string }).description ?? name;
  // AI SDK tool inputSchema é z.object — extraímos .shape pra registerTool.
  const inputSchema = (toolDef as { inputSchema?: ZodTypeAny }).inputSchema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shape = ((inputSchema as any)?._def?.shape ??
    (inputSchema as { shape?: Record<string, ZodTypeAny> })?.shape ??
    {}) as Record<string, ZodTypeAny>;

  server.registerTool(
    name,
    {
      description,
      inputSchema: shape,
    },
    async (args: Record<string, unknown>) => {
      try {
        const res = await fetch(
          `${ZORDON_URL}/api/agents/tools/${encodeURIComponent(name)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ args: args ?? {}, chatTurnId: CHAT_TURN_ID }),
          },
        );
        const data = (await res.json()) as {
          ok?: boolean;
          result?: unknown;
          error?: string;
        };

        if (!res.ok || !data.ok) {
          const errMsg = data.error ?? `HTTP ${res.status}`;
          return {
            content: [{ type: "text" as const, text: `Error: ${errMsg}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text:
                typeof data.result === "string"
                  ? data.result
                  : JSON.stringify(data.result, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Network error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

// ── Boot ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[mcp-server] ${AGENT_SLUG} ready on stdio (${toolNames.length} tools registered)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[mcp-server] fatal: ${err.message}\n`);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});
