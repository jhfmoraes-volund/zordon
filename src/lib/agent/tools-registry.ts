// Sem "server-only": é importado tanto pela rota Next.js do tool router
// quanto pelo MCP server CLI (repo zordon-daemon, que espelha este arquivo). server-only é
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
import { buildVitoriaTools } from "./agents/vitoria/tools";
import { buildReleasePlanningBoardTools } from "./agents/vitoria/release-planning";
import {
  createProposePrdTool,
  createReadPrdTool,
  createUpdatePrdTool,
  createApprovePrdTool,
  createLinkPrdDependencyTool,
  createListPrdsTool,
} from "./tools/prd";
import {
  createReadContextSourceTool,
  createListContextSourcesTool,
  createListLinkedSourcesTool,
} from "./tools/context-source";
import {
  createDescribeStructuredSourceTool,
  createQueryStructuredSourceTool,
} from "./tools/structured-source";
import {
  createReadWorkspaceFileTool,
  createGlobWorkspaceTool,
  createGrepWorkspaceTool,
} from "./tools/workspace";
import { assembleAlphaTools } from "./agents/alpha/tools";
import {
  listModulesForOpsTool,
  listPersonasForOpsTool,
  listStoriesForOpsTool,
  getStoryForOpsTool,
} from "./tools/alpha-hierarchy";
import {
  getProjectCapacityForOpsTool,
  listUnplannedTasksForOpsTool,
  verifySprintDistributionForOpsTool,
} from "./tools/alpha-planner";

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
  /** Vitoria Planning Ceremony surface — id da PlanningCeremony do thread
   *  (channel='planning'). Resolvido pelo tool router a partir do chatTurnId. */
  planningId?: string | null;
  /** Vitoria Release Planning surface — id da PlanningSession do thread
   *  (channel='release_planning'). As board tools (link_prd_to_sprint, …) usam
   *  isto; o staging usa planningId (companion ceremony, resolvida pelo router). */
  releasePlanningId?: string | null;
  /** Path absoluto do workspace clonado na Forja (<FORGE_HOME>/workspaces/<key>/).
   *  Null se projeto ainda não tem 1º Forge run. Workspace tools (read/glob/grep)
   *  validam todo path contra este prefix. */
  workspacePath?: string | null;
  /** Alpha (Fase 2): projeto/sprint resolvidos do ChatTurn.routePath (a página
   *  onde o PM está). Undefined quando a rota é global/sem foco. As tools
   *  route-scoped do Alpha (list_modules, get_project_capacity, …) usam isto. */
  routeProjectId?: string;
  routeSprintId?: string;
};

function requireSessionId(ctx: ToolContext): string {
  if (!ctx.sessionId) throw new Error("sessionId required for this tool");
  return ctx.sessionId;
}

function requireRouteProjectId(ctx: ToolContext): string {
  if (!ctx.routeProjectId) {
    throw new Error(
      "Esta tool é route-scoped: exige que o PM esteja numa página de projeto " +
        "(/projects/<id>). Peça pra abrir o projeto, ou use as tools globais " +
        "(get_backlog/list_sprints com projectName).",
    );
  }
  return ctx.routeProjectId;
}

function requirePMReviewId(ctx: ToolContext): string {
  if (!ctx.pmReviewId) throw new Error("pmReviewId required for this tool");
  return ctx.pmReviewId;
}

function requirePlanningId(ctx: ToolContext): string {
  if (!ctx.planningId) throw new Error("planningId required for this tool");
  return ctx.planningId;
}

