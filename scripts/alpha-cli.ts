/**
 * alpha-cli.ts — drive an Alpha conversation directly via the agent engine.
 *
 * Mirrors the web route (src/app/api/agents/alpha/chat/route.ts) minus auth +
 * HTTP transport. Persists user + assistant messages to ChatThread/ChatMessage
 * exactly as the route does, so the conversation is visible in the /ops UI.
 *
 * Usage:
 *   tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
 *     --member-id <uuid> \
 *     --message "..." \
 *     [--message-file path] \
 *     [--current-path "/projects/<uuid>"] \
 *     [--meeting-id <uuid>] \
 *     [--thread-id <uuid>] \
 *     [--new-thread] \
 *     [--max-steps 60]
 *
 * memberId é obrigatório porque ChatThread de Alpha é per-member (createdBy).
 * Pegar de psql:  SELECT id, name, email FROM "Member" WHERE email = '...';
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { runAgent } from "../src/lib/agent/engine";
import { alphaAgent } from "../src/lib/agent/agents/alpha";
import {
  ensureAgentThread,
  persistUserMessage,
  persistAssistantMessage,
} from "../src/lib/agent/context";
import { db } from "../src/lib/db";
import { parseRoute, routeLabel } from "../src/lib/agent/agents/alpha/route-context";
import { getMemberIntegrationToken } from "../src/lib/member-integrations";
import type { Capabilities } from "../src/lib/agent/types";

type Args = {
  memberId: string;
  message?: string;
  messageFile?: string;
  currentPath?: string;
  meetingId?: string;
  threadId?: string;
  newThread?: boolean;
  maxSteps?: number;
};

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--member-id") out.memberId = argv[++i];
    else if (a === "--message") out.message = argv[++i];
    else if (a === "--message-file") out.messageFile = argv[++i];
    else if (a === "--current-path") out.currentPath = argv[++i];
    else if (a === "--meeting-id") out.meetingId = argv[++i];
    else if (a === "--thread-id") out.threadId = argv[++i];
    else if (a === "--new-thread") out.newThread = true;
    else if (a === "--max-steps") out.maxSteps = parseInt(argv[++i], 10);
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.memberId) {
    throw new Error(
      `--member-id required. Pegar via psql:\n  SELECT id, name, email FROM "Member" LIMIT 5;`
    );
  }
  if (!out.message && !out.messageFile) {
    throw new Error("--message or --message-file required");
  }
  return out as Args;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function preview(v: unknown, max = 1500): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…[truncated ${s.length - max} chars]` : s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const message = args.message ?? readFileSync(args.messageFile!, "utf-8");

  // 1. Validar member existe
  const { data: member, error: memberErr } = await db()
    .from("Member")
    .select("id, name, email")
    .eq("id", args.memberId)
    .single();
  if (memberErr || !member) {
    throw new Error(`Member not found: ${args.memberId}`);
  }

  // 2. Resolver thread — se --new-thread, cria; se --thread-id, valida ownership; senão ensureAgentThread
  let threadId: string;
  if (args.newThread) {
    const { data: created, error } = await db()
      .from("ChatThread")
      .insert({ agentName: "alpha", channel: "web", createdBy: member.id })
      .select("id")
      .single();
    if (error || !created) {
      throw new Error(`Failed to create thread: ${error?.message ?? "unknown"}`);
    }
    threadId = created.id;
  } else if (args.threadId) {
    const { data: owned } = await db()
      .from("ChatThread")
      .select("id")
      .eq("id", args.threadId)
      .eq("createdBy", member.id)
      .eq("agentName", "alpha")
      .maybeSingle();
    if (!owned) {
      throw new Error(`Thread not found or not owned by member: ${args.threadId}`);
    }
    threadId = owned.id;
  } else {
    threadId = await ensureAgentThread("alpha", "web", member.id);
  }

  // 3. Parse route
  const route = parseRoute(args.currentPath);

  // 4. Header
  console.log(yellow("▸ Member:"), `${member.name ?? "?"} (${member.email ?? "?"}) [${member.id}]`);
  console.log(yellow("▸ Thread:"), `${threadId} ${args.newThread ? "(NEW)" : args.threadId ? "(explicit)" : "(latest)"}`);
  console.log(yellow("▸ Route:"), `${routeLabel(route)} → kind=${route.kind}`);
  if (args.meetingId) console.log(yellow("▸ MeetingId:"), args.meetingId);
  console.log(yellow("▸ Mensagem (primeiros 200 chars):"));
  console.log(dim(`  ${message.slice(0, 200).replace(/\n/g, " ")}…`));
  console.log();

  // 5. Persistir user msg + bump updatedAt/title (espelha route.ts)
  const { data: existingTitle } = await db()
    .from("ChatThread")
    .select("title")
    .eq("id", threadId)
    .maybeSingle();
  await persistUserMessage(threadId, message);
  const updates: { updatedAt: string; title?: string } = {
    updatedAt: new Date().toISOString(),
  };
  if (!existingTitle?.title) {
    updates.title = message.length > 80 ? `${message.slice(0, 80).trimEnd()}…` : message;
  }
  await db().from("ChatThread").update(updates).eq("id", threadId);
  console.log(dim("▸ user msg persistido"));
  console.log();

  // 6. Capabilities — espelha route.ts (writeTools+readTools, roamToken se houver)
  const roamToken = await getMemberIntegrationToken(member.id, "roam");
  const capabilities: Capabilities = {
    maxSteps: args.maxSteps ?? 60,
    writeTools: true,
    readTools: true,
    ...(roamToken ? { roamToken } : {}),
    // composio: omitido por default (CLI não simula contas conectadas)
  };

  // 7. Run agent
  const result = await runAgent({
    agent: alphaAgent,
    thread: { id: threadId },
    capabilities,
    userMessage: message,
    memberId: member.id,
    params: { meetingId: args.meetingId, route },
  });

  // 8. Stream consume — print live, captura parts pra persistência
  console.log(cyan("════════ ALPHA ════════"));
  let collectedText = "";
  const parts: Array<Record<string, unknown>> = [];
  const toolCalls: Array<{ name: string; input: unknown; output?: unknown }> = [];
  const toolCallById = new Map<string, { name: string; input: unknown }>();

  for await (const chunk of result.streamText.fullStream) {
    switch (chunk.type) {
      case "text-delta": {
        const delta =
          (chunk as { text?: string; delta?: string }).text ??
          (chunk as { delta?: string }).delta ??
          "";
        if (delta) {
          process.stdout.write(delta);
          collectedText += delta;
        }
        break;
      }
      case "tool-call": {
        const tc = chunk as unknown as { toolCallId: string; toolName: string; input: unknown };
        console.log(`\n${magenta(`▸ tool-call ${tc.toolName}`)}`);
        console.log(dim(`  input: ${preview(tc.input, 1500)}`));
        toolCallById.set(tc.toolCallId, { name: tc.toolName, input: tc.input });
        toolCalls.push({ name: tc.toolName, input: tc.input });
        parts.push({ type: "tool-call", ...tc });
        break;
      }
      case "tool-result": {
        const tr = chunk as unknown as { toolCallId: string; toolName: string; output: unknown };
        const matched = toolCallById.get(tr.toolCallId);
        const last = toolCalls[toolCalls.length - 1];
        if (matched && last && last.name === tr.toolName) {
          last.output = tr.output;
        }
        console.log(`${green(`  → ${tr.toolName} result`)}`);
        console.log(dim(`    output: ${preview(tr.output, 1200)}`));
        parts.push({ type: "tool-result", ...tr });
        break;
      }
      case "finish": {
        break;
      }
      case "error": {
        console.log(`\n${red("▸ stream error:")}`, chunk);
        break;
      }
      default:
        break;
    }
  }

  // 9. Persist assistant message
  if (collectedText) parts.push({ type: "text", text: collectedText });
  await persistAssistantMessage(threadId, collectedText, parts);

  // 10. Resumo
  console.log(`\n\n${cyan("════════ resumo ════════")}`);
  console.log(`text length: ${collectedText.length} chars`);
  console.log(`tool calls : ${toolCalls.length}`);
  toolCalls.forEach((tc, i) => {
    const status = tc.output != null ? "✓" : "·";
    console.log(`  ${i + 1}. ${status} ${tc.name}`);
  });
  console.log(`\n${dim(`thread: ${threadId}`)}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
