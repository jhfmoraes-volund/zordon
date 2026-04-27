/**
 * Live mode — runs eval cases against a real Vitor invocation.
 *
 * For each case:
 *  1. Seeds Project + DesignSession + ChatThread + step data via service-role.
 *  2. Skips fixtures whose tables don't exist yet (decisions/openQuestions/research/etc) —
 *     marks the case as `skipped` if such fixtures are present and required.
 *  3. Calls runAgent for each turn, consumes stream, collects tool calls + text.
 *  4. Runs the rule-based judge against expectations.
 *  5. Cleans up by cascade-deleting the test Project (unless --keep).
 *
 * Cost: ~$0.02-0.05 per turn against Sonnet 4.6 on OpenRouter.
 */

import "dotenv/config";
import { db } from "@/lib/db";
import { runAgent } from "@/lib/agent/engine";
import { vitorAgent } from "@/lib/agent/agents/vitor";
import {
  ensureThread,
  persistUserMessage,
  persistAssistantMessage,
} from "@/lib/agent/context";
import type { Capabilities } from "@/lib/agent/types";
import type { EvalCase, CaseResult } from "./types";
import { judgeRun, type RunOutput } from "./judge";

const EVAL_TAG = "__eval__";

/**
 * Tables that the plan introduces in Phase 1+ but don't exist yet.
 * If a case's setup needs any of these, the case is skipped in live mode.
 */
const FUTURE_TABLES = new Set([
  "DesignDecision",
  "DesignOpenQuestion",
  "DesignSessionResearch",
  "ProjectBusinessContext",
  "Project.memoryMd",
]);

interface SeedFootprint {
  clientId: string;
  projectId: string;
  sessionId: string;
  threadId: string;
}

interface LiveOptions {
  caseFilter?: string;
  keep?: boolean;
  budgetMaxCases?: number;
}

export async function runLive(
  cases: EvalCase[],
  options: LiveOptions = {},
): Promise<CaseResult[]> {
  const filtered = options.caseFilter
    ? cases.filter((c) => c.name === options.caseFilter)
    : cases;

  if (filtered.length === 0) {
    console.error(`No case matched filter "${options.caseFilter}".`);
    return [];
  }

  if (options.budgetMaxCases && filtered.length > options.budgetMaxCases) {
    console.error(
      `Refusing to run ${filtered.length} cases (budget cap = ${options.budgetMaxCases}). ` +
        `Use --case=name to run one, or pass --no-budget.`,
    );
    return [];
  }

  const results: CaseResult[] = [];
  for (const c of filtered) {
    console.log(`\n--- ${c.name} ---`);
    const result = await runOneCase(c, options);
    results.push(result);
    printCaseResult(result);
  }

  printSummary(results);
  return results;
}

async function runOneCase(c: EvalCase, options: LiveOptions): Promise<CaseResult> {
  const skipReason = checkSeedFeasibility(c);
  if (skipReason) {
    return {
      caseName: c.name,
      status: "skipped",
      reason: skipReason,
      toolCalls: [],
      responseText: "",
      failures: [],
    };
  }

  let footprint: SeedFootprint | null = null;
  try {
    footprint = await seedCase(c);
    const output = await runConversation(c, footprint);
    const judged = judgeRun(c, output);
    return {
      caseName: c.name,
      status: judged.status,
      reason: judged.reason,
      toolCalls: output.toolCalls,
      responseText: output.responseText,
      failures: judged.failures,
    };
  } catch (err) {
    return {
      caseName: c.name,
      status: "error",
      reason: err instanceof Error ? err.message : String(err),
      toolCalls: [],
      responseText: "",
      failures: [],
    };
  } finally {
    if (footprint && !options.keep) {
      await cleanupCase(footprint).catch((err) =>
        console.error(`[cleanup] ${c.name}: ${err}`),
      );
    } else if (footprint && options.keep) {
      console.log(
        `[keep] preserved Project ${footprint.projectId} for inspection`,
      );
    }
  }
}

function checkSeedFeasibility(_c: EvalCase): string | null {
  // Phase 1 migrations applied — all tables exist now.
  // Kept as a hook for future blockers (e.g., features that require Phase 4 hooks).
  return null;
}

