import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getStepData, updateStepData } from "./context";
import { createWebSearchTool } from "./tools/web-search";
import { createTaskTool } from "./tools/create-task";
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
  createDraftStepItemsTool,
  createReviewStepDraftTool,
  createApplyStepDraftsTool,
  createDiscardStepDraftsTool,
} from "./tools/step-drafts";
import type { Capabilities } from "./types";

const genId = () => Math.random().toString(36).slice(2, 9);

const stepKeySchema = z
  .enum([
    "pre_work",
    "product_vision",
    "scope_definition",
    "personas_journeys",
    "brainstorm",
    "risks_gaps",
    "prioritization",
    "technical_specs",
    "hypotheses",
  ])
  .describe("Chave do step");

/**
 * Assembles the tool set for the design session agent.
 * Tools execute server-side via AI SDK function calling.
 */
export function assembleTools(sessionId: string, capabilities?: Capabilities): ToolSet {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  // Read tools
  tools.get_step_data = tool({
    description:
      "Lê os dados de um step específico da design session. Use para consultar o que já foi preenchido.",
    inputSchema: z.object({
      stepKey: stepKeySchema,
    }),
    execute: async ({ stepKey }: { stepKey: string }) => {
      const data = await getStepData(sessionId, stepKey);
      return { stepKey, data };
    },
  });

  tools.search_doc = createSearchDocTool(sessionId);
  tools.review_step_draft = createReviewStepDraftTool(sessionId);

  // Drafts genéricos pra qualquer step (write tools — sujeitas a Regra 0)
  if (capabilities?.writeTools !== false) {
    tools.draft_step_items = createDraftStepItemsTool(sessionId);
    tools.apply_step_drafts = createApplyStepDraftsTool(sessionId);
    tools.discard_step_drafts = createDiscardStepDraftsTool(sessionId);
  }

  // Write tools
  if (capabilities?.writeTools !== false) {
    tools.set_field = tool({
      description:
        "Define o valor de um campo texto em um step. Use para preencher ou atualizar campos como problem, whoSuffers, successVision, stack, performance, etc.",
      inputSchema: z.object({
        stepKey: stepKeySchema,
        field: z.string().describe("Nome do campo (ex: problem)"),
        value: z.string().describe("Novo valor do campo"),
      }),
      execute: async ({ stepKey, field, value }: { stepKey: string; field: string; value: string }) => {
        await updateStepData(sessionId, stepKey, (data) => ({
          ...data,
          [field]: value,
        }));
        return { success: true, stepKey, field, updatedValue: value };
      },
    });

    tools.add_item = tool({
      description:
        "Adiciona um novo item a uma lista em um step. Use para criar novas personas, soluções, hipóteses, integrações, regras técnicas, etc.",
      inputSchema: z.object({
        stepKey: stepKeySchema,
        arrayKey: z
          .string()
          .describe("Nome do array (ex: personas, solutions, hypotheses, integrations, rules)"),
        item: z
          .record(z.string(), z.unknown())
          .describe("Objeto do item com os campos do tipo."),
      }),
      execute: async ({ stepKey, arrayKey, item }: { stepKey: string; arrayKey: string; item: Record<string, unknown> }) => {
        const itemWithId = { id: genId(), ...item };
        await updateStepData(sessionId, stepKey, (data) => {
          const arr = (data[arrayKey] as unknown[]) || [];
          return { ...data, [arrayKey]: [...arr, itemWithId] };
        });
        return { success: true, stepKey, arrayKey, addedItem: itemWithId };
      },
    });

    tools.update_item = tool({
      description:
        "Atualiza campos de um item existente em uma lista. Use para melhorar descrições, corrigir textos, mudar prioridades, etc.",
      inputSchema: z.object({
        stepKey: stepKeySchema,
        arrayKey: z.string().describe("Nome do array"),
        itemId: z.string().describe("ID do item a atualizar"),
        updates: z
          .record(z.string(), z.unknown())
          .describe("Campos a atualizar (merge parcial)"),
      }),
      execute: async ({ stepKey, arrayKey, itemId, updates }: { stepKey: string; arrayKey: string; itemId: string; updates: Record<string, unknown> }) => {
        await updateStepData(sessionId, stepKey, (data) => {
          const arr = (data[arrayKey] as Array<{ id: string }>) || [];
          return {
            ...data,
            [arrayKey]: arr.map((it) =>
              it.id === itemId ? { ...it, ...updates } : it
            ),
          };
        });
        return { success: true, stepKey, arrayKey, itemId, updates };
      },
    });

    tools.delete_item = tool({
      description:
        "Remove um item de uma lista. Use quando o usuário pedir para excluir uma persona, solução, hipótese, etc.",
      inputSchema: z.object({
        stepKey: stepKeySchema,
        arrayKey: z.string().describe("Nome do array"),
        itemId: z.string().describe("ID do item a remover"),
      }),
      execute: async ({ stepKey, arrayKey, itemId }: { stepKey: string; arrayKey: string; itemId: string }) => {
        await updateStepData(sessionId, stepKey, (data) => {
          const arr = (data[arrayKey] as Array<{ id: string }>) || [];
          return {
            ...data,
            [arrayKey]: arr.filter((it) => it.id !== itemId),
          };
        });
        return { success: true, stepKey, arrayKey, removedItemId: itemId };
      },
    });
  }

  // Web search — requires projectId for research auto-capture
  if (capabilities?.webSearch && capabilities?.projectId) {
    tools.web_search = createWebSearchTool(sessionId, capabilities.projectId);
  }

  // Task creation & management (briefing step)
  if (capabilities?.createTasks && capabilities?.projectId) {
    tools.create_task = createTaskTool(sessionId, capabilities.projectId, capabilities.memberId);
    tools.list_tasks = listSessionTasksTool(sessionId);
    tools.list_project_tasks = listProjectTasksTool(sessionId, capabilities.projectId);
    tools.update_task = updateTaskTool(sessionId);
    tools.delete_task = deleteTaskTool(sessionId);
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
