/**
 * vitoria-cli.ts — drive a Vitoria conversation directly via the agent engine.
 *
 * Equivalent to the planning-chat connector (src/lib/agent/connectors/planning-chat.ts)
 * minus auth and HTTP transport. Persists user + assistant messages to
 * ChatThread/ChatMessage exactly as the route does — the conversation is
 * visible in the Planning UI right after.
 *
 * Usage:
 *   tsx scripts/vitoria-cli.ts \
 *     --planning <id> \
 *     --message "..." \
 *     [--message-file path] \
 *     [--member-id <memberId>] \
 *     [--phase <open|in_review|ready_to_commit>]
 *
 * Use --message-file when the message is large (e.g. transcript blob) — read
 * from disk instead of stuffing into argv.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { runAgent } from "../src/lib/agent/engine";
import { vitoriaAgent } from "../src/lib/agent/agents/vitoria";
import {
  ensurePlanningThread,
  persistUserMessage,
  persistAssistantMessage,
} from "../src/lib/agent/context";
import { db } from "../src/lib/db";
import type { Capabilities } from "../src/lib/agent/types";

type PlanningPhase = "idle" | "reading" | "proposing" | "approving" | "closed" | "archived";

type Args = {
  planning: string;
  message?: string;
  messageFile?: string;
  memberId?: string;
  phase?: PlanningPhase;
};

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--planning") out.planning = argv[++i];
    else if (a === "--message") out.message = argv[++i];
    else if (a === "--message-file") out.messageFile = argv[++i];
    else if (a === "--member-id") out.memberId = argv[++i];
    else if (a === "--phase") {
      const v = argv[++i] as PlanningPhase;
      const valid: PlanningPhase[] = ["idle", "reading", "proposing", "approving", "closed", "archived"];
      if (!valid.includes(v)) throw new Error(`--phase invalid: ${v}. Valid: ${valid.join(",")}`);
      out.phase = v;
    }
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.planning) throw new Error("--planning required");
  if (!out.message && !out.messageFile)
    throw new Error("--message or --message-file required");
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

  // 1. Load planning + project + sprint context
  const { data: planning, error: pErr } = await db()
    .from("PlanningCeremony")
    .select(
      `
      id, phase, projectId, sprintId,
      project:Project(id, name, referenceKey),
      sprint:Sprint(id, name, startDate, endDate),
      linkedTranscripts:PlanningTranscriptLink(transcriptRefId),
      pendingCount:MeetingTaskAction(count)
      `,
    )
    .eq("id", args.planning)
    .single();

  if (pErr || !planning) throw new Error(`Planning not found: ${args.planning}`);

  const project = planning.project as { id: string; name: string; referenceKey: string | null } | null;
  const sprint = planning.sprint as { id: string; name: string; startDate: string; endDate: string } | null;
  const transcriptCount = (planning.linkedTranscripts ?? []).length;

  console.log(yellow("▸ Planning:"), planning.id);
  console.log(yellow("▸ Project:"), project ? `${project.name} (${project.referenceKey ?? "?"})` : "?");
  console.log(yellow("▸ Sprint:"), sprint ? `${sprint.name} (${sprint.startDate} → ${sprint.endDate})` : "—");
  console.log(yellow("▸ Phase:"), planning.phase);
  console.log(yellow("▸ Linked transcripts:"), transcriptCount);
  console.log(yellow("▸ Mensagem (primeiros 200 chars):"));
  console.log(dim(`  ${message.slice(0, 200).replace(/\n/g, " ")}…`));
  console.log();

  // 2. Optional phase override (audit scenarios that need in_review / ready_to_commit)
  if (args.phase && args.phase !== planning.phase) {
    const { error: phErr } = await db()
      .from("PlanningCeremony")
      .update({ phase: args.phase, updatedAt: new Date().toISOString() })
      .eq("id", planning.id);
    if (phErr) {
      console.log(red(`▸ phase override falhou: ${phErr.message} (continuando com '${planning.phase}')`));
    } else {
      console.log(yellow(`▸ phase overridden: ${planning.phase} → ${args.phase}`));
    }
  }

  // 3. Resolve memberId (default = caller's project member)
  let memberId = args.memberId;
  if (!memberId) {
    const { data: anyMember } = await db()
      .from("Member")
      .select("id")
      .limit(1)
      .maybeSingle();
    memberId = anyMember?.id;
    if (memberId) console.log(yellow(`▸ memberId (default first Member):`), memberId);
  }

  // 4. Thread + persist user message (mirror planningChatConnector order)
  const threadId = await ensurePlanningThread(args.planning, memberId);
  await persistUserMessage(threadId, message);
  console.log(dim(`▸ Thread: ${threadId} (user msg persistido)`));
  console.log();

  // 5. Capabilities — mirror planningChatConnector
  const capabilities: Capabilities = {
    maxSteps: 40,
    writeTools: true,
    readTools: true,
    webSearch: false,
    memberId,
  };

  // 6. Run agent
  const result = await runAgent({
    agent: vitoriaAgent,
    thread: { id: threadId },
    capabilities,
    userMessage: message,
    memberId: memberId ?? null,
    params: { planningId: args.planning },
  });

  // 7. Stream consume — print live, capture parts for persistence
  console.log(cyan("════════ VITORIA ════════"));
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
      case "finish":
        break;
      case "error":
        console.log(`\n${red("▸ stream error:")}`, chunk);
        break;
      default:
        break;
    }
  }

  // 8. Persist assistant message (text + parts so UI rebuilds chips)
  if (collectedText) parts.push({ type: "text", text: collectedText });
  await persistAssistantMessage(threadId, collectedText, parts);

  // 9. Summary
  console.log(`\n\n${cyan("════════ resumo ════════")}`);
  console.log(`text length: ${collectedText.length} chars`);
  console.log(`tool calls : ${toolCalls.length}`);
  toolCalls.forEach((tc, i) => {
    const status = tc.output != null ? "✓" : "·";
    console.log(`  ${i + 1}. ${status} ${tc.name}`);
  });
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
