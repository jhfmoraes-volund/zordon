import { type ToolSet } from "ai";
import { createWebSearchTool } from "./tools/web-search";
import { createTaskTool } from "./tools/create-task";
import { createUserStoryTool } from "./tools/create-user-story";
import { listProjectTagsTool } from "./tools/list-project-tags";
import { proposeModulesTool } from "./tools/propose-modules";
import { syncProjectPersonasTool } from "./tools/sync-personas";
import {
  listStoriesTool,
  setStoryRefinementTool,
  deleteUserStoryTool,
} from "./tools/manage-stories";
import {
  updateStoryForOpsTool,
  manageStoryAcForOpsTool,
} from "./tools/alpha-hierarchy";
import {
  listSessionTasksTool,
  listProjectTasksTool,
  updateTaskTool,
  deleteTaskTool,
} from "./tools/manage-tasks";
import {
  createRecordDecisionTool,
  createReviseDecisionTool,
  createListDecisionsTool,
  createAddOpenQuestionTool,
  createResolveOpenQuestionTool,
  createListOpenQuestionsTool,
  createListResearchTool,
  createReadBusinessContextTool,
  createReadSessionMemoryTool,
  createUpdateSessionMemoryTool,
  createReadProjectMemoryTool,
  createUpdateProjectMemoryTool,
  createListProjectSessionsTool,
  createCompactSessionToProjectTool,
} from "./tools/memory";
import { createMvpCheckTool } from "./tools/mvp-check";
import { createSearchDocTool } from "./tools/search-doc";
import {
  createReadProductVisionTool,
  createReadScopeTool,
  createReadPersonaTool,
  createReadBrainstormTool,
  createReadPriorityTool,
  createReadRiskTool,
  createReadGapTool,
  createReadTechSpecsTool,
  createReadHypothesisTool,
  createReadFilesTool,
  createReadFileTextTool,
} from "./tools/ds-entities";
import {
  createWriteProductVisionTool,
  createWriteScopeItemTool,
  createWritePersonaTool,
  createWriteBrainstormTool,
  createWritePriorityTool,
  createWriteRiskTool,
  createWriteGapTool,
  createWriteTechSpecsTool,
  createWriteHypothesisTool,
} from "./tools/ds-entities-write";
import type { Capabilities } from "./types";

/**
 * Assembles the tool set for the design session agent.
 * Tools execute server-side via AI SDK function calling.
 */
export function assembleTools(sessionId: string, capabilities?: Capabilities): ToolSet {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  tools.search_doc = createSearchDocTool(sessionId);

  // Entity reads (Vitor normalization v2) — 9 entidades + files
  tools.read_product_vision = createReadProductVisionTool(sessionId);
  tools.read_scope = createReadScopeTool(sessionId);
  tools.read_persona = createReadPersonaTool(sessionId);
  tools.read_brainstorm = createReadBrainstormTool(sessionId);
  tools.read_priority = createReadPriorityTool(sessionId);
  tools.read_risk = createReadRiskTool(sessionId);
  tools.read_gap = createReadGapTool(sessionId);
  tools.read_tech_specs = createReadTechSpecsTool(sessionId);
  tools.read_hypothesis = createReadHypothesisTool(sessionId);
  tools.read_files = createReadFilesTool(sessionId);
  tools.read_file_text = createReadFileTextTool(sessionId);

  // Entity writes (Vitor normalization v2)
  if (capabilities?.writeTools !== false) {
    tools.write_product_vision = createWriteProductVisionTool(sessionId);
    tools.write_scope_item = createWriteScopeItemTool(sessionId);
    tools.write_persona = createWritePersonaTool(sessionId);
    tools.write_brainstorm = createWriteBrainstormTool(sessionId);
    tools.write_priority = createWritePriorityTool(sessionId);
    tools.write_risk = createWriteRiskTool(sessionId);
    tools.write_gap = createWriteGapTool(sessionId);
    tools.write_tech_specs = createWriteTechSpecsTool(sessionId);
    tools.write_hypothesis = createWriteHypothesisTool(sessionId);
  }

  // Web search — requires projectId for research auto-capture
  if (capabilities?.webSearch && capabilities?.projectId) {
    tools.web_search = createWebSearchTool(sessionId, capabilities.projectId);
  }

  // Story + Task creation & management (briefing step)
  if (capabilities?.createTasks && capabilities?.projectId) {
    tools.propose_modules = proposeModulesTool(capabilities.projectId);
    tools.sync_project_personas = syncProjectPersonasTool(capabilities.projectId);
    tools.list_stories = listStoriesTool(sessionId, capabilities.projectId);
    tools.list_project_tags = listProjectTagsTool(capabilities.projectId);
    tools.list_tasks = listSessionTasksTool(sessionId);
    tools.list_project_tasks = listProjectTasksTool(sessionId, capabilities.projectId);

    // Vitor-as-PM mode: PRD becomes the único output do briefing. US/Task/AC
    // mutations saem do toolset — Vitoria materializa via novo modo "execution-from-prd".
    if (!capabilities.vitorAsPm) {
      tools.create_user_story = createUserStoryTool(
        sessionId,
        capabilities.projectId,
        capabilities.memberId,
      );
      // approve_module foi descontinuada na DS — aprovação acontece atomicamente
      // pelo PM via /complete da sessão. A tool Alpha equivalente continua viva
      // pra fluxos manuais fora de DS.
      tools.set_story_refinement = setStoryRefinementTool(capabilities.projectId);
      tools.update_user_story = updateStoryForOpsTool(capabilities.projectId);
      tools.manage_story_ac = manageStoryAcForOpsTool(capabilities.projectId);
      tools.delete_user_story = deleteUserStoryTool(capabilities.projectId);
      tools.create_task = createTaskTool(sessionId, capabilities.projectId, capabilities.memberId);
      tools.update_task = updateTaskTool(sessionId);
      tools.delete_task = deleteTaskTool(sessionId);
    }
  }

  // Memory tools (always-on when projectId is known)
  if (capabilities?.projectId) {
    const pid = capabilities.projectId;
    tools.record_decision = createRecordDecisionTool(sessionId, pid);
    tools.revise_decision = createReviseDecisionTool(sessionId, pid);
    tools.list_decisions = createListDecisionsTool(sessionId, pid);
    tools.add_open_question = createAddOpenQuestionTool(sessionId, pid);
    tools.resolve_open_question = createResolveOpenQuestionTool(sessionId, pid);
    tools.list_open_questions = createListOpenQuestionsTool(sessionId, pid);
    tools.list_research = createListResearchTool(sessionId, pid);
    tools.read_business_context = createReadBusinessContextTool(sessionId, pid);
    tools.mvp_check = createMvpCheckTool(sessionId, pid);
    tools.read_session_memory = createReadSessionMemoryTool(sessionId, pid);
    tools.update_session_memory = createUpdateSessionMemoryTool(sessionId, pid);
    tools.read_project_memory = createReadProjectMemoryTool(sessionId, pid);
    tools.update_project_memory = createUpdateProjectMemoryTool(sessionId, pid);
    tools.list_project_sessions = createListProjectSessionsTool(sessionId, pid);
    tools.compact_session_to_project = createCompactSessionToProjectTool(sessionId, pid);
  }

  return tools;
}