function requireReleasePlanningId(ctx: ToolContext): string {
  if (!ctx.releasePlanningId)
    throw new Error("releasePlanningId required for this tool");
  return ctx.releasePlanningId;
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
      planningId: ctx.planningId ?? null,
      releasePlanningId: ctx.releasePlanningId ?? null,
    }),

  // INSUMOS estritos do ritual (EntityLink): só o que o PM linkou a ESTE
  // review/planning. É a fonte do PM Review (sem pool aberto → sem vazamento).
  // Re-consulta ao vivo, resolvendo o freeze do prompt em resume.
  list_linked_sources: (ctx) =>
    createListLinkedSourcesTool({
      sessionId: ctx.sessionId,
      pmReviewId: ctx.pmReviewId ?? null,
      planningId: ctx.planningId ?? null,
      releasePlanningId: ctx.releasePlanningId ?? null,
    }),

  // Pool ABERTO do projeto (curadoria) — Release Planning descobre fontes além
  // das linkadas e cura com link_context_source. Marca `linked` e exclui o
  // design_system. NÃO exposto ao PM Review (lá a fonte é só o linkado).
  list_context_sources: (ctx) =>
    createListContextSourcesTool(ctx.projectId, {
      sessionId: ctx.sessionId,
      pmReviewId: ctx.pmReviewId ?? null,
      planningId: ctx.planningId ?? null,
      releasePlanningId: ctx.releasePlanningId ?? null,
    }),

  // ── Insumos estruturados (JSON/CSV) — querying via SQL (DuckDB) ────────
  // Execução roda AQUI (processo do app); o daemon só expõe o schema e proxia.
  describe_structured_source: () => createDescribeStructuredSourceTool(),
  query_structured_source: () => createQueryStructuredSourceTool(),

  // ── Vitoria Release Planning — curadoria de insumos ────────────────────
  // Surface 'release_planning'. PRD↔sprint saiu (decisão 2026-06-19): a planning
  // LÊ fontes (insumos + PRDs via list_prds/read_prd) e produz tasks/stories.
  // O staging (propose_task_action…) usa ctx.planningId (companion ceremony);
  // link_context_source usa releasePlanningId (id da PlanningSession).
  link_context_source: (ctx) =>
    buildReleasePlanningBoardTools(
      requireReleasePlanningId(ctx),
      ctx.projectId,
      ctx.memberId ?? null,
    ).link_context_source,

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
  // Reuniões — get_recent_meetings lista Meetings internos (service_role, OK no
  // daemon); get_meeting_transcript/ask_meeting tocam Roam/Granola (token
  // per-user) → sem token degradam in-band (retornam {error}, não throw). O
  // Composio (GitHub/Calendar) continua FORA do daemon (daemon v2).
  "get_recent_meetings",
  "get_meeting_transcript",
  "ask_meeting",
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

// ── Alpha route-scoped reads (Fase 2) — exigem um projeto resolvido da rota
// (ChatTurn.routePath → ctx.routeProjectId). Sem rota de projeto,
// requireRouteProjectId devolve uma mensagem amigável pro modelo. Estas
// factories são alpha-only (só entram no set ALPHA_TOOLS) — não colidem com as
// factories session-bound do Vitor/Vitoria.
const ALPHA_ROUTE_TOOL_NAMES = [
  "list_modules",
  "list_personas",
  "list_stories",
  "get_story",
  "get_project_capacity",
  "list_unplanned_tasks",
  "verify_sprint_distribution",
] as const;

const ALPHA_ROUTE_FACTORIES: Record<string, (projectId: string) => Tool> = {
  list_modules: listModulesForOpsTool,
  list_personas: listPersonasForOpsTool,
  list_stories: listStoriesForOpsTool,
  get_story: getStoryForOpsTool,
  get_project_capacity: getProjectCapacityForOpsTool,
  list_unplanned_tasks: listUnplannedTasksForOpsTool,
  verify_sprint_distribution: verifySprintDistributionForOpsTool,
};

for (const name of ALPHA_ROUTE_TOOL_NAMES) {
  TOOL_REGISTRY[name] = (ctx) =>
    ALPHA_ROUTE_FACTORIES[name](requireRouteProjectId(ctx));
}

// ── Vitoria — tools reusadas de buildVitoriaTools (mesmas do path OpenRouter).
// Cada factory rebuilda o bundle (barato — só zod schemas) e devolve a tool
// nomeada. Split por dependência de ctx pra a Vitoria ser UMA só com
// awareness compartilhado entre PM Review e Planning:
//
//   SHARED_READ        — só projectId; situational awareness (sprint/tasks/
//                        capacidade/deps/DS). Servem PM Review E Planning.
//   PLANNING_PROJECT   — só projectId, mas exclusivas da Planning (escrita).
//   PLANNING_CEREMONY  — exigem planningId (staging/estado da ceremony).
//
// read_context_source NÃO entra aqui — reusa a entrada genérica acima (lê por
// id e recebe planningId no scope).
const VITORIA_SHARED_READ_NAMES = [
  "list_project_sprints",
  "list_project_tasks",
  "list_project_members",
  "get_sprint_capacity",
  "get_task_detail",
  "get_dependency_graph",
  "list_active_design_sessions",
  "read_design_session_memory",
  "read_design_session_step",
] as const;

const VITORIA_PLANNING_PROJECT_NAMES = [
  "propose_story",
  "append_project_memory",
] as const;

const VITORIA_PLANNING_CEREMONY_NAMES = [
  "add_context_note",
  "propose_task_action",
  "propose_tasks",
  "update_proposed_action",
  "delete_proposed_action",
  "get_planning_state",
] as const;