async function seedCase(c: EvalCase): Promise<SeedFootprint> {
  const supabase = db();
  const ts = Date.now();
  const tag = `${EVAL_TAG}${c.name}-${ts}`;

  // Find or create eval client
  const { data: existingClient } = await supabase
    .from("Client")
    .select("id")
    .eq("name", `${EVAL_TAG}client`)
    .maybeSingle();

  const now = new Date().toISOString();
  let clientId: string;
  if (existingClient) {
    clientId = existingClient.id;
  } else {
    const newId = crypto.randomUUID();
    const { error } = await supabase
      .from("Client")
      .insert({ id: newId, name: `${EVAL_TAG}client`, updatedAt: now });
    if (error) throw new Error(`seed Client: ${error.message}`);
    clientId = newId;
  }

  // Project (with optional memoryMd)
  const projectId = crypto.randomUUID();
  const { error: pErr } = await supabase.from("Project").insert({
    id: projectId,
    clientId,
    name: tag,
    status: "active",
    memoryMd: c.setup.project?.memoryMd ?? null,
    memoryUpdatedAt: c.setup.project?.memoryMd ? now : null,
    updatedAt: now,
  });
  if (pErr) throw new Error(`seed Project: ${pErr.message}`);

  // BusinessContext (optional)
  if (c.setup.project?.businessContext) {
    const bc = c.setup.project.businessContext;
    const { error: bcErr } = await supabase.from("ProjectBusinessContext").insert({
      projectId,
      businessModel: bc.businessModel ?? null,
      stage: bc.stage ?? null,
      icp: bc.icp ?? null,
      ticketRangeBrl: bc.ticketRangeBrl
        ? `[${bc.ticketRangeBrl[0]},${bc.ticketRangeBrl[1]}]`
        : null,
      runwayMonths: bc.runwayMonths ?? null,
      competitors: (bc.competitors ?? null) as never,
    });
    if (bcErr) throw new Error(`seed BusinessContext: ${bcErr.message}`);
  }

  // Other sessions for cross-session cases
  if (c.setup.project?.otherSessions?.length) {
    const otherRows = c.setup.project.otherSessions.map((s) => ({
      id: `${s.id}-${ts}`,
      projectId,
      title: s.title,
      type: s.type,
      status: s.status,
      currentStep: 0,
      totalSteps: 9,
      memoryMd: s.memoryMd ?? null,
      memoryAbstract: s.memoryAbstract ?? null,
      updatedAt: now,
    }));
    const { error: osErr } = await supabase
      .from("DesignSession")
      .insert(otherRows);
    if (osErr) throw new Error(`seed otherSessions: ${osErr.message}`);
  }

  // Main DesignSession
  const sessionId = `${c.setup.session.id}-${ts}`;
  const { error: sErr } = await supabase.from("DesignSession").insert({
    id: sessionId,
    projectId,
    title: c.setup.session.title,
    type: c.setup.session.type,
    status: c.setup.session.status,
    currentStep: 0,
    totalSteps: 9,
    memoryMd: c.setup.session.memoryMd ?? null,
    memoryAbstract: c.setup.session.memoryAbstract ?? null,
    updatedAt: now,
  });
  if (sErr) throw new Error(`seed DesignSession: ${sErr.message}`);

  // Step data
  if (c.setup.session.stepData) {
    const rows = Object.entries(c.setup.session.stepData).map(
      ([stepKey, data], idx) => ({
        id: crypto.randomUUID(),
        sessionId,
        stepKey,
        stepIndex: idx,
        data: data as never,
        updatedAt: new Date().toISOString(),
      }),
    );
    const { error: dErr } = await supabase
      .from("DesignSessionStepData")
      .insert(rows);
    if (dErr) throw new Error(`seed StepData: ${dErr.message}`);
  }

  // Decisions
  if (c.setup.decisions?.length) {
    const rows = c.setup.decisions.map((d) => ({
      id: d.id,
      sessionId,
      projectId,
      statement: d.statement,
      rationale: d.rationale,
      confidence: d.confidence,
      status: d.status,
      tags: d.tags ?? null,
      createdAt: d.createdAt,
      createdBy: "eval",
    }));
    const { error: decErr } = await supabase.from("DesignDecision").insert(rows);
    if (decErr) throw new Error(`seed Decisions: ${decErr.message}`);
  }

  // Open questions
  if (c.setup.openQuestions?.length) {
    const rows = c.setup.openQuestions.map((q) => ({
      id: q.id,
      sessionId,
      projectId,
      question: q.question,
      blocksWhat: q.blocksWhat ?? null,
      status: q.status,
      createdAt: q.createdAt,
    }));
    const { error: qErr } = await supabase.from("DesignOpenQuestion").insert(rows);
    if (qErr) throw new Error(`seed OpenQuestions: ${qErr.message}`);
  }

  // Research log
  if (c.setup.research?.length) {
    const rows = c.setup.research.map((r) => ({
      id: r.id,
      sessionId,
      projectId,
      query: r.query,
      summary: r.summary,
      sources: r.sources as never,
      createdAt: r.createdAt,
    }));
    const { error: rErr } = await supabase
      .from("DesignSessionResearch")
      .insert(rows);
    if (rErr) throw new Error(`seed Research: ${rErr.message}`);
  }

  // Thread
  const threadId = await ensureThread(sessionId, "web");

  return { clientId, projectId, sessionId, threadId };
}

