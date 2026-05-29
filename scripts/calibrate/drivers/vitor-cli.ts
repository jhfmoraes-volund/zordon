/**
 * vitor-cli.ts — drive a Vitor conversation directly via the agent engine.
 *
 * Equivalent to the web connector (src/lib/agent/connectors/web.ts) minus auth
 * and HTTP transport. Persists user + assistant messages to ChatThread/ChatMessage
 * exactly as the route does, so the conversation is visible in the wizard UI.
 *
 * Usage:
 *   tsx scripts/vitor-cli.ts \
 *     --session <id> \
 *     --message "..." \
 *     [--message-file path] \
 *     [--advance-to <stepIndex>]
 *
 * Use --message-file when the message is large (e.g. document blob) — read from disk
 * instead of stuffing into argv.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { runAgent } from "../../../src/lib/agent/engine";
import { vitorAgent } from "../../../src/lib/agent/agents/vitor";
import {
  ensureThread,
  persistUserMessage,
  persistAssistantMessage,
} from "../../../src/lib/agent/context";
import { db } from "../../../src/lib/db";
import { getStepsForSession, type StepDef } from "../../../src/lib/design-session-steps";
import type { Capabilities } from "../../../src/lib/agent/types";

type Args = {
  session: string;
  message?: string;
  messageFile?: string;
  advanceTo?: number;
  memberId?: string;
};

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session") out.session = argv[++i];
    else if (a === "--message") out.message = argv[++i];
    else if (a === "--message-file") out.messageFile = argv[++i];
    else if (a === "--advance-to") out.advanceTo = parseInt(argv[++i], 10);
    else if (a === "--member-id") out.memberId = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.session) throw new Error("--session required");
  if (!out.message && !out.messageFile) throw new Error("--message or --message-file required");
  return out as Args;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

function preview(v: unknown, max = 1500): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…[truncated ${s.length - max} chars]` : s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const message = args.message ?? readFileSync(args.messageFile!, "utf-8");

  // 1. Load session, derive currentStepKey
  const { data: session, error: sessErr } = await db()
    .from("DesignSession")
    .select("id, type, projectId, currentStep, selectedSteps")
    .eq("id", args.session)
    .single();
  if (sessErr || !session) throw new Error(`Session not found: ${args.session}`);

  const steps = getStepsForSession(session as { type: string; selectedSteps: string[] | null });
  const currentStepDef = steps[session.currentStep ?? 0];
  if (!currentStepDef) throw new Error(`No step at index ${session.currentStep}`);
  const currentStepKey = currentStepDef.key;

  console.log(yellow("▸ Sessao:"), session.id);
  console.log(yellow("▸ Tipo:"), session.type);
  console.log(yellow("▸ Step atual:"), `${session.currentStep} → ${currentStepKey} (${currentStepDef.title})`);
  console.log(yellow("▸ Steps da sessao:"), steps.map((s: StepDef) => s.key).join(" → "));
  console.log(yellow("▸ Mensagem (primeiros 200 chars):"));
  console.log(dim(`  ${message.slice(0, 200).replace(/\n/g, " ")}…`));
  console.log();

  // 2. Thread + briefing marker + persist user message (mirror webConnector order).
  const threadId = await ensureThread(args.session, "web");

  if (currentStepKey === "briefing") {
    const { data: stepRow } = await db()
      .from("DesignSessionStepData")
      .select("id, data")
      .eq("sessionId", args.session)
      .eq("stepKey", "briefing")
      .maybeSingle();
    const stepData = (stepRow?.data ?? {}) as Record<string, unknown>;
    if (!stepData.firstMessageAt) {
      const markerIso = new Date(Date.now() - 1).toISOString();
      const nextData = { ...stepData, firstMessageAt: markerIso };
      if (stepRow) {
        await db()
          .from("DesignSessionStepData")
          .update({ data: nextData, updatedAt: new Date().toISOString() })
          .eq("id", stepRow.id);
      } else {
        await db().from("DesignSessionStepData").insert({
          sessionId: args.session,
          stepKey: "briefing",
          stepIndex: session.currentStep ?? 0,
          data: nextData,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  await persistUserMessage(threadId, message);
  console.log(dim(`▸ Thread: ${threadId} (user msg persistido)`));
  console.log();

  // 3. Capabilities — mirror webConnector: createTasks gated to briefing step.
  const capabilities: Capabilities = {
    maxSteps: 30,
    writeTools: true,
    readTools: true,
    webSearch: true,
    projectId: session.projectId ?? undefined,
    createTasks: currentStepKey === "briefing",
    memberId: args.memberId,
  };

  // 4. Run agent
  const result = await runAgent({
    agent: vitorAgent,
    thread: { id: threadId },
    capabilities,
    userMessage: message,
    memberId: args.memberId ?? null,
    params: { sessionId: args.session, currentStepKey },
  });

  // 5. Stream consume — print live, capture parts for persistence
  console.log(cyan("════════ VITOR ════════"));
  let collectedText = "";
  const parts: Array<Record<string, unknown>> = [];
  const toolCalls: Array<{ name: string; input: unknown; output?: unknown }> = [];
  const toolCallById = new Map<string, { name: string; input: unknown }>();

  for await (const chunk of result.streamText.fullStream) {
    switch (chunk.type) {
      case "text-delta": {
        const delta = (chunk as { text?: string; delta?: string }).text ?? (chunk as { delta?: string }).delta ?? "";
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
        // OK — drain
        break;
      }
      case "error": {
        console.log(`\n${yellow("▸ stream error:")}`, chunk);
        break;
      }
      default:
        // text-start / text-end / step-finish / etc — silent
        break;
    }
  }

  // 6. Persist assistant message (text + parts so UI can rebuild chips)
  if (collectedText) parts.push({ type: "text", text: collectedText });
  await persistAssistantMessage(threadId, collectedText, parts);

  // 7. Optional: advance currentStep
  if (args.advanceTo != null) {
    await db()
      .from("DesignSession")
      .update({ currentStep: args.advanceTo, updatedAt: new Date().toISOString() })
      .eq("id", args.session);
    console.log(`\n${yellow(`▸ currentStep avancado para ${args.advanceTo} (${steps[args.advanceTo]?.key ?? "?"})`)}`);
  }

  // 8. Summary
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