// projectId-only → planningId opcional (passa "" quando ausente; essas tools
// não o usam). PM Review (sem planningId) consegue chamar os reads.
for (const name of [
  ...VITORIA_SHARED_READ_NAMES,
  ...VITORIA_PLANNING_PROJECT_NAMES,
]) {
  TOOL_REGISTRY[name] = (ctx) =>
    buildVitoriaTools(ctx.planningId ?? "", ctx.projectId)[
      name as keyof ReturnType<typeof buildVitoriaTools>
    ] as Tool;
}

// planningId obrigatório (staging/estado da PlanningCeremony).
for (const name of VITORIA_PLANNING_CEREMONY_NAMES) {
  TOOL_REGISTRY[name] = (ctx) =>
    buildVitoriaTools(requirePlanningId(ctx), ctx.projectId)[
      name as keyof ReturnType<typeof buildVitoriaTools>
    ] as Tool;
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
  "describe_structured_source", "query_structured_source",
  "read_workspace_file", "glob_workspace", "grep_workspace",
]);

// Vitoria tem DUAS superfícies no daemon, com toolsets distintos:
//   pm_review → notas/report/indicadores (precisa pmReviewId)
//   planning  → staging de tasks/stories (precisa planningId)
const VITORIA_PMREVIEW_TOOLS = new Set<string>([
  "read_transcript_content",
  "read_context_source",
  // PM Review lê SÓ os insumos linkados (aba INSUMOS) — list_linked_sources, não
  // o pool aberto. Sem pool = sem vazamento de fonte não-curada pelo PM.
  "list_linked_sources",
  "describe_structured_source",
  "query_structured_source",
  "add_pm_review_note",
  "update_pm_review_report",
  "get_project_indicators",
  // Núcleo compartilhado: PM Review enxerga sprint/tasks/capacidade/deps/DS —
  // não fica cego do estado de sprint. Writes ficam só na Planning.
  ...VITORIA_SHARED_READ_NAMES,
]);

const VITORIA_PLANNING_TOOLS = new Set<string>([
  ...VITORIA_SHARED_READ_NAMES,
  ...VITORIA_PLANNING_PROJECT_NAMES,
  ...VITORIA_PLANNING_CEREMONY_NAMES,
  "read_context_source",
  "list_context_sources",
  "describe_structured_source",
  "query_structured_source",
]);

const ALPHA_TOOLS = new Set<string>([
  ...ALPHA_READ_TOOL_NAMES,
  ...ALPHA_ROUTE_TOOL_NAMES,
  "describe_structured_source",
  "query_structured_source",
]);

// Release Planning (surface 'release_planning'): board (PRD↔sprint) + staging
// (reusa as ceremony tools, ligadas à companion via ctx.planningId) + leitura
// (PRD/insumos) + structured querying. read_prd/read_context_source reusam as
// entradas genéricas. NÃO inclui as notas/report de PM Review.
const VITORIA_RELEASE_PLANNING_TOOLS = new Set<string>([
  // curadoria de insumos (PRD↔sprint board saiu — decisão 2026-06-19)
  "list_context_sources",
  "link_context_source",
  // leitura de FONTES: PRD (list/read) + insumos + structured query
  "read_prd",
  "list_prds",
  "read_context_source",
  "describe_structured_source",
  "query_structured_source",
  // núcleo compartilhado (sprint/tasks/capacidade/deps/DS)
  ...VITORIA_SHARED_READ_NAMES,
  // staging de tasks/stories (companion ceremony via ctx.planningId)
  ...VITORIA_PLANNING_PROJECT_NAMES,
  ...VITORIA_PLANNING_CEREMONY_NAMES,
]);

/**
 * Quais tools cada agente expõe via MCP. Filtra o registry global por slug +
 * superfície. Vitoria dispatcha por `surface` (vem do thread.channel):
 * 'planning' → staging; 'release_planning' → fontes (insumos+PRD) + staging; senão → PM Review.
 */
export function getToolNamesForAgent(
  agentSlug: string,
  surface?: string | null,
): string[] {
  if (agentSlug === "vitor") return [...VITOR_TOOLS];
  if (agentSlug === "vitoria") {
    if (surface === "planning") return [...VITORIA_PLANNING_TOOLS];
    if (surface === "release_planning")
      return [...VITORIA_RELEASE_PLANNING_TOOLS];
    return [...VITORIA_PMREVIEW_TOOLS];
  }
  if (agentSlug === "alpha") return [...ALPHA_TOOLS];
  return [];
}
