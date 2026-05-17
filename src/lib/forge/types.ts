export type AgentStatus =
  | "idle"
  | "spawning"
  | "thinking"
  | "tool"
  | "streaming"
  | "done"
  | "error";

export type RunStatus = "queued" | "running" | "done" | "error" | "aborted";

export type ForgeEventKind =
  | "spawn"
  | "task_spawn"
  | "status"
  | "thought"
  | "token"
  | "tool_call"
  | "tool_result"
  | "metric"
  | "error"
  | "done";

export type ForgeEvent = {
  run_id: string;
  seq: number;
  ts: number;
  agent_id: string | null;
  task_id: string | null;
  kind: ForgeEventKind;
  payload: Record<string, unknown>;
};

export type ForgeAgent = {
  id: string;
  run_id: string;
  parent_id: string | null;
  name: string;
  role: "root" | "subagent";
  status: AgentStatus;
  progress: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  started_at: number | null;
  ended_at: number | null;
};

export type ForgeTask = {
  id: string;
  run_id: string;
  agent_id: string;
  ord: number;
  title: string;
  status: AgentStatus;
  progress: number;
  current_tool: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  started_at: number | null;
  ended_at: number | null;
};

export type ForgeRun = {
  id: string;
  title: string;
  status: RunStatus;
  progress: number;
  started_at: number | null;
  ended_at: number | null;
  tokens_total: number;
  cost_total: number;
};

export type ForgeState = {
  run: ForgeRun | null;
  agents: Record<string, ForgeAgent>;
  tasks: Record<string, ForgeTask>;
  taskOrder: string[];
  agentOrder: string[];
  /** Eventos retidos por task (cap por TASK_EVENT_CAP). Usado pelo TaskSheet. */
  taskEvents: Record<string, ForgeEvent[]>;
  lastSeq: number;
};

export const TASK_EVENT_CAP = 500;

export const EMPTY_STATE: ForgeState = {
  run: null,
  agents: {},
  tasks: {},
  taskOrder: [],
  agentOrder: [],
  taskEvents: {},
  lastSeq: 0,
};
