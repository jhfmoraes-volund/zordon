import type {
  ForgeAgent,
  ForgeEvent,
  ForgeState,
  ForgeTask,
  AgentStatus,
} from "./types";
import { TASK_EVENT_CAP } from "./types";

const RETAINED_KINDS = new Set<ForgeEvent["kind"]>([
  "thought",
  "token",
  "tool_call",
  "tool_result",
  "metric",
  "error",
  "status",
]);

function appendTaskEvent(state: ForgeState, e: ForgeEvent): ForgeState {
  if (!e.task_id || !RETAINED_KINDS.has(e.kind)) return state;
  const prev = state.taskEvents[e.task_id] ?? [];
  const next = prev.length >= TASK_EVENT_CAP
    ? [...prev.slice(prev.length - TASK_EVENT_CAP + 1), e]
    : [...prev, e];
  return {
    ...state,
    taskEvents: { ...state.taskEvents, [e.task_id]: next },
  };
}

function num(payload: Record<string, unknown>, key: string, fallback = 0): number {
  const v = payload[key];
  return typeof v === "number" ? v : fallback;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" ? v : null;
}

function updateAgent(state: ForgeState, id: string, patch: Partial<ForgeAgent>): ForgeState {
  const existing = state.agents[id];
  if (!existing) return state;
  return {
    ...state,
    agents: { ...state.agents, [id]: { ...existing, ...patch } },
  };
}

function updateTask(state: ForgeState, id: string, patch: Partial<ForgeTask>): ForgeState {
  const existing = state.tasks[id];
  if (!existing) return state;
  return {
    ...state,
    tasks: { ...state.tasks, [id]: { ...existing, ...patch } },
  };
}

function bumpRunProgress(state: ForgeState): ForgeState {
  if (!state.run) return state;
  const tasks = state.taskOrder.map((id) => state.tasks[id]);
  if (tasks.length === 0) return state;
  const sum = tasks.reduce((acc, t) => acc + t.progress, 0);
  const progress = Math.round(sum / tasks.length);
  const tokens_total = Object.values(state.agents).reduce(
    (acc, a) => acc + a.tokens_in + a.tokens_out,
    0,
  );
  const cost_total = Object.values(state.agents).reduce((acc, a) => acc + a.cost_usd, 0);
  return {
    ...state,
    run: { ...state.run, progress, tokens_total, cost_total },
  };
}

export function applyEvent(state: ForgeState, e: ForgeEvent): ForgeState {
  if (e.seq <= state.lastSeq) return state;
  const reduced = reduceCore(state, e);
  return appendTaskEvent(reduced, e);
}

function reduceCore(state: ForgeState, e: ForgeEvent): ForgeState {
  let next = { ...state, lastSeq: e.seq };

  switch (e.kind) {
    case "spawn": {
      if (!e.agent_id) return next;
      const agent: ForgeAgent = {
        id: e.agent_id,
        run_id: e.run_id,
        parent_id: str(e.payload, "parent_id"),
        name: str(e.payload, "name") ?? "AGENT",
        role: (str(e.payload, "role") as "root" | "subagent" | null) ?? "subagent",
        status: "spawning",
        progress: 0,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        started_at: e.ts,
        ended_at: null,
      };
      if (!next.run) {
        next = {
          ...next,
          run: {
            id: e.run_id,
            title: str(e.payload, "run_title") ?? "Forge Run",
            status: "running",
            progress: 0,
            started_at: e.ts,
            ended_at: null,
            tokens_total: 0,
            cost_total: 0,
          },
        };
      }
      next = {
        ...next,
        agents: { ...next.agents, [agent.id]: agent },
        agentOrder: [...next.agentOrder, agent.id],
      };
      return next;
    }

    case "task_spawn": {
      if (!e.task_id || !e.agent_id) return next;
      const task: ForgeTask = {
        id: e.task_id,
        run_id: e.run_id,
        agent_id: e.agent_id,
        ord: num(e.payload, "ord", next.taskOrder.length + 1),
        title: str(e.payload, "title") ?? "Task",
        status: "thinking",
        progress: 0,
        current_tool: null,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        started_at: e.ts,
        ended_at: null,
      };
      next = {
        ...next,
        tasks: { ...next.tasks, [task.id]: task },
        taskOrder: [...next.taskOrder, task.id],
      };
      return next;
    }

    case "status": {
      const status = str(e.payload, "status") as AgentStatus | null;
      if (!status) return next;
      if (e.task_id) next = updateTask(next, e.task_id, { status });
      if (e.agent_id) next = updateAgent(next, e.agent_id, { status });
      return next;
    }

    case "tool_call": {
      const tool = str(e.payload, "tool");
      if (e.task_id && tool) {
        next = updateTask(next, e.task_id, { current_tool: tool, status: "tool" });
      }
      return next;
    }

    case "tool_result": {
      if (e.task_id) {
        next = updateTask(next, e.task_id, { current_tool: null, status: "thinking" });
      }
      return next;
    }

    case "token": {
      const out = num(e.payload, "out", 1);
      const inc = num(e.payload, "in", 0);
      const progressDelta = num(e.payload, "progress_delta", 0);
      if (e.task_id) {
        const t = next.tasks[e.task_id];
        if (t) {
          next = updateTask(next, e.task_id, {
            tokens_in: t.tokens_in + inc,
            tokens_out: t.tokens_out + out,
            progress: Math.min(100, t.progress + progressDelta),
            status: "streaming",
          });
        }
      }
      if (e.agent_id) {
        const a = next.agents[e.agent_id];
        if (a) {
          next = updateAgent(next, e.agent_id, {
            tokens_in: a.tokens_in + inc,
            tokens_out: a.tokens_out + out,
          });
        }
      }
      next = bumpRunProgress(next);
      return next;
    }

    case "metric": {
      const cost = num(e.payload, "cost_usd_delta", 0);
      if (e.agent_id) {
        const a = next.agents[e.agent_id];
        if (a) next = updateAgent(next, e.agent_id, { cost_usd: a.cost_usd + cost });
      }
      if (e.task_id) {
        const t = next.tasks[e.task_id];
        if (t) next = updateTask(next, e.task_id, { cost_usd: t.cost_usd + cost });
      }
      next = bumpRunProgress(next);
      return next;
    }

    case "done": {
      if (e.task_id) {
        next = updateTask(next, e.task_id, {
          status: "done",
          progress: 100,
          current_tool: null,
          ended_at: e.ts,
        });
      }
      if (e.agent_id) {
        next = updateAgent(next, e.agent_id, {
          status: "done",
          progress: 100,
          ended_at: e.ts,
        });
      }
      if (str(e.payload, "scope") === "run" && next.run) {
        next = {
          ...next,
          run: { ...next.run, status: "done", progress: 100, ended_at: e.ts },
        };
      }
      next = bumpRunProgress(next);
      return next;
    }

    case "error": {
      if (e.task_id) next = updateTask(next, e.task_id, { status: "error" });
      if (e.agent_id) next = updateAgent(next, e.agent_id, { status: "error" });
      if (next.run) next = { ...next, run: { ...next.run, status: "error" } };
      return next;
    }

    case "thought":
      return next;

    default:
      return next;
  }
}
