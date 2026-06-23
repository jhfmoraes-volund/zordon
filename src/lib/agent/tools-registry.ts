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
import {
  createReadWikiTool,
  createSetWikiEmphasisTool,
  createSuppressWikiBulletTool,
  createRestoreWikiBulletTool,
  createRecomposeWikiTool,
} from "./tools/wiki";
import type { Surface, ToolClass, ToolDescriptor } from "./tool-descriptor";

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

// ── require* — guardas que DÃO THROW (mensagens hand-tuned). Ficam DENTRO do
//    bind. O descriptor.needs apenas DECLARA quais campos cada bind guarda; a
//    consistência needs↔bind é provada por teste (scripts/agent-surface.test.ts).
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

/**
 * Projeto pras tools de Wiki: Vitoria surface 'wiki' resolve por ctx.projectId
 * (thread do projeto); Alpha global resolve por ctx.routeProjectId (a página
 * onde o PM está). Sem nenhum → erro que ensina (abra a página do projeto).
 * É um OR-requirement → descriptor.needs: [["routeProjectId", "projectId"]].
 */
function requireWikiProjectId(ctx: ToolContext): string {
  const pid = ctx.routeProjectId || ctx.projectId;
  if (!pid) {
    throw new Error(
      "Pra ajustar a Wiki preciso saber o projeto. Abra a página do projeto " +
        "(/projects/<id>) e peça de novo.",
    );
  }
  return pid;
}

// ── Grupos de superfície (legibilidade do pertencimento) ───────────────────
/** Núcleo de leitura situacional da Vitoria — serve TODAS as 4 superfícies. */
const VITORIA_READ_SURFACES: Surface[] = [
  "vitoria:pm_review",
  "vitoria:planning",
  "vitoria:release_planning",
  "vitoria:wiki",
];
/** Escrita/staging da Vitoria — Planning + Release Planning. */
const VITORIA_PLANNING_SURFACES: Surface[] = [
  "vitoria:planning",
  "vitoria:release_planning",
];

// ── Classe da tool (doutrina §2). Heurística por prefixo + overrides ────────
const CLASS_OVERRIDES: Record<string, ToolClass> = {
  read_session_memory: "remember",
  update_session_memory: "remember",
  read_project_memory: "remember",
  update_project_memory: "remember",
  append_project_memory: "remember",
};
function classOf(name: string): ToolClass {
  if (CLASS_OVERRIDES[name]) return CLASS_OVERRIDES[name];
  if (/^(read|list|get|query|describe|verify|ask|load)_/.test(name)) return "sense";
  return "act";
}

// ── Binds reutilizados (bundle-pick) ────────────────────────────────────────
type BindFn = (ctx: ToolContext) => Tool;
type VitoriaToolName = keyof ReturnType<typeof buildVitoriaTools>;

/** Vitoria reads/planning-project: planningId OPCIONAL (passa "" se ausente —
 *  PM Review chama os reads sem planningId). projectId é invariante (não é need).
 *  memberId vai pro closure (autor de add_task_comment, D7); null quando ausente. */
const vitoriaBind =
  (name: VitoriaToolName): BindFn =>
  (ctx) =>
    buildVitoriaTools(ctx.planningId ?? "", ctx.projectId, ctx.memberId ?? null)[name] as Tool;

/** Vitoria ceremony: planningId OBRIGATÓRIO (staging/estado da ceremony). */
const vitoriaCeremonyBind =
  (name: VitoriaToolName): BindFn =>
  (ctx) =>
    buildVitoriaTools(requirePlanningId(ctx), ctx.projectId, ctx.memberId ?? null)[name] as Tool;

/** Alpha (ops) — bundle assemblado threadando routeProjectId/routeSprintId. */
const alphaBind =
  (name: string, writeTools: boolean): BindFn =>
  (ctx) => {
    const tools = assembleAlphaTools(
      { maxSteps: 30, writeTools, readTools: true },
      {
        currentMemberId: ctx.memberId ?? undefined,
        routeProjectId: ctx.routeProjectId,
        routeSprintId: ctx.routeSprintId,
      },
    );
    const t = tools[name] as Tool | undefined;
    if (!t) throw new Error(`alpha tool "${name}" not assembled`);
    return t;
  };

/** Alpha route-scoped — exige projeto resolvido da rota. */
const alphaRouteBind =
  (factory: (projectId: string) => Tool): BindFn =>
  (ctx) =>
    factory(requireRouteProjectId(ctx));

