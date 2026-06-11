// Sem "server-only": é importado tanto pela rota Next.js do tool router
// quanto pelo MCP server CLI (scripts/daemon/mcp-server.ts). server-only é
// proteção do bundler do Next contra Client Components — em CLI quebra.
import type { Tool } from "ai";
import {
  createReadBrainstormTool,
  createReadGapTool,
  createReadHypothesisTool,
  createReadPersonaTool,
  createReadPriorityTool,
  createReadProductVisionTool,
  createReadRiskTool,
  createReadScopeTool,
  createReadTechSpecsTool,
} from "./tools/ds-entities";
import {
  createWriteBrainstormTool,
  createWriteGapTool,
  createWriteHypothesisTool,
  createWritePersonaTool,
  createWritePriorityTool,
  createWriteProductVisionTool,
  createWriteRiskTool,
  createWriteScopeItemTool,
  createWriteTechSpecsTool,
} from "./tools/ds-entities-write";
import {
  createAddOpenQuestionTool,
  createListDecisionsTool,
  createListOpenQuestionsTool,
  createReadBusinessContextTool,
  createReadProjectMemoryTool,
  createReadSessionMemoryTool,
  createRecordDecisionTool,
  createResolveOpenQuestionTool,
  createReviseDecisionTool,
  createUpdateProjectMemoryTool,
  createUpdateSessionMemoryTool,
} from "./tools/memory";
import { buildPMReviewTools } from "./agents/vitoria/pm-review";
import {
  createProposePrdTool,
  createReadPrdTool,
  createUpdatePrdTool,
  createApprovePrdTool,
  createLinkPrdDependencyTool,
  createListPrdsTool,
} from "./tools/prd";
import { createReadContextSourceTool } from "./tools/context-source";
import {
  createReadWorkspaceFileTool,
  createGlobWorkspaceTool,
  createGrepWorkspaceTool,
} from "./tools/workspace";
import { assembleAlphaTools } from "./agents/alpha/tools";

/**
 * Context passed pelo router pra cada factory. Campos opcionais — cada tool
 * declara o que precisa via runtime check (Vitor: sessionId; Vitoria PM
 * Review: pmReviewId).
 */
export type ToolContext = {
  sessionId: string | null;
  projectId: string;
  memberId?: string | null;
  pmReviewId?: string | null;
  /** Path absoluto do workspace clonado na Forja (<FORGE_HOME>/workspaces/<key>/).
   *  Null se projeto ainda não tem 1º Forge run. Workspace tools (read/glob/grep)
   *  validam todo path contra este prefix. */
  workspacePath?: string | null;
};

function requireSessionId(ctx: ToolContext): string {
  if (!ctx.sessionId) throw new Error("sessionId required for this tool");
  return ctx.sessionId;
}

function requirePMReviewId(ctx: ToolContext): string {
  if (!ctx.pmReviewId) throw new Error("pmReviewId required for this tool");
  return ctx.pmReviewId;
}

type ToolFactory = (ctx: ToolContext) => Tool;

/**
 * TOOL_REGISTRY — mapa nome → factory pra MCP server e tool router HTTP.
 *
 * Cada entrada reusa as factories existentes em src/lib/agent/tools/* sem
 * alterações. Pra adicionar tool nova ao agente via daemon, só registrar
 * aqui — sem duplicar lógica.
 *
 * Scope inicial (MVP DS Inception happy path): ~20 tools cobrindo entidades
 * de design (vision/scope/persona/brainstorm/etc.) + memória + decisões +
 * open questions. Story 13 do PRD chat-via-claude-local.
 *
 * Expansão futura: alpha-hierarchy, planning, propose_modules etc. virão em
 * stories seguintes ou quando outros agentes (Vitoria, Alpha) também usarem
 * claude-daemon (PRD Fase 3 do _future).
 */
