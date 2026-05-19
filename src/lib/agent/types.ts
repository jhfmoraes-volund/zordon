import type { ToolSet } from "ai";

// ─── Capabilities ────────────────────────────────────────

export interface Capabilities {
  /** Maximum tool-call steps per run */
  maxSteps: number;
  /** Whether the agent can use write tools (write_X per entity) */
  writeTools: boolean;
  /** Whether the agent can use read tools (read_X per entity) */
  readTools: boolean;
  /** Whether the agent can search the web */
  webSearch?: boolean;
  /** Whether the agent can create tasks in the backlog */
  createTasks?: boolean;
  /** Project ID for task creation (required when createTasks is true) */
  projectId?: string;
  /** Member id of the human who triggered the run — credited as task creator. */
  memberId?: string;
  /** Composio integration settings */
  composio?: {
    userId: string;
    toolkits: string[];
  };
  /** Per-user Roam API token. Loaded from member_integrations before each run. */
  roamToken?: string;
  /** Per-user Granola API token. Loaded from member_integrations before each run. */
  granolaToken?: string;
  /** When true, agent plans in text and waits for "Executar" before running write tools. Default false (ACT). */
  planMode?: boolean;
}

// ─── Engine contracts ────────────────────────────────────

/**
 * Context passed to the prompt builder at runtime.
 * Generic enough for any agent — each agent picks what it needs.
 */
export interface PromptContext {
  /** Chat message history for context */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messageHistory: any[];
  /** Raw capabilities for the run */
  capabilities: Capabilities;
  /** Extra context loaded by the agent (session data, sprint data, etc.) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agentContext: Record<string, any>;
}

/**
 * Output of buildPrompt — split in two so the engine can mark `stable` as
 * cacheable (Anthropic prompt cache via OpenRouter) and append `volatile`
 * without invalidating the cache. See docs/vitor-cost-reduction-plan.md F1.
 */
export interface SystemPrompt {
  /** Stable prefix — identity, behavior rules, schemas. Cacheable across turns. */
  stable: string;
  /** Volatile suffix — session/step data, memory blocks. Changes per turn. */
  volatile: string;
}

/**
 * Agent definition — prompt builder + tool assembler + context loader.
 * Each agent (Vitor, Alpha, ...) implements this interface.
 */
export interface AgentDefinition {
  name: string;
  /** Optional per-agent model override. Falls back to DEFAULT_MODEL when absent. */
  model?: string;
  /** Builds the system prompt given runtime context */
  buildPrompt: (ctx: PromptContext) => SystemPrompt;
  /** Assembles tools for this run */
  buildTools: (ctx: PromptContext) => ToolSet | Promise<ToolSet>;
  /** Loads agent-specific context (session data, sprint overview, etc.) */
  loadContext: (req: AgentRunRequest) => Promise<Record<string, unknown>>;
}

export interface AgentRunRequest {
  agent: AgentDefinition;
  thread: { id: string };
  capabilities: Capabilities;
  userMessage: string;
  /** Member that triggered the run — used for cost attribution. */
  memberId?: string | null;
  /** Extra params agents may need (sessionId, sprintId, etc.) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>;
}

export interface AgentRunResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamText: any; // StreamTextResult — generic params vary per tool set
}

// ─── Chat data ───────────────────────────────────────────

export interface ChatThread {
  id: string;
  sessionId: string;
  channel: "web" | "telegram" | "trigger";
  title: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls: unknown | null;
  toolResults: unknown | null;
  actions: unknown | null;
  createdAt: string;
}