// ── Listas de build dos grupos patternizados ────────────────────────────────
const VITORIA_SHARED_READ_NAMES: VitoriaToolName[] = [
  "list_project_sprints",
  "list_project_tasks",
  "list_project_members",
  "get_sprint_capacity",
  "get_task_detail",
  "get_dependency_graph",
  "list_active_design_sessions",
  "read_design_session_memory",
  "read_design_session_step",
  "list_project_modules", // hierarquia: módulos do projeto (reuse alpha-hierarchy)
  "list_project_stories", // hierarquia: US com título/módulo/persona/acCount
  "get_story_detail", // hierarquia: 1 story com AC inteiros
];
const VITORIA_PLANNING_PROJECT_NAMES: VitoriaToolName[] = [
  "propose_story", // create LIVE (draft) — tasks penduram via userStoryId na sessão
  "update_story", // STAGED — módulo/título/want/commit/AC viram card no canvas
  "approve_module", // STAGED — materializa Module e consolida stories no Concluir
  "append_project_memory",
  "add_task_comment", // write direto live (D7) — needs:[], autor via ctx.memberId
  "propose_sprint", // write direto live (D6) — needs:[], só projectId (invariante)
  "update_sprint", // write direto live (D6) — needs:[], valida projeto no execute
];
const VITORIA_PLANNING_CEREMONY_NAMES: VitoriaToolName[] = [
  "add_context_note",
  "propose_task_action",
  "propose_tasks",
  "propose_task_bulk_update", // staged (D9) — N× MeetingTaskAction(type=update); needs:["planningId"]
  "update_proposed_action",
  "delete_proposed_action",
  "get_planning_state",
];
// Alpha reads GLOBAIS no daemon (route-aware no app). Composio (GitHub/Calendar)
// fica FORA (token per-user, daemon v2). get_meeting_transcript/ask_meeting tocam
// Roam/Granola e degradam in-band sem token. Ver memory feedback_agent_chat_daemon_only.
const ALPHA_READ_TOOL_NAMES = [
  "get_sprint_overview",
  "get_tasks",
  "get_alerts",
  "list_sprints",
  "get_backlog",
  "get_allocated_project_members",
  "load_heuristic",
  "get_pending_actions",
  "get_recent_meetings",
  "get_meeting_transcript",
  "ask_meeting",
];
// update_task casa por taskReference (lookup global). create_task/bulk_update
// ficam fora (dependem de projeto resolvido da rota).
const ALPHA_WRITE_TOOL_NAMES = ["update_task"];
// Alpha route-scoped reads (exigem ctx.routeProjectId).
const ALPHA_ROUTE_FACTORIES: Record<string, (projectId: string) => Tool> = {
  list_modules: listModulesForOpsTool,
  list_personas: listPersonasForOpsTool,
  list_stories: listStoriesForOpsTool,
  get_story: getStoryForOpsTool,
  get_project_capacity: getProjectCapacityForOpsTool,
  list_unplanned_tasks: listUnplannedTasksForOpsTool,
  verify_sprint_distribution: verifySprintDistributionForOpsTool,
};

/**
 * RAW — descriptors sem `name`/`class` (injetados em buildRegistry). Cada
 * entrada é a ÚNICA fonte do seu pertencimento (`surfaces`) e escopo (`needs`).
 * Compartilhar uma tool = adicionar 1 surface ao array. O `bind` é a factory
 * existente (require* fica dentro). Ver runbook agent-capability-unification.
 */
type RawDescriptor = Omit<ToolDescriptor, "name" | "class"> & {
  class?: ToolClass;
};