async function runConversation(
  c: EvalCase,
  fp: SeedFootprint,
): Promise<RunOutput> {
  const allToolCalls: { name: string; args: unknown }[] = [];
  let allText = "";

  const capabilities: Capabilities = {
    maxSteps: 6,
    writeTools: true,
    readTools: true,
    webSearch: true,
    createTasks: false,
    projectId: fp.projectId,
  };

  for (const turn of c.turns) {
    await persistUserMessage(fp.threadId, turn.content);

    const result = await runAgent({
      agent: vitorAgent,
      thread: { id: fp.threadId },
      capabilities,
      userMessage: turn.content,
      params: {
        sessionId: fp.sessionId,
        currentStepKey: c.setup.currentStepKey,
      },
    });

    let turnText = "";
    for await (const part of result.streamText.fullStream) {
      if (part.type === "text-delta") {
        turnText += (part as { text: string }).text;
      }
      if (part.type === "tool-call") {
        const tc = part as { toolName: string; input: unknown };
        allToolCalls.push({ name: tc.toolName, args: tc.input });
      }
    }
    allText += turnText + "\n";
    await persistAssistantMessage(fp.threadId, turnText);
  }

  return { toolCalls: allToolCalls, responseText: allText.trim() };
}

async function cleanupCase(fp: SeedFootprint): Promise<void> {
  const supabase = db();
  // Cascade order: delete dependents before parents.
  await supabase.from("ChatMessage").delete().eq("threadId", fp.threadId);
  await supabase.from("ChatThread").delete().eq("id", fp.threadId);
  await supabase.from("DesignSessionStepData").delete().eq("sessionId", fp.sessionId);
  await supabase.from("DesignSession").delete().eq("id", fp.sessionId);
  await supabase.from("Project").delete().eq("id", fp.projectId);
  // Don't delete Client — reused across runs
}

function printCaseResult(r: CaseResult): void {
  const icon =
    r.status === "pass" ? "PASS" :
    r.status === "partial" ? "PART" :
    r.status === "fail" ? "FAIL" :
    r.status === "skipped" ? "SKIP" : "ERR ";
  console.log(`  [${icon}] ${r.caseName} — ${r.reason}`);
  if (r.failures.length > 0) {
    r.failures.forEach((f) => console.log(`    × ${f}`));
  }
  if (r.responseText) {
    const preview = r.responseText.replace(/\s+/g, " ").slice(0, 200);
    console.log(`    response: "${preview}${r.responseText.length > 200 ? "…" : ""}"`);
  }
  if (r.toolCalls.length > 0) {
    const calls = r.toolCalls.map((t) => t.name).join(", ");
    console.log(`    tools called: ${calls}`);
  }
}

function printSummary(results: CaseResult[]): void {
  const counts = { pass: 0, partial: 0, fail: 0, skipped: 0, error: 0 };
  for (const r of results) counts[r.status]++;
  console.log("\n=== Live summary ===");
  console.log(`  pass:    ${counts.pass}`);
  console.log(`  partial: ${counts.partial}`);
  console.log(`  fail:    ${counts.fail}`);
  console.log(`  skipped: ${counts.skipped}`);
  console.log(`  error:   ${counts.error}`);
  const denom = results.length - counts.skipped;
  if (denom > 0) {
    const passRate = ((counts.pass + counts.partial * 0.5) / denom) * 100;
    console.log(`  pass rate (excl. skipped): ${passRate.toFixed(1)}%`);
  }
  console.log("");
}