export const TOOL_REGISTRY: Record<string, ToolFactory> = {
  // ── DS entities — READ ────────────────────────────────────────────────
  read_product_vision: (ctx) => createReadProductVisionTool(requireSessionId(ctx)),
  read_scope: (ctx) => createReadScopeTool(requireSessionId(ctx)),
  read_persona: (ctx) => createReadPersonaTool(requireSessionId(ctx)),
  read_brainstorm: (ctx) => createReadBrainstormTool(requireSessionId(ctx)),
  read_priority: (ctx) => createReadPriorityTool(requireSessionId(ctx)),
  read_risk: (ctx) => createReadRiskTool(requireSessionId(ctx)),
  read_gap: (ctx) => createReadGapTool(requireSessionId(ctx)),
  read_tech_specs: (ctx) => createReadTechSpecsTool(requireSessionId(ctx)),
  read_hypothesis: (ctx) => createReadHypothesisTool(requireSessionId(ctx)),

  // ── DS entities — WRITE ───────────────────────────────────────────────
  write_product_vision: (ctx) => createWriteProductVisionTool(requireSessionId(ctx)),
  write_scope_item: (ctx) => createWriteScopeItemTool(requireSessionId(ctx)),
  write_persona: (ctx) => createWritePersonaTool(requireSessionId(ctx)),
  write_brainstorm: (ctx) => createWriteBrainstormTool(requireSessionId(ctx)),
  write_priority: (ctx) => createWritePriorityTool(requireSessionId(ctx)),
  write_risk: (ctx) => createWriteRiskTool(requireSessionId(ctx)),
  write_gap: (ctx) => createWriteGapTool(requireSessionId(ctx)),
  write_tech_specs: (ctx) => createWriteTechSpecsTool(requireSessionId(ctx)),
  write_hypothesis: (ctx) => createWriteHypothesisTool(requireSessionId(ctx)),

  // ── Memória + Contexto ────────────────────────────────────────────────
  read_business_context: (ctx) =>
    createReadBusinessContextTool(requireSessionId(ctx), ctx.projectId),
  read_session_memory: (ctx) =>
    createReadSessionMemoryTool(requireSessionId(ctx), ctx.projectId),
  update_session_memory: (ctx) =>
    createUpdateSessionMemoryTool(requireSessionId(ctx), ctx.projectId),
  read_project_memory: (ctx) =>
    createReadProjectMemoryTool(requireSessionId(ctx), ctx.projectId),
  update_project_memory: (ctx) =>
    createUpdateProjectMemoryTool(requireSessionId(ctx), ctx.projectId),

  // ── Decisões ──────────────────────────────────────────────────────────
  record_decision: (ctx) =>
    createRecordDecisionTool(requireSessionId(ctx), ctx.projectId),
  revise_decision: (ctx) =>
    createReviseDecisionTool(requireSessionId(ctx), ctx.projectId),
  list_decisions: (ctx) =>
    createListDecisionsTool(requireSessionId(ctx), ctx.projectId),

  // ── Open questions ────────────────────────────────────────────────────
  add_open_question: (ctx) =>
    createAddOpenQuestionTool(requireSessionId(ctx), ctx.projectId),
  resolve_open_question: (ctx) =>
    createResolveOpenQuestionTool(requireSessionId(ctx), ctx.projectId),
  list_open_questions: (ctx) =>
    createListOpenQuestionsTool(requireSessionId(ctx), ctx.projectId),

  // ── Anexos / ContextSource ────────────────────────────────────────────
  read_context_source: (ctx) =>
    createReadContextSourceTool({
      sessionId: ctx.sessionId,
      pmReviewId: ctx.pmReviewId ?? null,
    }),

  // ── Workspace sandboxed (lê apenas dentro do workspace do projeto) ───
  read_workspace_file: (ctx) =>
    createReadWorkspaceFileTool({ workspacePath: ctx.workspacePath ?? null }),
  glob_workspace: (ctx) =>
    createGlobWorkspaceTool({ workspacePath: ctx.workspacePath ?? null }),
  grep_workspace: (ctx) =>
    createGrepWorkspaceTool({ workspacePath: ctx.workspacePath ?? null }),

  // ── PRDs (Vitor — sub-fase PRD_DRAFTING / PRD_REVIEW) ────────────────
  propose_prd: (ctx) =>
    createProposePrdTool(requireSessionId(ctx), ctx.projectId, ctx.memberId ?? null),
  read_prd: () => createReadPrdTool(),
  update_prd: (ctx) => createUpdatePrdTool(ctx.memberId ?? null),
  approve_prd: (ctx) => createApprovePrdTool(ctx.memberId ?? null),
  link_prd_dependency: (ctx) => createLinkPrdDependencyTool(ctx.memberId ?? null),
  list_prds: (ctx) => createListPrdsTool(ctx.projectId),

  // ── Vitoria PM Review tools ───────────────────────────────────────────
  // buildPMReviewTools retorna bundle de 4 tools; cada entrada aqui resolve
  // pra mesma instância da bundle (cheap re-build — só zod schemas).
  read_transcript_content: (ctx) =>
    buildPMReviewTools(requirePMReviewId(ctx), ctx.projectId)
      .read_transcript_content,
  add_pm_review_note: (ctx) =>
    buildPMReviewTools(requirePMReviewId(ctx), ctx.projectId)
      .add_pm_review_note,
  update_pm_review_report: (ctx) =>
    buildPMReviewTools(requirePMReviewId(ctx), ctx.projectId)
      .update_pm_review_report,
  get_project_indicators: (ctx) =>
    buildPMReviewTools(requirePMReviewId(ctx), ctx.projectId)
      .get_project_indicators,
};