const RAW: Record<string, RawDescriptor> = {
  // ── DS entities — READ (Vitor) ────────────────────────────────────────
  read_product_vision: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReadProductVisionTool(requireSessionId(ctx)) },
  read_scope: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReadScopeTool(requireSessionId(ctx)) },
  read_persona: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReadPersonaTool(requireSessionId(ctx)) },
  read_brainstorm: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReadBrainstormTool(requireSessionId(ctx)) },
  read_priority: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReadPriorityTool(requireSessionId(ctx)) },
  read_risk: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReadRiskTool(requireSessionId(ctx)) },
  read_gap: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReadGapTool(requireSessionId(ctx)) },
  read_tech_specs: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReadTechSpecsTool(requireSessionId(ctx)) },
  read_hypothesis: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReadHypothesisTool(requireSessionId(ctx)) },

  // ── DS entities — WRITE (Vitor) ───────────────────────────────────────
  write_product_vision: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createWriteProductVisionTool(requireSessionId(ctx)) },
  write_scope_item: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createWriteScopeItemTool(requireSessionId(ctx)) },
  write_persona: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createWritePersonaTool(requireSessionId(ctx)) },
  write_brainstorm: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createWriteBrainstormTool(requireSessionId(ctx)) },
  write_priority: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createWritePriorityTool(requireSessionId(ctx)) },
  write_risk: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createWriteRiskTool(requireSessionId(ctx)) },
  write_gap: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createWriteGapTool(requireSessionId(ctx)) },
  write_tech_specs: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createWriteTechSpecsTool(requireSessionId(ctx)) },
  write_hypothesis: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createWriteHypothesisTool(requireSessionId(ctx)) },

  // ── Memória + Contexto (Vitor) ────────────────────────────────────────
  read_business_context: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReadBusinessContextTool(requireSessionId(ctx), ctx.projectId) },
  read_session_memory: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReadSessionMemoryTool(requireSessionId(ctx), ctx.projectId) },
  update_session_memory: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createUpdateSessionMemoryTool(requireSessionId(ctx), ctx.projectId) },
  read_project_memory: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReadProjectMemoryTool(requireSessionId(ctx), ctx.projectId) },
  update_project_memory: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createUpdateProjectMemoryTool(requireSessionId(ctx), ctx.projectId) },

  // ── Decisões (Vitor) ──────────────────────────────────────────────────
  record_decision: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createRecordDecisionTool(requireSessionId(ctx), ctx.projectId) },
  revise_decision: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createReviseDecisionTool(requireSessionId(ctx), ctx.projectId) },
  list_decisions: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createListDecisionsTool(requireSessionId(ctx), ctx.projectId) },

  // ── Open questions (Vitor) ────────────────────────────────────────────
  add_open_question: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createAddOpenQuestionTool(requireSessionId(ctx), ctx.projectId) },
  resolve_open_question: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createResolveOpenQuestionTool(requireSessionId(ctx), ctx.projectId) },
  list_open_questions: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createListOpenQuestionsTool(requireSessionId(ctx), ctx.projectId) },

  // ── Anexos / ContextSource ────────────────────────────────────────────
  // read_context_source: scope-objeto (todos opcionais; o tool auto-resolve).
  // Compartilhado por Vitor + as 4 superfícies da Vitoria (não Alpha).
  read_context_source: {
    surfaces: ["vitor", "vitoria:pm_review", "vitoria:planning", "vitoria:release_planning", "vitoria:wiki"],
    needs: [],
    optional: ["sessionId", "pmReviewId", "planningId", "releasePlanningId"],
    bind: (ctx) =>
      createReadContextSourceTool({
        sessionId: ctx.sessionId,
        pmReviewId: ctx.pmReviewId ?? null,
        planningId: ctx.planningId ?? null,
        releasePlanningId: ctx.releasePlanningId ?? null,
      }),
  },
  // INSUMOS estritos do ritual (só o que o PM linkou a ESTE review). Só PM Review.
  list_linked_sources: {
    surfaces: ["vitoria:pm_review"],
    needs: [],
    optional: ["sessionId", "pmReviewId", "planningId", "releasePlanningId"],
    bind: (ctx) =>
      createListLinkedSourcesTool({
        sessionId: ctx.sessionId,
        pmReviewId: ctx.pmReviewId ?? null,
        planningId: ctx.planningId ?? null,
        releasePlanningId: ctx.releasePlanningId ?? null,
      }),
  },
  // Pool ABERTO do projeto (curadoria) — Planning + Release Planning. NÃO PM Review.
  list_context_sources: {
    surfaces: ["vitoria:planning", "vitoria:release_planning"],
    needs: [],
    optional: ["sessionId", "pmReviewId", "planningId", "releasePlanningId"],
    bind: (ctx) =>
      createListContextSourcesTool(ctx.projectId, {
        sessionId: ctx.sessionId,
        pmReviewId: ctx.pmReviewId ?? null,
        planningId: ctx.planningId ?? null,
        releasePlanningId: ctx.releasePlanningId ?? null,
      }),
  },

  // ── Insumos estruturados (JSON/CSV) — SQL via DuckDB. Execução no app; o
  //    daemon expõe schema e proxia. Vitor + Vitoria(pm/planning/release) + Alpha.
  describe_structured_source: {
    surfaces: ["vitor", "vitoria:pm_review", "vitoria:planning", "vitoria:release_planning", "alpha"],
    needs: [],
    bind: () => createDescribeStructuredSourceTool(),
  },
  query_structured_source: {
    surfaces: ["vitor", "vitoria:pm_review", "vitoria:planning", "vitoria:release_planning", "alpha"],
    needs: [],
    bind: () => createQueryStructuredSourceTool(),
  },

  // ── Release Planning — curadoria de insumos (board PRD↔sprint saiu 2026-06-19).
  link_context_source: {
    surfaces: ["vitoria:release_planning"],
    needs: ["releasePlanningId"],
    bind: (ctx) =>
      buildReleasePlanningBoardTools(
        requireReleasePlanningId(ctx),
        ctx.projectId,
        ctx.memberId ?? null,
      ).link_context_source,
  },

  // ── Workspace sandboxed (Vitor) — valida path contra ctx.workspacePath ──
  read_workspace_file: { surfaces: ["vitor"], needs: [], optional: ["workspacePath"], bind: (ctx) => createReadWorkspaceFileTool({ workspacePath: ctx.workspacePath ?? null }) },
  glob_workspace: { surfaces: ["vitor"], needs: [], optional: ["workspacePath"], bind: (ctx) => createGlobWorkspaceTool({ workspacePath: ctx.workspacePath ?? null }) },
  grep_workspace: { surfaces: ["vitor"], needs: [], optional: ["workspacePath"], bind: (ctx) => createGrepWorkspaceTool({ workspacePath: ctx.workspacePath ?? null }) },

  // ── PRDs (Vitor; read_prd/list_prds também no Release Planning) ─────────
  propose_prd: { surfaces: ["vitor"], needs: ["sessionId"], bind: (ctx) => createProposePrdTool(requireSessionId(ctx), ctx.projectId, ctx.memberId ?? null) },
  read_prd: { surfaces: ["vitor", "vitoria:release_planning"], needs: [], bind: () => createReadPrdTool() },
  update_prd: { surfaces: ["vitor"], needs: [], bind: (ctx) => createUpdatePrdTool(ctx.memberId ?? null) },
  approve_prd: { surfaces: ["vitor"], needs: [], bind: (ctx) => createApprovePrdTool(ctx.memberId ?? null) },
  link_prd_dependency: { surfaces: ["vitor"], needs: [], bind: (ctx) => createLinkPrdDependencyTool(ctx.memberId ?? null) },
  list_prds: { surfaces: ["vitor", "vitoria:release_planning"], needs: [], bind: (ctx) => createListPrdsTool(ctx.projectId) },

  // ── Vitoria PM Review (bundle buildPMReviewTools; precisa pmReviewId) ───
  // Compartilhada PM Review + Release Planning (D4 do runbook vitoria-agentic-planning).
  // O execute lê ContextSource por transcriptRefId (arg) — NÃO usa pmReviewId/projectId,
  // então a planning (sem pmReviewId) chama com "" sem problema. needs:[] (não há mais
  // hard-require) — os testes C/D do harness provam que o bind buila sem pmReviewId.
  read_transcript_content: { surfaces: ["vitoria:pm_review", "vitoria:release_planning"], needs: [], bind: (ctx) => buildPMReviewTools(ctx.pmReviewId ?? "", ctx.projectId).read_transcript_content },
  add_pm_review_note: { surfaces: ["vitoria:pm_review"], needs: ["pmReviewId"], bind: (ctx) => buildPMReviewTools(requirePMReviewId(ctx), ctx.projectId).add_pm_review_note },
  update_pm_review_report: { surfaces: ["vitoria:pm_review"], needs: ["pmReviewId"], bind: (ctx) => buildPMReviewTools(requirePMReviewId(ctx), ctx.projectId).update_pm_review_report },
  get_project_indicators: { surfaces: ["vitoria:pm_review"], needs: ["pmReviewId"], bind: (ctx) => buildPMReviewTools(requirePMReviewId(ctx), ctx.projectId).get_project_indicators },

  // ── Wiki copiloto — Vitoria surface 'wiki' OU Alpha global. OR-requirement
  //    (routeProjectId OU projectId). Definidas 1×, compartilhadas (não duplicadas).
  read_wiki: { surfaces: ["vitoria:wiki", "alpha"], needs: [["routeProjectId", "projectId"]], bind: (ctx) => createReadWikiTool(requireWikiProjectId(ctx)) },
  set_wiki_emphasis: { surfaces: ["vitoria:wiki", "alpha"], needs: [["routeProjectId", "projectId"]], bind: (ctx) => createSetWikiEmphasisTool(requireWikiProjectId(ctx), ctx.memberId ?? null) },
  suppress_wiki_bullet: { surfaces: ["vitoria:wiki", "alpha"], needs: [["routeProjectId", "projectId"]], bind: (ctx) => createSuppressWikiBulletTool(requireWikiProjectId(ctx), ctx.memberId ?? null) },
  restore_wiki_bullet: { surfaces: ["vitoria:wiki", "alpha"], needs: [["routeProjectId", "projectId"]], bind: (ctx) => createRestoreWikiBulletTool(requireWikiProjectId(ctx)) },
  recompose_wiki: { surfaces: ["vitoria:wiki", "alpha"], needs: [["routeProjectId", "projectId"]], bind: (ctx) => createRecomposeWikiTool(requireWikiProjectId(ctx)) },
};

