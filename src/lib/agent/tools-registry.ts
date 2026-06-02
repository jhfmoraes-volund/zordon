import "server-only";
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

/**
 * Context passed pelo router pra cada factory. sessionId é obrigatório (todas
 * tools são session-scoped); projectId vem por lookup quando o tool precisa.
 */
export type ToolContext = {
  sessionId: string;
  projectId: string;
  memberId?: string | null;
};

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
  read_product_vision: (ctx) => createReadProductVisionTool(ctx.sessionId),
  read_scope: (ctx) => createReadScopeTool(ctx.sessionId),
  read_persona: (ctx) => createReadPersonaTool(ctx.sessionId),
  read_brainstorm: (ctx) => createReadBrainstormTool(ctx.sessionId),
  read_priority: (ctx) => createReadPriorityTool(ctx.sessionId),
  read_risk: (ctx) => createReadRiskTool(ctx.sessionId),
  read_gap: (ctx) => createReadGapTool(ctx.sessionId),
  read_tech_specs: (ctx) => createReadTechSpecsTool(ctx.sessionId),
  read_hypothesis: (ctx) => createReadHypothesisTool(ctx.sessionId),

  // ── DS entities — WRITE ───────────────────────────────────────────────
  write_product_vision: (ctx) => createWriteProductVisionTool(ctx.sessionId),
  write_scope_item: (ctx) => createWriteScopeItemTool(ctx.sessionId),
  write_persona: (ctx) => createWritePersonaTool(ctx.sessionId),
  write_brainstorm: (ctx) => createWriteBrainstormTool(ctx.sessionId),
  write_priority: (ctx) => createWritePriorityTool(ctx.sessionId),
  write_risk: (ctx) => createWriteRiskTool(ctx.sessionId),
  write_gap: (ctx) => createWriteGapTool(ctx.sessionId),
  write_tech_specs: (ctx) => createWriteTechSpecsTool(ctx.sessionId),
  write_hypothesis: (ctx) => createWriteHypothesisTool(ctx.sessionId),

  // ── Memória + Contexto ────────────────────────────────────────────────
  read_business_context: (ctx) =>
    createReadBusinessContextTool(ctx.sessionId, ctx.projectId),
  read_session_memory: (ctx) =>
    createReadSessionMemoryTool(ctx.sessionId, ctx.projectId),
  update_session_memory: (ctx) =>
    createUpdateSessionMemoryTool(ctx.sessionId, ctx.projectId),
  read_project_memory: (ctx) =>
    createReadProjectMemoryTool(ctx.sessionId, ctx.projectId),
  update_project_memory: (ctx) =>
    createUpdateProjectMemoryTool(ctx.sessionId, ctx.projectId),

  // ── Decisões ──────────────────────────────────────────────────────────
  record_decision: (ctx) =>
    createRecordDecisionTool(ctx.sessionId, ctx.projectId),
  revise_decision: (ctx) =>
    createReviseDecisionTool(ctx.sessionId, ctx.projectId),
  list_decisions: (ctx) =>
    createListDecisionsTool(ctx.sessionId, ctx.projectId),

  // ── Open questions ────────────────────────────────────────────────────
  add_open_question: (ctx) =>
    createAddOpenQuestionTool(ctx.sessionId, ctx.projectId),
  resolve_open_question: (ctx) =>
    createResolveOpenQuestionTool(ctx.sessionId, ctx.projectId),
  list_open_questions: (ctx) =>
    createListOpenQuestionsTool(ctx.sessionId, ctx.projectId),
};

/**
 * Helper: descobre nome de tools por agente. Por enquanto Vitor usa todas.
 * Vitoria/Alpha terão subsets diferentes quando entrarem (Fase 3).
 */
export function getToolNamesForAgent(agentSlug: string): string[] {
  if (agentSlug === "vitor") return Object.keys(TOOL_REGISTRY);
  // Vitoria/Alpha pendentes (mcpAvailable=false na settings page)
  return [];
}