// ── Alpha (ops) — subset read-only GLOBAL pro daemon ──────────────────────
// Reusa assembleAlphaTools sem rota (contexto global = sem routeProjectId) e
// sem writeTools (só leitura). As tools route-scoped (list_modules,
// get_project_capacity…), as de escrita (create_task, manage_allocation…) e
// Composio (GitHub/Calendar, token per-user) ficam FORA do daemon — seguem no
// path OpenRouter. Ver memory feedback_agent_chat_daemon_only.
const ALPHA_READ_TOOL_NAMES = [
  "get_sprint_overview",
  "get_tasks",
  "get_alerts",
  "list_sprints",
  "get_backlog",
  "get_allocated_project_members",
  "load_heuristic",
  "get_pending_actions",
] as const;

function alphaReadTool(name: string): ToolFactory {
  return (ctx) => {
    const tools = assembleAlphaTools(
      { maxSteps: 30, writeTools: false, readTools: true },
      { currentMemberId: ctx.memberId ?? undefined },
    );
    const t = tools[name] as Tool | undefined;
    if (!t) throw new Error(`alpha tool "${name}" not assembled`);
    return t;
  };
}

for (const name of ALPHA_READ_TOOL_NAMES) {
  TOOL_REGISTRY[name] = alphaReadTool(name);
}

const VITOR_TOOLS = new Set([
  "read_product_vision", "read_scope", "read_persona", "read_brainstorm",
  "read_priority", "read_risk", "read_gap", "read_tech_specs", "read_hypothesis",
  "write_product_vision", "write_scope_item", "write_persona", "write_brainstorm",
  "write_priority", "write_risk", "write_gap", "write_tech_specs", "write_hypothesis",
  "read_business_context", "read_session_memory", "update_session_memory",
  "read_project_memory", "update_project_memory",
  "record_decision", "revise_decision", "list_decisions",
  "add_open_question", "resolve_open_question", "list_open_questions",
  "propose_prd", "read_prd", "update_prd", "approve_prd", "link_prd_dependency", "list_prds",
  "read_context_source",
  "read_workspace_file", "glob_workspace", "grep_workspace",
]);

const VITORIA_TOOLS = new Set([
  "read_transcript_content",
  "read_context_source",
  "add_pm_review_note",
  "update_pm_review_report",
  "get_project_indicators",
]);

const ALPHA_TOOLS = new Set<string>(ALPHA_READ_TOOL_NAMES);

/**
 * Quais tools cada agente expõe via MCP. Filtra o registry global por slug.
 */
export function getToolNamesForAgent(agentSlug: string): string[] {
  if (agentSlug === "vitor") return [...VITOR_TOOLS];
  if (agentSlug === "vitoria") return [...VITORIA_TOOLS];
  if (agentSlug === "alpha") return [...ALPHA_TOOLS];
  return [];
}