// ── Grupos patternizados (bind compartilhado; surfaces co-localizadas) ──────
// Vitoria núcleo de leitura: serve as 4 superfícies (situational awareness).
for (const name of VITORIA_SHARED_READ_NAMES) {
  RAW[name] = { surfaces: VITORIA_READ_SURFACES, needs: [], bind: vitoriaBind(name) };
}
// Vitoria escrita project-scoped (planningId opcional): Planning + Release.
for (const name of VITORIA_PLANNING_PROJECT_NAMES) {
  RAW[name] = { surfaces: VITORIA_PLANNING_SURFACES, needs: [], bind: vitoriaBind(name) };
}
// Vitoria ceremony (planningId obrigatório): Planning + Release.
for (const name of VITORIA_PLANNING_CEREMONY_NAMES) {
  RAW[name] = { surfaces: VITORIA_PLANNING_SURFACES, needs: ["planningId"], bind: vitoriaCeremonyBind(name) };
}
// Alpha reads globais.
for (const name of ALPHA_READ_TOOL_NAMES) {
  RAW[name] = { surfaces: ["alpha"], needs: [], bind: alphaBind(name, false) };
}
// Alpha write.
for (const name of ALPHA_WRITE_TOOL_NAMES) {
  RAW[name] = { surfaces: ["alpha"], needs: [], bind: alphaBind(name, true) };
}
// Alpha route-scoped reads (exigem routeProjectId).
for (const name of Object.keys(ALPHA_ROUTE_FACTORIES)) {
  RAW[name] = { surfaces: ["alpha"], needs: ["routeProjectId"], bind: alphaRouteBind(ALPHA_ROUTE_FACTORIES[name]) };
}

