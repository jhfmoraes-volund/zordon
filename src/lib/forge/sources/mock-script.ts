import type { ForgeEvent, ForgeEventKind } from "../types";

export type ScriptStep = {
  at: number;
  kind: ForgeEventKind;
  agent_id?: string | null;
  task_id?: string | null;
  payload?: Record<string, unknown>;
};

const ARCH = "agent-arch";
const SCOUT = "agent-scout";
const WRITER = "agent-writer";
const TESTER = "agent-tester";

const T1 = "task-001";
const T2 = "task-002";
const T3 = "task-003";
const T4 = "task-004";
const T5 = "task-005";
const T6 = "task-006";

const tokensFor = (taskId: string, agentId: string, count: number, startAt: number, every = 6) =>
  Array.from({ length: count }, (_, i) => ({
    at: startAt + i * every,
    kind: "token" as const,
    task_id: taskId,
    agent_id: agentId,
    payload: {
      out: 1,
      progress_delta: Math.max(1, Math.round(100 / count)),
    },
  }));

const metricsFor = (taskId: string, agentId: string, points: number[]) =>
  points.map((at) => ({
    at,
    kind: "metric" as const,
    task_id: taskId,
    agent_id: agentId,
    payload: { cost_usd_delta: 0.0008 },
  }));

export const MOCK_SCRIPT: ScriptStep[] = [
  // 0–60 · root spawns + first task
  { at: 0,  kind: "spawn", agent_id: ARCH, payload: { name: "ARCHITECT", role: "root", run_title: "Forge demo · design session V2" } },
  { at: 8,  kind: "task_spawn", task_id: T1, agent_id: ARCH, payload: { ord: 1, title: "Planejando módulo de design sessions" } },
  { at: 12, kind: "thought", task_id: T1, agent_id: ARCH, payload: { text: "Analisando estrutura do módulo..." } },
  ...tokensFor(T1, ARCH, 20, 16, 4),
  ...metricsFor(T1, ARCH, [40, 80]),

  // 60–160 · SCOUT joins, reads files
  { at: 60, kind: "spawn", agent_id: SCOUT, payload: { name: "SCOUT", role: "subagent", parent_id: ARCH } },
  { at: 64, kind: "task_spawn", task_id: T2, agent_id: SCOUT, payload: { ord: 2, title: "Mapeando estrutura existente" } },
  { at: 68, kind: "tool_call", task_id: T2, agent_id: SCOUT, payload: { tool: "read_file" } },
  { at: 84, kind: "tool_result", task_id: T2, agent_id: SCOUT, payload: { tool: "read_file" } },
  ...tokensFor(T2, SCOUT, 16, 90, 5),
  { at: 175, kind: "tool_call", task_id: T2, agent_id: SCOUT, payload: { tool: "grep" } },
  { at: 185, kind: "tool_result", task_id: T2, agent_id: SCOUT, payload: { tool: "grep" } },
  ...tokensFor(T2, SCOUT, 10, 190, 4),
  ...metricsFor(T2, SCOUT, [100, 180, 220]),

  // 140–260 · WRITER drafts schema
  { at: 140, kind: "spawn", agent_id: WRITER, payload: { name: "WRITER", role: "subagent", parent_id: ARCH } },
  { at: 148, kind: "task_spawn", task_id: T3, agent_id: WRITER, payload: { ord: 3, title: "Redigindo proposta de schema" } },
  ...tokensFor(T3, WRITER, 30, 156, 4),
  ...metricsFor(T3, WRITER, [180, 240, 280]),

  // 200–320 · TESTER validates
  { at: 200, kind: "spawn", agent_id: TESTER, payload: { name: "TESTER", role: "subagent", parent_id: ARCH } },
  { at: 208, kind: "task_spawn", task_id: T4, agent_id: TESTER, payload: { ord: 4, title: "Validando RLS via select probes" } },
  { at: 214, kind: "tool_call", task_id: T4, agent_id: TESTER, payload: { tool: "sql_query" } },
  { at: 240, kind: "tool_result", task_id: T4, agent_id: TESTER, payload: { tool: "sql_query" } },
  ...tokensFor(T4, TESTER, 14, 244, 5),
  { at: 320, kind: "tool_call", task_id: T4, agent_id: TESTER, payload: { tool: "sql_query" } },
  { at: 335, kind: "tool_result", task_id: T4, agent_id: TESTER, payload: { tool: "sql_query" } },
  ...tokensFor(T4, TESTER, 8, 340, 4),
  ...metricsFor(T4, TESTER, [260, 320, 360]),

  // 280–360 · SCOUT second task
  { at: 280, kind: "task_spawn", task_id: T5, agent_id: SCOUT, payload: { ord: 5, title: "Conferindo migrations vizinhas" } },
  { at: 288, kind: "tool_call", task_id: T5, agent_id: SCOUT, payload: { tool: "read_file" } },
  { at: 305, kind: "tool_result", task_id: T5, agent_id: SCOUT, payload: { tool: "read_file" } },
  ...tokensFor(T5, SCOUT, 12, 310, 4),
  ...metricsFor(T5, SCOUT, [320, 360]),

  // 360–460 · ARCHITECT consolidates, all done
  { at: 365, kind: "task_spawn", task_id: T6, agent_id: ARCH, payload: { ord: 6, title: "Consolidando handoff pra Vitor" } },
  ...tokensFor(T6, ARCH, 22, 372, 4),
  ...metricsFor(T6, ARCH, [400, 440]),

  // close out (in order)
  { at: 470, kind: "done", task_id: T2, agent_id: SCOUT, payload: {} },
  { at: 475, kind: "done", task_id: T5, agent_id: SCOUT, payload: {} },
  { at: 478, kind: "done", agent_id: SCOUT, payload: {} },
  { at: 482, kind: "done", task_id: T3, agent_id: WRITER, payload: {} },
  { at: 484, kind: "done", agent_id: WRITER, payload: {} },
  { at: 488, kind: "done", task_id: T4, agent_id: TESTER, payload: {} },
  { at: 490, kind: "done", agent_id: TESTER, payload: {} },
  { at: 495, kind: "done", task_id: T1, agent_id: ARCH, payload: {} },
  { at: 498, kind: "done", task_id: T6, agent_id: ARCH, payload: {} },
  { at: 500, kind: "done", agent_id: ARCH, payload: { scope: "run" } },
];

/** Each script unit = 90ms real time at speed=1 → total ~45s for 500 units. */
export const MS_PER_UNIT = 90;

export const MOCK_RUN_ID = "run-mock-001";

/** Build a ForgeEvent from a script step + monotonic seq. */
export function stepToEvent(step: ScriptStep, seq: number, ts: number): ForgeEvent {
  return {
    run_id: MOCK_RUN_ID,
    seq,
    ts,
    agent_id: step.agent_id ?? null,
    task_id: step.task_id ?? null,
    kind: step.kind,
    payload: step.payload ?? {},
  };
}
