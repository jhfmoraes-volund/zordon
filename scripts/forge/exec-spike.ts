#!/usr/bin/env tsx
/**
 * Spike orchestrator. Runs claude -p with a tiny prompt and emits events
 * to .forge/<runId>/events.jsonl. Invoked detached by /api/forge/runs.
 *
 * Usage: tsx scripts/forge/exec-spike.ts <runId> <taskId>
 */
import { mkdirSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname } from "node:path";

const [, , runId, taskId = "test-task"] = process.argv;

if (!runId) {
  console.error("usage: exec-spike.ts <runId> <taskId>");
  process.exit(64);
}

const eventsPath = `.forge/${runId}/events.jsonl`;
mkdirSync(dirname(eventsPath), { recursive: true });

let seq = 0;
function emit(kind: string, payload: Record<string, unknown> = {}) {
  seq += 1;
  const event = {
    runId,
    taskId,
    seq,
    ts: new Date().toISOString(),
    kind,
    payload,
  };
  appendFileSync(eventsPath, JSON.stringify(event) + "\n");
}

emit("started", { pid: process.pid });
emit("status", { message: "spawning claude -p" });

// Spawn claude -p with a short prompt. Inherits builder's auth from claude login.
const claude = spawn("claude", ["-p", "Say hello in exactly 5 words. No more."], {
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";

claude.stdout?.on("data", (chunk) => {
  const text = chunk.toString();
  stdout += text;
  emit("token", { text });
});

claude.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
});

claude.on("close", (code) => {
  emit("claude_response", { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code });
  emit("done", { ok: code === 0, totalEvents: seq + 1 });
  process.exit(code ?? 0);
});

claude.on("error", (err) => {
  emit("error", { message: err.message });
  emit("done", { ok: false, totalEvents: seq + 1 });
  process.exit(1);
});

// Safety timeout: 60s
setTimeout(() => {
  emit("error", { message: "timeout 60s" });
  claude.kill();
  process.exit(124);
}, 60000);