/**
 * TOOL_REGISTRY — SSOT das capacidades. `name`+`class` injetados; tudo o mais
 * vem do RAW. O pertencimento (surfaces) vive AQUI, não num Set à parte:
 * getToolNamesForAgent + a matriz + o guard de drift derivam disto.
 */
export const TOOL_REGISTRY: Record<string, ToolDescriptor> = Object.fromEntries(
  Object.entries(RAW).map(([name, d]) => [
    name,
    { ...d, name, class: d.class ?? classOf(name) } satisfies ToolDescriptor,
  ]),
);

/** slug(+surface) → chave de Surface. Vitoria default = pm_review. */
function surfaceKey(agentSlug: string, surface?: string | null): Surface | null {
  if (agentSlug === "vitor") return "vitor";
  if (agentSlug === "alpha") return "alpha";
  if (agentSlug === "vitoria") {
    if (surface === "planning") return "vitoria:planning";
    if (surface === "release_planning") return "vitoria:release_planning";
    if (surface === "wiki") return "vitoria:wiki";
    return "vitoria:pm_review";
  }
  return null;
}

/**
 * Quais tools cada agente expõe via MCP. DERIVADO do descriptor.surfaces —
 * sem Set hand-maintained. Vitoria dispatcha por `surface` (vem do thread.channel):
 * 'planning' → staging; 'release_planning' → fontes (insumos+PRD) + staging;
 * 'wiki' → copiloto da Wiki; senão → PM Review.
 */
export function getToolNamesForAgent(
  agentSlug: string,
  surface?: string | null,
): string[] {
  const key = surfaceKey(agentSlug, surface);
  if (!key) return [];
  return Object.values(TOOL_REGISTRY)
    .filter((d) => d.surfaces.includes(key))
    .map((d) => d.name);
}
