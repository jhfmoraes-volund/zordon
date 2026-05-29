import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { suggestFunctionPoints, OPEN_STATUSES } from "@/lib/function-points";
import { TASK_STATUSES, TASK_TYPES, SCOPES, COMPLEXITIES } from "@/lib/task-constants";
import { isOverdue } from "@/lib/date-utils";
import {
  listMeetings,
  getMeetingDetail,
  askMeeting,
  type MeetingSource,
} from "@/lib/meetings";
import { loadAgentHeuristic, loadFpMatrix } from "../../config";
import {
  listModulesForOpsTool,
  listPersonasForOpsTool,
  listStoriesForOpsTool,
  getStoryForOpsTool,
  createStoryForOpsTool,
  updateStoryForOpsTool,
  setStoryRefinementForOpsTool,
  approveModuleForOpsTool,
  manageStoryAcForOpsTool,
} from "../../tools/alpha-hierarchy";
import {
  getProjectCapacityForOpsTool,
  listUnplannedTasksForOpsTool,
  verifySprintDistributionForOpsTool,
  bulkUpdateTasksForOpsTool,
} from "../../tools/alpha-planner";
import { ALPHA_AGENT_ID } from "./context";
import type { Capabilities } from "../../types";

/**
 * Assembles Alpha's native tools.
 * Composio tools are merged separately by the agent definition.
 *
 * Route scoping: when `routeProjectId` / `routeSprintId` are present (parsed
 * from `currentPath`), read tools without explicit IDs filter by the route's
 * scope. The agent can escape the scope by passing `projectName` (or another
 * explicit identifier) to query cross-project.
 */
export function assembleAlphaTools(
  capabilities: Capabilities,
  opts: {
    activeMeetingId?: string;
    routeProjectId?: string;
    routeSprintId?: string;
    currentMemberId?: string;
    /** Thread atual — usado pra agrupar telemetria de sub-agentes na sessão. */
    threadId?: string;
    /**
     * Per-project kill switch for hierarchy + planner write tools.
     * When false, only read tools are exposed for this project — writes
     * (create_user_story, bulk_update_tasks, etc.) are silently skipped.
     * Defaults to true (Project.alphaHierarchyEnabled column default).
     */
    alphaHierarchyEnabled?: boolean;
  } = {},
): ToolSet {
  const supabase = db();
  const tools: ToolSet = {};
  const roamToken = capabilities.roamToken;
  const granolaToken = capabilities.granolaToken;
  const activeMeetingId = opts.activeMeetingId;
  const routeProjectId = opts.routeProjectId;
  const routeSprintId = opts.routeSprintId;
  const currentMemberId = opts.currentMemberId;
  const threadId = opts.threadId;
  const alphaHierarchyEnabled = opts.alphaHierarchyEnabled ?? true;
  const NO_ROAM_TOKEN =
    "Roam nao conectado. Peca ao PM para conectar em Configuracoes > Integracoes.";
  const meetingsResolver = { roamToken, granolaToken };
  const SOURCE_VALUES = ["roam", "granola"] as const satisfies readonly MeetingSource[];

  // ─── Read tools ──────────────────────────────────────────

  tools.get_sprint_overview = tool({
    description:
      "Retorna o estado completo do sprint ativo: goal (manifesto), tasks, membros com capacidade, e — quando o sprint está completed — a retrospectiva (Quebom/Quepena/Quetal). Use para ter uma visao atualizada da operacao. Quando o usuário está numa página de projeto/sprint, retorna o sprint daquele escopo automaticamente.",
    inputSchema: z.object({}),
    execute: async () => {
      const SPRINT_COLS =
        "id, name, startDate, endDate, status, goal, project:Project(name)";
      let sprintQuery = supabase
        .from("Sprint")
        .select(SPRINT_COLS)
        .neq("status", "done");
      if (routeSprintId) {
        sprintQuery = supabase
          .from("Sprint")
          .select(SPRINT_COLS)
          .eq("id", routeSprintId);
      } else if (routeProjectId) {
        sprintQuery = sprintQuery.eq("projectId", routeProjectId);
      }
      const { data: sprint } = await sprintQuery
        .order("startDate", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!sprint) {
        const scope = routeSprintId
          ? `sprint ${routeSprintId}`
          : routeProjectId
            ? `projeto ${routeProjectId}`
            : "global";
        return { error: `Nenhum sprint ativo encontrado (escopo: ${scope}).` };
      }

      const { data: tasks } = await supabase
        .from("Task")
        .select("reference, title, status, type, functionPoints, dueDate, assignments:TaskAssignment(member:Member(id, name))")
        .eq("sprintId", sprint.id)
        .neq("status", "draft")
        .order("priority", { ascending: false });

      const { data: members } = await supabase
        .from("member_capacity_overview")
        .select("*");

      let retrospective: {
        goodPoints: string | null;
        badPoints: string | null;
        ideas: string | null;
        completedAt: string;
      } | null = null;
      if (sprint.status === "completed") {
        const { data: retro } = await supabase
          .from("SprintRetrospective")
          .select("goodPoints, badPoints, ideas, completedAt")
          .eq("sprintId", sprint.id)
          .maybeSingle();
        retrospective = retro ?? null;
      }

      return {
        sprint,
        tasks: tasks || [],
        members: members || [],
        retrospective,
      };
    },
  });

  tools.get_tasks = tool({
    description:
      "Lista tasks com filtros opcionais por status, membro ou sprint. Retorna referencia, titulo, status, FP, e atribuicao.",
    inputSchema: z.object({
      status: z.enum(TASK_STATUSES).optional().describe("Filtrar por status"),
      memberName: z.string().optional().describe("Filtrar por nome do membro atribuido"),
    }),
    execute: async ({ status, memberName }) => {
      let query = supabase
        .from("Task")
        .select("reference, title, status, type, functionPoints, dueDate, assignments:TaskAssignment(member:Member(id, name))")
        .neq("status", "draft")
        .order("priority", { ascending: false })
        .limit(50);

      if (status) query = query.eq("status", status);

      const { data: tasks } = await query;
      let result = tasks || [];

      if (memberName) {
        result = result.filter((t) =>
          t.assignments?.some(
            (a: { member: { name: string } | null }) =>
              a.member?.name?.toLowerCase().includes(memberName.toLowerCase())
          )
        );
      }

      return { tasks: result, count: result.length };
    },
  });

  tools.get_alerts = tool({
    description:
      "Retorna alertas operacionais: membros sobrecarregados, tasks sem atribuicao, prazos vencidos, sprint acima da capacidade. Quando o usuário está numa página de projeto/sprint, filtra pelo escopo da rota.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data: members } = await supabase
        .from("member_capacity_overview")
        .select("*");

      let sprintQuery = supabase
        .from("Sprint")
        .select("id")
        .neq("status", "done");
      if (routeSprintId) {
        sprintQuery = supabase.from("Sprint").select("id").eq("id", routeSprintId);
      } else if (routeProjectId) {
        sprintQuery = sprintQuery.eq("projectId", routeProjectId);
      }
      const { data: sprint } = await sprintQuery
        .order("startDate", { ascending: false })
        .limit(1)
        .maybeSingle();

      const alerts: string[] = [];
      const memberList = members || [];

      for (const m of memberList) {
        const allocated = Number(m.fp_allocated) || 0;
        const capacity = Number(m.fp_capacity) || 0;
        if (capacity > 0 && allocated > capacity) {
          alerts.push(`${m.name} sobrecarregado: ${allocated}/${capacity} FP`);
        }
        if (capacity > 0 && allocated === 0) {
          alerts.push(`${m.name} sem tasks alocadas (${capacity} FP disponiveis)`);
        }
      }

      if (sprint) {
        const { data: tasks } = await supabase
          .from("Task")
          .select("reference, title, status, functionPoints, dueDate, assignments:TaskAssignment(memberId)")
          .eq("sprintId", sprint.id)
          .neq("status", "draft");

        const taskList = tasks || [];
        const activeTasks = taskList.filter((t) =>
          OPEN_STATUSES.includes(t.status as typeof OPEN_STATUSES[number])
        );

        const unassigned = activeTasks.filter(
          (t) => !t.assignments || t.assignments.length === 0
        );
        if (unassigned.length > 0) {
          alerts.push(`${unassigned.length} task(s) sem atribuicao: ${unassigned.map(t => t.reference).join(", ")}`);
        }

        const now = new Date();
        const overdue = activeTasks.filter(
          (t) => t.dueDate && new Date(t.dueDate) < now
        );
        if (overdue.length > 0) {
          alerts.push(`${overdue.length} task(s) com prazo vencido: ${overdue.map(t => t.reference).join(", ")}`);
        }
      }

      return { alerts, count: alerts.length };
    },
  });

  tools.list_sprints = tool({
    description:
      "Lista todos os sprints não-concluídos (planning, active) do projeto. Use ao replanejar, redistribuir tasks ou quando precisar ver o pipeline. Sem `projectName` e em página de projeto, filtra pelo projeto da rota.",
    inputSchema: z.object({
      projectName: z.string().optional().describe("Filtrar por nome parcial do projeto (case-insensitive). Passe explicitamente quando quiser cross-project."),
    }),
    execute: async ({ projectName }) => {
      let query = supabase
        .from("Sprint")
        .select("id, name, status, startDate, endDate, project:Project(id, name)")
        .neq("status", "done")
        .order("startDate", { ascending: true });

      // Implicit scope: filter by route project when no explicit projectName.
      if (!projectName && routeProjectId) {
        query = query.eq("projectId", routeProjectId);
      }

      const { data } = await query;
      let sprints = data || [];

      if (projectName) {
        const needle = projectName.toLowerCase();
        sprints = sprints.filter((s) =>
          (s.project as { name: string } | null)?.name?.toLowerCase().includes(needle)
        );
      }

      const enriched = await Promise.all(
        sprints.map(async (s) => {
          const { count } = await supabase
            .from("Task")
            .select("*", { count: "exact", head: true })
            .eq("sprintId", s.id)
            .neq("status", "draft");
          const { data: fpRows } = await supabase
            .from("Task")
            .select("functionPoints")
            .eq("sprintId", s.id)
            .neq("status", "draft");
          const totalFp = (fpRows || []).reduce((sum, r) => sum + (r.functionPoints || 0), 0);
          return {
            id: s.id,
            name: s.name,
            status: s.status,
            startDate: s.startDate,
            endDate: s.endDate,
            project: (s.project as { name: string } | null)?.name || null,
            taskCount: count || 0,
            totalFp,
          };
        })
      );

      return { sprints: enriched, count: enriched.length };
    },
  });

  tools.get_backlog = tool({
    description:
      "Lista tasks no backlog (sem sprint atribuído). Use ao replanejar — quais tasks podem entrar em sprints. Sem `projectName` e em página de projeto, filtra pelo projeto da rota.",
    inputSchema: z.object({
      projectName: z.string().optional().describe("Filtrar por nome parcial do projeto. Passe explicitamente quando quiser cross-project."),
      limit: z.number().int().min(1).max(200).default(100).describe("Máximo de tasks (default 100)"),
    }),
    execute: async ({ projectName, limit }) => {
      let query = supabase
        .from("Task")
        .select("reference, title, type, scope, complexity, functionPoints, priority, dueDate, project:Project(id, name)")
        .is("sprintId", null)
        .neq("status", "draft")
        .order("priority", { ascending: false })
        .order("createdAt", { ascending: false })
        .limit(limit);

      // Implicit scope: filter by route project when no explicit projectName.
      if (!projectName && routeProjectId) {
        query = query.eq("projectId", routeProjectId);
      }

      const { data } = await query;
      let tasks = data || [];

      if (projectName) {
        const needle = projectName.toLowerCase();
        tasks = tasks.filter((t) =>
          (t.project as { name: string } | null)?.name?.toLowerCase().includes(needle)
        );
      }

      return {
        tasks: tasks.map((t) => ({
          reference: t.reference,
          title: t.title,
          type: t.type,
          scope: t.scope,
          complexity: t.complexity,
          functionPoints: t.functionPoints,
          priority: t.priority,
          dueDate: t.dueDate,
          project: (t.project as { name: string } | null)?.name || null,
        })),
        count: tasks.length,
      };
    },
  });

  tools.get_allocated_project_members = tool({
    description:
      "Lista o squad de um projeto: PM (Project.pmId) + ProjectMembers (com fpAllocation). Faz UNION dos dois — funciona mesmo quando o PM não tem entrada explícita em ProjectMember (caso comum hoje no banco). Use pra saber 'quem está no projeto X', preparar attendees de uma reunião, ou analisar carga.",
    inputSchema: z.object({
      projectName: z.string().describe("Nome parcial do projeto (case-insensitive)"),
    }),
    execute: async ({ projectName }) => {
      const { data: project } = await supabase
        .from("Project")
        .select("id, name, status, pmId, pm:Member!Project_pmId_fkey(id, name, role, position, fpCapacity)")
        .ilike("name", `%${projectName}%`)
        .limit(1)
        .maybeSingle();

      if (!project) return { error: `Projeto "${projectName}" não encontrado.` };

      const { data: pmRows } = await supabase
        .from("ProjectMember")
        .select("memberId, fpAllocation, member:Member(id, name, role, position, fpCapacity, isExternal, dedicationPercent)")
        .eq("projectId", project.id);

      type Mb = { id: string; name: string; role: string; position: string | null; fpCapacity: number };
      const pm = (project.pm as Mb | null) ?? null;
      const explicitRows = (pmRows || []) as Array<{
        memberId: string;
        fpAllocation: number;
        member: (Mb & { isExternal: boolean; dedicationPercent: number }) | null;
      }>;

      type Out = {
        memberId: string;
        name: string;
        role: string;
        fpCapacity: number;
        fpAllocation: number | null;
        isPM: boolean;
        isExternal: boolean | null;
        dedicationPercent: number | null;
        source: "project_pm" | "project_member" | "both";
      };

      const byId = new Map<string, Out>();

      // 1) PM (Project.pmId)
      if (pm) {
        byId.set(pm.id, {
          memberId: pm.id,
          name: pm.name,
          role: pm.position ?? pm.role,
          fpCapacity: pm.fpCapacity,
          fpAllocation: null,
          isPM: true,
          isExternal: null,
          dedicationPercent: null,
          source: "project_pm",
        });
      }

      // 2) ProjectMembers — merge ou cria
      for (const row of explicitRows) {
        const m = row.member;
        if (!m) continue;
        const existing = byId.get(m.id);
        if (existing) {
          existing.fpAllocation = row.fpAllocation;
          existing.isExternal = m.isExternal;
          existing.dedicationPercent = m.dedicationPercent;
          existing.source = "both";
        } else {
          byId.set(m.id, {
            memberId: m.id,
            name: m.name,
            role: m.position ?? m.role,
            fpCapacity: m.fpCapacity,
            fpAllocation: row.fpAllocation,
            isPM: false,
            isExternal: m.isExternal,
            dedicationPercent: m.dedicationPercent,
            source: "project_member",
          });
        }
      }

      const members = Array.from(byId.values()).sort((a, b) => {
        if (a.isPM !== b.isPM) return a.isPM ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const orphanPM = pm && !explicitRows.some((r) => r.memberId === pm.id);

      return {
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
          pmName: pm?.name ?? null,
        },
        members,
        count: members.length,
        ...(orphanPM
          ? { warning: `PM ${pm.name} não está em ProjectMember (órfão). Tool usou UNION pra incluí-lo mesmo assim.` }
          : {}),
      };
    },
  });

  tools.load_heuristic = tool({
    description:
      "Carrega o corpo completo de uma heurística/playbook cadastrado (regra de negócio, checklist, framework). Use quando o índice de heurísticas no contexto mostrar uma que bate com o problema atual.",
    inputSchema: z.object({
      name: z.string().describe("Nome/slug da heurística (ex: 'sprint-composicao')"),
    }),
    execute: async ({ name }) => {
      const heuristic = await loadAgentHeuristic(ALPHA_AGENT_ID, name);
      if (!heuristic) {
        return { error: `Heurística "${name}" não encontrada ou inativa.` };
      }
      return { name, title: heuristic.title, body: heuristic.body };
    },
  });

  // ─── Hierarchy read tools (Module / UserStory / Persona) ──
  // Available only when the route resolves to a project — these wrappers are
  // alpha-only and do not interfere with Vitor's session-bound factories.
  if (routeProjectId) {
    tools.list_modules = listModulesForOpsTool(routeProjectId);
    tools.list_personas = listPersonasForOpsTool(routeProjectId);
    tools.list_stories = listStoriesForOpsTool(routeProjectId);
    tools.get_story = getStoryForOpsTool(routeProjectId);

    // Sprint Planner read tools — aggregate views for planning
    tools.get_project_capacity = getProjectCapacityForOpsTool(routeProjectId);
    tools.list_unplanned_tasks = listUnplannedTasksForOpsTool(routeProjectId);
    tools.verify_sprint_distribution =
      verifySprintDistributionForOpsTool(routeProjectId);
  }

  // ─── Write tools ─────────────────────────────────────────

  if (capabilities.writeTools) {
    // Hierarchy + planner writes — gated by per-project kill switch.
    // Reads stay available regardless (they're safe & non-mutating).
    if (routeProjectId && currentMemberId && alphaHierarchyEnabled) {
      tools.create_user_story = createStoryForOpsTool(
        routeProjectId,
        currentMemberId,
      );
      tools.update_user_story = updateStoryForOpsTool(routeProjectId);
      tools.set_story_refinement = setStoryRefinementForOpsTool(routeProjectId);
      tools.approve_module = approveModuleForOpsTool(
        routeProjectId,
        currentMemberId,
      );
      tools.manage_story_ac = manageStoryAcForOpsTool(routeProjectId);

      // Sprint Planner write — atomic bulk via RPC
      tools.bulk_update_tasks = bulkUpdateTasksForOpsTool(
        routeProjectId,
        currentMemberId,
      );
    }

    tools.create_sprint = tool({
      description:
        "Cria um novo sprint vinculado a um projeto. Retorna o sprint criado com estatisticas zeradas.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Nome do sprint no formato 'Sprint N' onde N é o número sequencial (ex: 'Sprint 4'). Não adicionar tema/sufixo a menos que o usuário peça explicitamente."),
        projectName: z.string().describe("Nome do projeto (busca por nome parcial)"),
        startDate: z.string().describe("Data de inicio no formato YYYY-MM-DD"),
        endDate: z.string().describe("Data de fim no formato YYYY-MM-DD"),
        status: z.enum(["upcoming", "completed"]).default("upcoming").describe("Status inicial do sprint. 'active' não pode ser definido aqui — promova depois usando o botão Ativar na UI ou o endpoint /activate."),
      }),
      execute: async ({ name, projectName, startDate, endDate, status }) => {
        const { data: project } = await supabase
          .from("Project")
          .select("id, name")
          .ilike("name", `%${projectName}%`)
          .limit(1)
          .maybeSingle();

        if (!project) return { error: `Projeto "${projectName}" nao encontrado.` };

        const { data: sprint, error } = await supabase
          .from("Sprint")
          .insert({
            id: crypto.randomUUID(),
            name,
            projectId: project.id,
            startDate,
            endDate,
            status,
            updatedAt: new Date().toISOString(),
          })
          .select("id, name, startDate, endDate, status, projectId")
          .single();

        if (error) {
          if (error.code === "23505") {
            return { error: `Ja existe um sprint chamado "${name}" no projeto "${project.name}".` };
          }
          return { error: `Erro ao criar sprint: ${error.message}` };
        }

        return { created: true, sprint, project: project.name };
      },
    });

    tools.create_task = tool({
      description:
        "Cria uma nova task no backlog. Auto-calcula Function Points a partir de scope x complexity. Opcionalmente atribui a um membro.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Titulo curto e acionavel em portugues"),
        description: z.string().optional().describe("Descricao do que entregar e por que"),
        type: z.enum(TASK_TYPES).default("feature").describe("Tipo da task"),
        scope: z.enum(SCOPES).default("small").describe("Tamanho estimado"),
        complexity: z.enum(COMPLEXITIES).default("medium").describe("Complexidade estimada"),
        projectId: z.string().uuid().optional().describe("ID do projeto (usa o do sprint ativo se omitido)"),
        sprintId: z.string().uuid().optional().describe("ID do sprint (usa o ativo se omitido)"),
        assigneeName: z.string().optional().describe("Nome do membro para atribuir"),
      }),
      execute: async ({ title, description, type, scope, complexity, projectId, sprintId, assigneeName }) => {
        const matrix = await loadFpMatrix(ALPHA_AGENT_ID);
        const fp = suggestFunctionPoints(scope, complexity, matrix);

        // Resolve sprint/project
        let resolvedSprintId = sprintId;
        let resolvedProjectId = projectId;
        if (!resolvedSprintId || !resolvedProjectId) {
          const { data: sprint } = await supabase
            .from("Sprint")
            .select("id, projectId")
            .neq("status", "done")
            .order("startDate", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (sprint) {
            resolvedSprintId = resolvedSprintId || sprint.id;
            resolvedProjectId = resolvedProjectId || sprint.projectId;
          }
        }

        if (!resolvedProjectId) {
          return { error: "Nenhum projeto encontrado. Especifique projectId." };
        }

        // Generate reference
        const { data: ref } = await supabase.rpc("next_task_reference", {
          p_project_id: resolvedProjectId,
        });
        if (!ref) return { error: "Falha ao gerar referencia da task." };

        const { data: task, error } = await supabase
          .from("Task")
          .insert({
            id: crypto.randomUUID(),
            reference: ref as string,
            title,
            description: description || null,
            type,
            scope,
            complexity,
            functionPoints: fp,
            status: "backlog",
            projectId: resolvedProjectId,
            sprintId: resolvedSprintId || null,
            createdById: currentMemberId ?? null,
            createdByAgent: true,
            updatedAt: new Date().toISOString(),
          })
          .select("id, reference, title, functionPoints")
          .single();

        if (error) return { error: `Erro ao criar task: ${error.message}` };

        // Assign if requested
        if (assigneeName && task) {
          const { data: member } = await supabase
            .from("Member")
            .select("id, name, fpCapacity")
            .ilike("name", `%${assigneeName}%`)
            .limit(1)
            .maybeSingle();

          if (member) {
            await supabase.from("TaskAssignment").insert({
              id: crypto.randomUUID(),
              taskId: task.id,
              memberId: member.id,
            });
            return { created: true, task, assignedTo: member.name };
          }
          return { created: true, task, warning: `Membro "${assigneeName}" nao encontrado. Task criada sem atribuicao.` };
        }

        return { created: true, task };
      },
    });

    // ── update_task — unificada (substitui 8 granulares: assign, move, remove,
    //    update_status, update_priority, update_estimate, update_title, update_description)
    tools.update_task = tool({
      description:
        "Atualiza UMA task em UMA chamada — qualquer subset de campos. Substitui as antigas tools granulares (assign_task, update_task_status, update_task_priority, update_task_estimate, update_task_title, update_task_description, move_task_to_sprint, remove_task_from_sprint). Para múltiplas tasks de uma vez (planning), use bulk_update_tasks.",
      inputSchema: z.object({
        taskReference: z.string().describe("Referência da task (ex: TASK-042)"),
        title: z.string().min(1).optional().describe("Novo título"),
        description: z
          .string()
          .optional()
          .describe("Nova descrição. String vazia limpa o campo."),
        status: z.enum(TASK_STATUSES).optional().describe("Novo status"),
        priority: z.number().int().min(0).max(10).optional(),
        scope: z
          .enum(SCOPES)
          .optional()
          .describe("Novo scope — junto com complexity recalcula FP"),
        complexity: z
          .enum(COMPLEXITIES)
          .optional()
          .describe("Nova complexity — junto com scope recalcula FP"),
        sprintName: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Nome parcial do sprint alvo. null move pra backlog. Omitido = não mexe.",
          ),
        assigneeNames: z
          .array(z.string())
          .optional()
          .describe(
            "Lista de nomes de membros (substitui assignments existentes). Array vazio remove todos.",
          ),
      }),
      execute: async (input) => {
        const { taskReference } = input;
        const { data: task } = await supabase
          .from("Task")
          .select(
            "id, title, description, status, priority, scope, complexity, functionPoints, projectId, sprintId",
          )
          .eq("reference", taskReference)
          .maybeSingle();
        if (!task) return { error: `Task "${taskReference}" não encontrada.` };

        const updates: Record<string, unknown> = {};
        const changes: Record<string, { from: unknown; to: unknown }> = {};

        if (input.title !== undefined && input.title !== task.title) {
          updates.title = input.title;
          changes.title = { from: task.title, to: input.title };
        }

        if (input.description !== undefined) {
          const value =
            input.description.trim() === "" ? null : input.description;
          if (value !== task.description) {
            updates.description = value;
            changes.description = {
              from: task.description ? `${task.description.length} chars` : "vazio",
              to: value ? `${value.length} chars` : "vazio",
            };
          }
        }

        if (input.status !== undefined && input.status !== task.status) {
          updates.status = input.status;
          changes.status = { from: task.status, to: input.status };
        }

        if (input.priority !== undefined && input.priority !== task.priority) {
          updates.priority = input.priority;
          changes.priority = { from: task.priority, to: input.priority };
        }

        // FP recalc only if scope or complexity changed
        if (input.scope !== undefined || input.complexity !== undefined) {
          const newScope = input.scope ?? task.scope;
          const newComplexity = input.complexity ?? task.complexity;
          if (
            newScope !== task.scope ||
            newComplexity !== task.complexity
          ) {
            const matrix = await loadFpMatrix(ALPHA_AGENT_ID);
            const newFP = suggestFunctionPoints(newScope, newComplexity, matrix);
            updates.scope = newScope;
            updates.complexity = newComplexity;
            updates.functionPoints = newFP;
            changes.estimate = {
              from: {
                scope: task.scope,
                complexity: task.complexity,
                fp: task.functionPoints,
              },
              to: { scope: newScope, complexity: newComplexity, fp: newFP },
            };
          }
        }

        // Sprint move (or remove from sprint)
        let resolvedSprintName: string | null = null;
        if (input.sprintName !== undefined) {
          if (input.sprintName === null) {
            if (task.sprintId !== null) {
              updates.sprintId = null;
              // Going back to backlog — reset status to backlog unless caller set status
              if (input.status === undefined) {
                updates.status = "backlog";
              }
              changes.sprintId = { from: task.sprintId, to: null };
            }
          } else {
            // Match exato — sprints renumeram cronologicamente, ilike "%Sprint 1%"
            // pegaria "Sprint 10", "Sprint 11" etc. Nome canônico é "Sprint N".
            const { data: sprint } = await supabase
              .from("Sprint")
              .select("id, name, projectId")
              .eq("name", input.sprintName)
              .eq("projectId", task.projectId)
              .maybeSingle();
            if (!sprint) {
              return {
                error: `Sprint "${input.sprintName}" não encontrado no projeto da task.`,
              };
            }
            if (sprint.id !== task.sprintId) {
              updates.sprintId = sprint.id;
              resolvedSprintName = sprint.name;
              changes.sprintId = {
                from: task.sprintId,
                to: { id: sprint.id, name: sprint.name },
              };
            }
          }
        }

        // Apply task update if there's anything to change
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date().toISOString();
          const { error } = await supabase
            .from("Task")
            .update(updates as never)
            .eq("id", task.id);
          if (error) return { error: `Erro ao atualizar task: ${error.message}` };
        }

        // Replace assignment set (if provided)
        let assigneeResult:
          | { applied: string[]; missing: string[] }
          | undefined;
        if (input.assigneeNames !== undefined) {
          const requested = input.assigneeNames;
          const applied: string[] = [];
          const missing: string[] = [];
          let resolvedIds: string[] = [];

          if (requested.length > 0) {
            const candidates = await Promise.all(
              requested.map(async (name) => {
                const { data: m } = await supabase
                  .from("Member")
                  .select("id, name")
                  .ilike("name", `%${name}%`)
                  .limit(1)
                  .maybeSingle();
                if (m) {
                  applied.push(m.name);
                  return m.id;
                }
                missing.push(name);
                return null;
              }),
            );
            resolvedIds = candidates.filter((id): id is string => id !== null);
          }

          await supabase
            .from("TaskAssignment")
            .delete()
            .eq("taskId", task.id);
          if (resolvedIds.length > 0) {
            await supabase.from("TaskAssignment").insert(
              resolvedIds.map((memberId) => ({
                id: crypto.randomUUID(),
                taskId: task.id,
                memberId,
              })),
            );
          }
          assigneeResult = { applied, missing };
          changes.assignees = {
            from: "(replaced)",
            to: applied.length === 0 ? "(none)" : applied.join(", "),
          };
        }

        if (Object.keys(changes).length === 0) {
          return {
            updated: false,
            task: { reference: taskReference, title: task.title },
            note: "Nenhum campo foi alterado.",
          };
        }

        return {
          updated: true,
          task: { reference: taskReference, title: task.title },
          changes,
          ...(resolvedSprintName ? { resolvedSprintName } : {}),
          ...(assigneeResult ? { assignees: assigneeResult } : {}),
        };
      },
    });

    // ── manage_allocation — unificada (substitui set_project_allocation,
    //    set_sprint_allocation, clear_sprint_allocation)
    tools.manage_allocation = tool({
      description:
        "Gerencia o 'contrato' (fpAllocation) de um membro num projeto. Use scope='project' pro teto padrão (ProjectMember.fpAllocation) ou scope='sprint' pra override pontual (SprintMember). Use action='clear' com scope='sprint' pra remover override. Sujeito à Regra 9b (confirmação 2 turnos).",
      inputSchema: z.object({
        scope: z
          .enum(["project", "sprint"])
          .describe("project = teto padrão; sprint = override pontual"),
        action: z
          .enum(["set", "clear"])
          .default("set")
          .describe(
            "set aplica o fpAllocation; clear remove (só faz sentido com scope='sprint')",
          ),
        memberName: z.string().describe("Nome parcial do membro"),
        projectName: z
          .string()
          .optional()
          .describe("Nome parcial do projeto (obrigatório se scope='project' ou 'sprint')"),
        sprintName: z
          .string()
          .optional()
          .describe(
            "Nome do sprint, ex: 'Sprint 1' (obrigatório se scope='sprint'). Sprints renumeram cronologicamente — use o nome atual.",
          ),
        fpAllocation: z
          .number()
          .int()
          .min(0)
          .max(500)
          .optional()
          .describe("FP/sprint dedicados (obrigatório se action='set')"),
      }),
      execute: async ({
        scope,
        action,
        memberName,
        projectName,
        sprintName,
        fpAllocation,
      }) => {
        if (action === "set" && fpAllocation === undefined) {
          return { error: "fpAllocation é obrigatório quando action='set'." };
        }
        if (action === "clear" && scope === "project") {
          return {
            error:
              "action='clear' só funciona com scope='sprint' — pra zerar projeto, use action='set' com fpAllocation=0.",
          };
        }

        const { data: member } = await supabase
          .from("Member")
          .select("id, name")
          .ilike("name", `%${memberName}%`)
          .limit(1)
          .maybeSingle();
        if (!member) {
          return { error: `Membro "${memberName}" não encontrado.` };
        }

        if (scope === "project") {
          if (!projectName) {
            return {
              error: "projectName é obrigatório quando scope='project'.",
            };
          }
          const { data: project } = await supabase
            .from("Project")
            .select("id, name")
            .ilike("name", `%${projectName}%`)
            .limit(1)
            .maybeSingle();
          if (!project) {
            return { error: `Projeto "${projectName}" não encontrado.` };
          }

          const { data: existing } = await supabase
            .from("ProjectMember")
            .select("id")
            .eq("projectId", project.id)
            .eq("memberId", member.id)
            .maybeSingle();

          if (existing) {
            const { error } = await supabase
              .from("ProjectMember")
              .update({ fpAllocation })
              .eq("id", existing.id);
            if (error) return { error: error.message };
          } else {
            const { error } = await supabase.from("ProjectMember").insert({
              id: crypto.randomUUID(),
              projectId: project.id,
              memberId: member.id,
              fpAllocation,
            });
            if (error) return { error: error.message };
          }

          const { data: commit } = await supabase
            .from("member_commitment_overview")
            .select("committed, capacity")
            .eq("id", member.id)
            .maybeSingle();
          const overcommit = commit
            ? Number(commit.committed) > Number(commit.capacity)
            : false;

          return {
            updated: true,
            scope: "project",
            project: project.name,
            member: member.name,
            fpAllocation,
            ...(overcommit && {
              warning: `${member.name} ficou em overcommit (${commit?.committed}/${commit?.capacity} FP).`,
            }),
          };
        }

        // scope === 'sprint'
        if (!sprintName) {
          return { error: "sprintName é obrigatório quando scope='sprint'." };
        }
        if (!projectName) {
          return {
            error:
              "projectName é obrigatório quando scope='sprint' (sprint names não são únicos entre projetos).",
          };
        }
        const { data: scopedProject } = await supabase
          .from("Project")
          .select("id, name")
          .ilike("name", `%${projectName}%`)
          .limit(1)
          .maybeSingle();
        if (!scopedProject) {
          return { error: `Projeto "${projectName}" não encontrado.` };
        }
        const { data: sprint } = await supabase
          .from("Sprint")
          .select("id, name, projectId")
          .eq("name", sprintName)
          .eq("projectId", scopedProject.id)
          .maybeSingle();
        if (!sprint) {
          return {
            error: `Sprint "${sprintName}" não encontrado no projeto "${scopedProject.name}".`,
          };
        }

        if (action === "clear") {
          const { error } = await supabase
            .from("SprintMember")
            .delete()
            .eq("sprintId", sprint.id)
            .eq("memberId", member.id);
          if (error) return { error: error.message };
          return {
            cleared: true,
            scope: "sprint",
            sprint: sprint.name,
            member: member.name,
          };
        }

        // action === 'set' on sprint — validate member is in project first
        const { data: pm } = await supabase
          .from("ProjectMember")
          .select("id")
          .eq("projectId", sprint.projectId)
          .eq("memberId", member.id)
          .maybeSingle();
        if (!pm) {
          return {
            error: `${member.name} não está alocado ao projeto desse sprint — chame manage_allocation com scope='project' primeiro.`,
          };
        }

        const { error } = await supabase.from("SprintMember").upsert(
          {
            sprintId: sprint.id,
            memberId: member.id,
            fpAllocation: fpAllocation as number,
            updatedAt: new Date().toISOString(),
          },
          { onConflict: "sprintId,memberId" },
        );
        if (error) return { error: error.message };

        return {
          updated: true,
          scope: "sprint",
          sprint: sprint.name,
          member: member.name,
          fpAllocation,
          note: "Override ativo só para este sprint — outros sprints continuam com ProjectMember.fpAllocation.",
        };
      },
    });
  }

  // ─── Meeting / Roam tools ────────────────────────────────

  tools.get_recent_meetings = tool({
    description:
      "Lista reuniões candidatas — combina dados internos (Meeting, type=pm_review|general) com transcrições de provedores externos (Roam e Granola). Use SEMPRE como primeira fase pra apresentar candidatas ao usuário; só busque transcrição completa depois que o usuário confirmar QUAL reunião quer.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(90).default(14).describe("Janela em dias contados pra trás a partir de hoje (ignorado se 'date' for passado)"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Filtra por uma data específica YYYY-MM-DD (sobrepõe 'days')"),
      participant: z.string().optional().describe("Filtra por nome parcial de participante (case-insensitive)"),
      sources: z.array(z.enum(SOURCE_VALUES)).optional().describe("Quais provedores consultar. Default: ambos (roam + granola)."),
    }),
    execute: async ({ days, date, participant, sources }) => {
      let since: Date;
      let until: Date | null = null;
      if (date) {
        since = new Date(`${date}T00:00:00`);
        until = new Date(`${date}T23:59:59.999`);
      } else {
        since = new Date();
        since.setDate(since.getDate() - days);
      }
      const sinceISO = since.toISOString().split("T")[0];
      const untilISO = until ? until.toISOString().split("T")[0] : null;

      // Internal meetings
      let intQuery = supabase
        .from("Meeting")
        .select("id, date, notes")
        .gte("date", sinceISO)
        .order("date", { ascending: false });
      if (untilISO) intQuery = intQuery.lte("date", untilISO);
      const { data: meetings } = await intQuery;

      const meetingList = meetings || [];
      const enriched = await Promise.all(
        meetingList.map(async (m) => {
          const [{ data: reviews }, { data: actions }] = await Promise.all([
            supabase
              .from("MeetingProjectReview")
              .select("projectId, sprintHealth, attentionPoints, nextSteps, additionalNotes, member:Member(name), project:Project(name)")
              .eq("meetingId", m.id),
            supabase
              .from("Todo")
              .select("description, status, dueDate, resolvedAt, assignee:Member!Todo_assigneeId_fkey(name)")
              .eq("meetingId", m.id),
          ]);
          return { ...m, reviews: reviews || [], actions: actions || [] };
        })
      );

      const { meetings: external, errors, availability } = await listMeetings(meetingsResolver, {
        since: since.toISOString(),
        until: until ? until.toISOString() : undefined,
        max: 50,
        participant,
        sources,
      });

      return {
        filter: {
          date: date ?? null,
          days: date ? null : days,
          participant: participant ?? null,
          sources: sources ?? ["roam", "granola"],
        },
        internalMeetings: enriched,
        externalMeetings: external.map((m) => ({
          source: m.source,
          id: m.id,
          date: m.start,
          title: m.title,
          participants: m.participants.map((p) => p.name),
        })),
        totalInternal: enriched.length,
        totalExternal: external.length,
        availability,
        ...(Object.keys(errors).length ? { errors } : {}),
      };
    },
  });

  tools.get_meeting_transcript = tool({
    description:
      "Busca a transcrição completa de uma reunião (Roam ou Granola). Retorna texto formatado com speakers, resumo e action items quando disponíveis. Use para analisar o que foi discutido.",
    inputSchema: z.object({
      source: z.enum(SOURCE_VALUES).describe("Provedor da reunião (mesmo source retornado por get_recent_meetings)"),
      meetingId: z.string().describe("ID da reunião no provedor (era transcriptId no Roam)"),
    }),
    execute: async ({ source, meetingId }) => {
      if (source === "roam" && !roamToken) return { error: NO_ROAM_TOKEN };
      try {
        const detail = await getMeetingDetail(meetingsResolver, source, meetingId);
        return {
          source: detail.source,
          id: detail.id,
          title: detail.title,
          date: detail.start,
          durationMinutes: detail.durationMinutes,
          participants: detail.participants,
          summary: detail.summary,
          actionItems: detail.actionItems,
          transcript: detail.transcriptText,
        };
      } catch (err) {
        return { error: `Erro ao buscar transcrição: ${(err as Error).message}` };
      }
    },
  });

  tools.ask_meeting = tool({
    description:
      "Faz uma pergunta sobre uma reunião específica usando o AI nativo do provedor. Atualmente suportado apenas em Roam (Granola ainda não expõe esse endpoint). Para reuniões Granola, busque a transcrição com get_meeting_transcript e raciocine sobre ela.",
    inputSchema: z.object({
      source: z.enum(SOURCE_VALUES).describe("Provedor da reunião (mesmo source retornado por get_recent_meetings)"),
      meetingId: z.string().describe("ID da reunião no provedor"),
      question: z.string().describe("Pergunta sobre a reunião"),
    }),
    execute: async ({ source, meetingId, question }) => {
      if (source === "roam" && !roamToken) return { error: NO_ROAM_TOKEN };
      try {
        const { answer } = await askMeeting(meetingsResolver, source, meetingId, question);
        return { answer };
      } catch (err) {
        return { error: `Erro ao perguntar ao provedor: ${(err as Error).message}` };
      }
    },
  });

  tools.get_meeting_reviews = tool({
    description:
      "Lista as revisões de projeto de uma reunião (MeetingProjectReview) agrupadas por PM. Retorna os campos atuais (nextSteps, sprintHealth, attentionPoints, additionalNotes) pra que você saiba o que ainda falta preencher. Se meetingId for omitido, usa a reunião do contexto.",
    inputSchema: z.object({
      meetingId: z.string().uuid().optional().describe("UUID da reunião (opcional — default: reunião do contexto)"),
    }),
    execute: async ({ meetingId }) => {
      const targetId = meetingId || activeMeetingId;
      if (!targetId) return { error: "Nenhuma reunião no contexto. Informe meetingId." };

      const { data: meeting } = await supabase
        .from("Meeting")
        .select("id, date")
        .eq("id", targetId)
        .maybeSingle();
      if (!meeting) return { error: `Reunião "${targetId}" não encontrada.` };

      const { data: reviews } = await supabase
        .from("MeetingProjectReview")
        .select("id, nextSteps, sprintHealth, attentionPoints, additionalNotes, order, project:Project(id, name, status), member:Member(id, name)")
        .eq("meetingId", targetId)
        .order("order", { ascending: true });

      const reviewList = reviews || [];
      const byPm: Record<string, { pmId: string; pmName: string; projects: Array<Record<string, unknown>> }> = {};

      for (const r of reviewList) {
        const pm = r.member as { id: string; name: string } | null;
        if (!pm) continue;
        const proj = r.project as { id: string; name: string; status: string } | null;
        if (!byPm[pm.id]) byPm[pm.id] = { pmId: pm.id, pmName: pm.name, projects: [] };
        byPm[pm.id].projects.push({
          reviewId: r.id,
          projectName: proj?.name || "?",
          projectStatus: proj?.status || "?",
          sprintHealth: r.sprintHealth,
          nextSteps: r.nextSteps,
          attentionPoints: r.attentionPoints,
          additionalNotes: r.additionalNotes,
        });
      }

      return {
        meeting: { id: meeting.id, date: meeting.date },
        pmCount: Object.keys(byPm).length,
        reviewCount: reviewList.length,
        byPm: Object.values(byPm),
      };
    },
  });

  tools.list_meeting_actions = tool({
    description:
      "Lista MeetingTaskAction (propostas de mudança em Tasks discutidas em reunião). Use pra ver o que já foi proposto numa daily/super_planning/pm_review e evitar duplicar sugestões. Retorna por padrão só ações com decision='pending'.",
    inputSchema: z.object({
      meetingId: z.string().uuid().optional().describe("UUID da reunião (opcional — default: reunião do contexto)"),
      decision: z.enum(["pending", "approved", "rejected", "all"]).default("pending").describe("Filtrar por decision (default: pending)"),
      type: z.enum(["create", "update", "delete", "move", "review"]).optional().describe("Filtrar por tipo de ação"),
    }),
    execute: async ({ meetingId, decision, type }) => {
      const targetId = meetingId || activeMeetingId;
      if (!targetId) return { error: "Nenhuma reunião no contexto. Informe meetingId." };

      let query = supabase
        .from("MeetingTaskAction")
        .select(`
          id, type, decision, execution, source, taskId, targetSprintId, payload,
          aiReasoning, aiConfidence, reviewReasons, reviewNote, createdAt,
          project:Project(name),
          task:Task(reference, title),
          targetSprint:Sprint!MeetingTaskAction_targetSprintId_fkey(name)
        `)
        .eq("meetingId", targetId)
        .order("createdAt", { ascending: true });

      if (decision !== "all") query = query.eq("decision", decision);
      if (type) query = query.eq("type", type);

      const { data, error } = await query;
      if (error) return { error: `Erro ao listar ações: ${error.message}` };

      const actions = (data || []).map((a) => ({
        id: a.id,
        type: a.type,
        decision: a.decision,
        execution: a.execution,
        source: a.source,
        project: (a.project as { name: string } | null)?.name ?? null,
        task: a.task
          ? `[${(a.task as { reference: string | null }).reference ?? "?"}] ${(a.task as { title: string }).title}`
          : null,
        targetSprint: (a.targetSprint as { name: string } | null)?.name ?? null,
        payload: a.payload,
        aiReasoning: a.aiReasoning,
        aiConfidence: a.aiConfidence,
        reviewReasons: a.reviewReasons,
        reviewNote: a.reviewNote,
      }));

      return { meetingId: targetId, count: actions.length, actions };
    },
  });

  if (capabilities.writeTools) {
    tools.create_meeting = tool({
      description:
        "Cria uma reunião nova (Meeting) com a estrutura adequada ao tipo: pm_review (com reviews por PM), daily, super_planning (vincula sprint ativa), general, private (só owner). Resolve nomes de projetos/PMs/participantes em IDs. Carrega automaticamente Todos pendentes da última reunião. NÃO use durante uma reunião ativa — só em conversa solta ou via instrução clara do PM. **Private:** prefira pelo MeetingSheet/UI (com import do Granola). Use aqui só se o user pediu explicitamente \"cria uma privada pra mim\".",
      inputSchema: z.object({
        type: z.enum(["pm_review", "general", "daily", "super_planning", "private"]).describe("Tipo da reunião"),
        date: z.string().describe("Data e hora em ISO (YYYY-MM-DD ou YYYY-MM-DDTHH:mm). Use a data corrente do bloco '## Hoje' como referência pra interpretar 'hoje', 'amanhã', 'essa quinta'."),
        title: z.string().optional().describe("Título opcional"),
        projectNames: z.array(z.string()).optional().describe("Nomes parciais dos projetos vinculados. daily exige ≥1; super_planning exige exatamente 1; pm_review opcional (filtra PMs); general opcional"),
        pmNames: z.array(z.string()).optional().describe("Apenas pra pm_review: nomes dos PMs cujos projetos viram reviews. Sem isso, agrega todos PMs com projeto ativo."),
        attendeeNames: z.array(z.string()).optional().describe("Nomes parciais de Members participantes (explícitos). Mergeados com auto-derive sem duplicar."),
        attendeesFromProjects: z.boolean().optional().describe("Se true, deriva attendees automaticamente do squad dos projetos vinculados (PM + ProjectMembers). Default: true em daily/super_planning/general; false em pm_review (convenção: pm_review é só PMs entre si). Sempre mergeia com attendeeNames sem duplicar."),
        notes: z.string().optional().describe("Notas/transcrição (opcional)"),
      }),
      execute: async (args) => {
        const { type, date, title, projectNames, pmNames, attendeeNames, attendeesFromProjects, notes } = args;
        const autoDeriveDefault = type === "daily" || type === "super_planning" || type === "general";
        const autoDerive = attendeesFromProjects ?? autoDeriveDefault;

        // Resolve projects
        const projectIds: string[] = [];
        if (projectNames && projectNames.length > 0) {
          for (const name of projectNames) {
            const { data: p } = await supabase
              .from("Project")
              .select("id, name")
              .ilike("name", `%${name}%`)
              .limit(1)
              .maybeSingle();
            if (!p) return { error: `Projeto "${name}" não encontrado.` };
            projectIds.push(p.id);
          }
        }

        // Validações por tipo
        if (type === "daily" && projectIds.length === 0) {
          return { error: "Daily exige ao menos um projeto. Passe projectNames." };
        }

        let resolvedSprintId: string | null = null;
        if (type === "super_planning") {
          if (projectIds.length !== 1) {
            return { error: "Super Planning exige exatamente 1 projeto em projectNames." };
          }
          const { data: activeSprint } = await supabase
            .from("Sprint")
            .select("id, name")
            .eq("projectId", projectIds[0])
            .eq("status", "active")
            .maybeSingle();
          if (!activeSprint) {
            return { error: "Projeto sem sprint ativa — crie ou ative uma sprint antes de marcar a Super Planning." };
          }
          resolvedSprintId = activeSprint.id;
        }

        // Resolve PMs (pm_review only) → reviews
        const pmIds: string[] = [];
        let reviews: Array<{ projectId: string; memberId: string; order: number }> = [];
        if (type === "pm_review") {
          if (pmNames && pmNames.length > 0) {
            for (const name of pmNames) {
              const { data: m } = await supabase
                .from("Member")
                .select("id, name")
                .ilike("name", `%${name}%`)
                .limit(1)
                .maybeSingle();
              if (!m) return { error: `PM "${name}" não encontrado.` };
              pmIds.push(m.id);
            }
          }

          let pmQuery = supabase
            .from("Project")
            .select("id, pmId")
            .eq("status", "active")
            .not("pmId", "is", null);
          if (pmIds.length > 0) pmQuery = pmQuery.in("pmId", pmIds);
          const { data: projects } = await pmQuery;
          reviews = (projects ?? []).map((p, i) => ({
            projectId: p.id,
            memberId: p.pmId!,
            order: i,
          }));
        }

        // Resolve attendees (members) — usa Map pra deduplicar por memberId
        const attendeeMap = new Map<string, { memberId: string; role?: string | null }>();

        // 1) Explícitos (attendeeNames)
        if (attendeeNames && attendeeNames.length > 0) {
          for (const name of attendeeNames) {
            const { data: m } = await supabase
              .from("Member")
              .select("id, name")
              .ilike("name", `%${name}%`)
              .limit(1)
              .maybeSingle();
            if (!m) return { error: `Membro "${name}" não encontrado.` };
            attendeeMap.set(m.id, { memberId: m.id });
          }
        }

        // 2) Auto-derive do squad dos projetos vinculados
        // (UNION de Project.pmId + ProjectMember). Não roda pra pm_review por default.
        if (autoDerive && projectIds.length > 0) {
          const { data: projects } = await supabase
            .from("Project")
            .select("id, pmId")
            .in("id", projectIds);
          const { data: pmRows } = await supabase
            .from("ProjectMember")
            .select("memberId")
            .in("projectId", projectIds);

          for (const p of projects || []) {
            if (p.pmId && !attendeeMap.has(p.pmId)) {
              attendeeMap.set(p.pmId, { memberId: p.pmId, role: "pm" });
            }
          }
          for (const r of pmRows || []) {
            if (!attendeeMap.has(r.memberId)) {
              attendeeMap.set(r.memberId, { memberId: r.memberId });
            }
          }
        }

        // 3) Default pra pm_review: PMs explícitos viram attendees com role 'pm'
        if (type === "pm_review" && pmIds.length > 0) {
          for (const id of pmIds) {
            if (!attendeeMap.has(id)) attendeeMap.set(id, { memberId: id, role: "pm" });
          }
        }

        const attendees = Array.from(attendeeMap.values());

        // Carry-over (espelha rota /api/meetings)
        const { data: lastMeeting } = await supabase
          .from("Meeting")
          .select("id")
          .lt("date", new Date().toISOString())
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();

        let carryActions: Array<{ description: string; assigneeId: string; dueDate: string | null }> = [];
        if (lastMeeting) {
          const { data: pendingActions } = await supabase
            .from("Todo")
            .select("description, assigneeId, dueDate")
            .eq("meetingId", lastMeeting.id)
            .in("status", ["todo", "doing"]);
          carryActions = (pendingActions ?? []).map((a) => ({
            description: a.description,
            assigneeId: a.assigneeId,
            dueDate: a.dueDate,
          }));
        }

        const { data: meetingId, error } = await supabase.rpc(
          "create_meeting_with_reviews",
          {
            p_date: new Date(date).toISOString(),
            p_reviews: reviews as never,
            p_carry_actions: carryActions as never,
            p_type: type,
            p_title: title ?? undefined,
            p_attendees: attendees as never,
            p_project_ids: projectIds as never,
            p_notes: notes ?? undefined,
            p_sprint_id: resolvedSprintId ?? undefined,
          },
        );
        if (error) return { error: `Erro ao criar reunião: ${error.message}` };

        return {
          created: true,
          meetingId,
          type,
          date,
          title: title ?? null,
          projectCount: projectIds.length,
          reviewCount: reviews.length,
          attendeeCount: attendees.length,
          carryOverCount: carryActions.length,
          sprintId: resolvedSprintId,
        };
      },
    });

    tools.update_meeting_review = tool({
      description:
        "Atualiza (parcialmente) os campos de uma revisão de projeto numa reunião. Busca a revisão pelo nome do projeto dentro da reunião. Só passe os campos que quiser mudar — os omitidos são preservados.",
      inputSchema: z.object({
        meetingId: z.string().uuid().optional().describe("UUID da reunião (opcional — default: reunião do contexto)"),
        projectName: z.string().describe("Nome parcial do projeto (case-insensitive)"),
        sprintHealth: z.enum(["healthy", "attention", "critical"]).optional().describe("Saúde do sprint"),
        nextSteps: z.string().optional().describe("Próximos passos do projeto"),
        attentionPoints: z.string().optional().describe("Riscos, bloqueios, preocupações"),
        additionalNotes: z.string().optional().describe("OBS — observações adicionais"),
      }),
      execute: async ({ meetingId, projectName, sprintHealth, nextSteps, attentionPoints, additionalNotes }) => {
        const targetId = meetingId || activeMeetingId;
        if (!targetId) return { error: "Nenhuma reunião no contexto. Informe meetingId." };

        const { data: matches } = await supabase
          .from("MeetingProjectReview")
          .select("id, project:Project!inner(id, name), member:Member(name)")
          .eq("meetingId", targetId)
          .ilike("project.name", `%${projectName}%`)
          .limit(2);

        const list = matches || [];
        if (list.length === 0) {
          return { error: `Nenhuma revisão encontrada para projeto "${projectName}" na reunião.` };
        }
        if (list.length > 1) {
          return {
            error: `Mais de um projeto bate com "${projectName}": ${list.map((r) => (r.project as { name: string } | null)?.name).join(", ")}. Seja mais específico.`,
          };
        }

        const review = list[0];
        const patch: {
          sprintHealth?: string;
          nextSteps?: string | null;
          attentionPoints?: string | null;
          additionalNotes?: string | null;
        } = {};
        if (sprintHealth !== undefined) patch.sprintHealth = sprintHealth;
        if (nextSteps !== undefined) patch.nextSteps = nextSteps;
        if (attentionPoints !== undefined) patch.attentionPoints = attentionPoints;
        if (additionalNotes !== undefined) patch.additionalNotes = additionalNotes;

        if (Object.keys(patch).length === 0) {
          return { error: "Nada para atualizar — passe pelo menos um campo." };
        }

        const { error } = await supabase
          .from("MeetingProjectReview")
          .update(patch)
          .eq("id", review.id);
        if (error) return { error: `Erro ao atualizar revisão: ${error.message}` };

        return {
          updated: true,
          project: (review.project as { name: string } | null)?.name,
          pm: (review.member as { name: string } | null)?.name,
          fields: Object.keys(patch),
        };
      },
    });

    tools.update_meeting_notes = tool({
      description:
        "Atualiza o campo `notes` da reunião — o resumo livre/markdown que aparece em 'Notas gerais' na UI. Use durante ingestão de transcrição pra registrar um resumo rico do que foi discutido (tópicos, decisões, contexto, citações relevantes). Substitui o conteúdo atual; mescle manualmente se quiser preservar.",
      inputSchema: z.object({
        meetingId: z.string().uuid().optional().describe("UUID da reunião (opcional — default: reunião do contexto)"),
        notes: z.string().describe("Conteúdo markdown das notas. Pode ser longo — não há limite prático."),
      }),
      execute: async ({ meetingId, notes }) => {
        const targetId = meetingId || activeMeetingId;
        if (!targetId) return { error: "Nenhuma reunião no contexto. Informe meetingId." };

        const { error } = await supabase
          .from("Meeting")
          .update({ notes, updatedAt: new Date().toISOString() })
          .eq("id", targetId);
        if (error) return { error: `Erro ao atualizar notas: ${error.message}` };

        return { updated: true, meetingId: targetId, length: notes.length };
      },
    });

    tools.create_todo = tool({
      description:
        "Cria uma To-do — obrigação atribuída a um membro. Pode nascer de uma reunião (origem='meeting') ou ser uma tarefa solta atribuída a alguém (origem='manual'). Use sem meetingId para registrar To-do pessoal/operacional fora de reunião.",
      inputSchema: z.object({
        meetingId: z.string().optional().describe("UUID da reunião (opcional — default: reunião do contexto se houver). Se ausente e sem contexto, To-do é criada como manual."),
        description: z.string().min(1).describe("O que precisa ser feito"),
        assigneeName: z.string().describe("Nome parcial do responsável"),
        dueDate: z.string().optional().describe("Prazo em YYYY-MM-DD (opcional)"),
        projectName: z.string().optional().describe("Nome parcial do projeto pra vincular à revisão correspondente (só se vinculada a reunião)"),
      }),
      execute: async ({ meetingId, description, assigneeName, dueDate, projectName }) => {
        const targetMeetingId = meetingId || activeMeetingId || null;

        const { data: member } = await supabase
          .from("Member")
          .select("id, name")
          .ilike("name", `%${assigneeName}%`)
          .limit(1)
          .maybeSingle();
        if (!member) return { error: `Membro "${assigneeName}" não encontrado.` };

        let sourceReviewId: string | null = null;
        if (targetMeetingId && projectName) {
          const { data: review } = await supabase
            .from("MeetingProjectReview")
            .select("id, project:Project!inner(name)")
            .eq("meetingId", targetMeetingId)
            .ilike("project.name", `%${projectName}%`)
            .limit(1)
            .maybeSingle();
          if (review) sourceReviewId = review.id;
        }

        const source = targetMeetingId ? "meeting" : "agent";

        const { data: todo, error } = await supabase
          .from("Todo")
          .insert({
            id: crypto.randomUUID(),
            meetingId: targetMeetingId,
            source,
            description,
            assigneeId: member.id,
            createdById: currentMemberId ?? member.id,
            dueDate: dueDate ? new Date(dueDate).toISOString() : null,
            status: "todo",
            sourceReviewId,
            updatedAt: new Date().toISOString(),
          })
          .select("id, description, status, dueDate, source")
          .single();
        if (error) return { error: `Erro ao criar To-do: ${error.message}` };

        return {
          created: true,
          todo,
          assignee: member.name,
          source,
          linkedToProject: projectName && sourceReviewId ? projectName : null,
        };
      },
    });

    tools.extract_meeting_actions = tool({
      description:
        "Sub-agente especialista que lê a transcrição completa da reunião e devolve {tasks, todos, skipped} estruturados. USE SEMPRE NA INGESTÃO DE TRANSCRIÇÃO (daily/super_planning/pm_review) ANTES de chamar propose_task_action/create_todo — o sub-agente cobre a transcrição inteira por tópico, identifica matches com Tasks existentes (REF citada ou título similar), vincula US ativas e diferencia Task (sistema) de Todo (pessoas/processo) pela heurística de domínio. Você (Alpha) RECEBE o resultado e EXECUTA propose_task_action / create_todo em paralelo pra cada item. Não duplique trabalho — se chamou extract_meeting_actions, NÃO releia a transcrição pra extrair ações de novo.",
      inputSchema: z.object({
        meetingId: z.string().uuid().optional().describe("UUID da reunião (default: reunião do contexto)"),
        transcript: z.string().min(1).describe("Transcrição completa da reunião (cues+summary do Roam, vindo de get_meeting_transcript)."),
      }),
      execute: async ({ meetingId, transcript }) => {
        const targetMeetingId = meetingId || activeMeetingId;
        if (!targetMeetingId) {
          return { error: "Nenhuma reunião no contexto. extract_meeting_actions só funciona dentro de uma reunião." };
        }

        const { extractActions } = await import("./extractors/actions");

        // Hidrata contexto do banco — projetos vinculados, members do squad,
        // US ativas, Tasks ativas (top 500 por updatedAt).
        const { data: meeting } = await supabase
          .from("Meeting")
          .select(
            "id, type, projectLinks:MeetingProjectLink(project:Project(id, name))",
          )
          .eq("id", targetMeetingId)
          .maybeSingle();

        if (!meeting) {
          return { error: `Reunião "${targetMeetingId}" não encontrada.` };
        }

        const projects = (meeting.projectLinks || [])
          .map((l: { project: { id: string; name: string } | null }) => l.project)
          .filter((p): p is { id: string; name: string } => !!p);

        if (projects.length === 0) {
          return {
            error:
              "Reunião sem projetos vinculados — sub-agente precisa de ao menos 1 projeto pra resolver assignees/tasks.",
          };
        }

        const projectIds = projects.map((p) => p.id);

        // Members do squad (PM + ProjectMembers) — todos os projetos vinculados.
        const { data: projectMembers } = await supabase
          .from("ProjectMember")
          .select("member:Member(id, name, role)")
          .in("projectId", projectIds);
        const memberMap = new Map<string, { id: string; name: string; role: string }>();
        for (const pm of projectMembers || []) {
          const m = (pm as { member: { id: string; name: string; role: string } | null }).member;
          if (m) memberMap.set(m.id, m);
        }
        // Inclui PMs dos projetos
        const { data: projectsWithPm } = await supabase
          .from("Project")
          .select("pm:Member!Project_pmId_fkey(id, name, role)")
          .in("id", projectIds);
        for (const p of projectsWithPm || []) {
          const pm = (p as { pm: { id: string; name: string; role: string } | null }).pm;
          if (pm) memberMap.set(pm.id, pm);
        }
        const members = Array.from(memberMap.values());

        // User Stories ativas (refined/committed)
        const { data: storiesRaw } = await supabase
          .from("UserStory")
          .select("id, reference, title, refinementStatus")
          .in("projectId", projectIds)
          .in("refinementStatus", ["refined", "committed"])
          .order("reference", { ascending: true });
        const userStories = (storiesRaw || []).map((s) => ({
          id: s.id as string,
          reference: s.reference as string,
          title: s.title as string,
        }));

        // Tasks ativas (não 'done') — top 500 por updatedAt.
        const { data: tasksRaw } = await supabase
          .from("Task")
          .select("reference, title, status, updatedAt")
          .in("projectId", projectIds)
          .neq("status", "done")
          .order("updatedAt", { ascending: false })
          .limit(500);
        const tasks = (tasksRaw || []).map((t) => ({
          reference: t.reference as string,
          title: t.title as string,
          status: t.status as string,
        }));

        // Budget guard: sub-agentes (extract/enrich/estimate) têm cap por
        // sessão (default 20). Excedeu → tool retorna erro estruturado e
        // o modelo decide o que fazer (pedir aprovação, fallback manual).
        if (threadId) {
          const { reserveSubAgentCall } = await import("../../budget");
          const budget = reserveSubAgentCall(threadId);
          if (!budget.ok) {
            return { error: budget.reason };
          }
        }

        try {
          const result = await extractActions(
            {
              transcript,
              meetingType: meeting.type as "pm_review" | "general" | "daily" | "super_planning" | "private",
              projects: projects.map((p) => ({ id: p.id, name: p.name })),
              members,
              userStories,
              tasks,
            },
            {
              agentName: "alpha",
              threadId: threadId ?? null,
              memberId: currentMemberId ?? null,
              // Heurística: se a meeting tem 1 projeto vinculado, usa ele;
              // senão null (telemetria fica desagrupada).
              projectId: projects.length === 1 ? projects[0].id : null,
            },
          );

          return {
            ok: true,
            counts: {
              tasks: result.tasks.length,
              todos: result.todos.length,
              skipped: result.skipped.length,
            },
            tasks: result.tasks,
            todos: result.todos,
            skipped: result.skipped,
            note:
              "Agora execute propose_task_action pra cada task e create_todo pra cada todo. Resolva assigneeName→memberId via lista de members do contexto. Pra type=update use o taskReference. Pra type=review marque reviewReasons=['other'] e reviewNote com o reasoning. NÃO releia a transcrição.",
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            error: `Sub-agente falhou: ${msg}. Fallback: leia a transcrição manualmente e classifique Task/Todo pela heurística de domínio.`,
          };
        }
      },
    });

    tools.propose_task_action = tool({
      description:
        "Propõe uma mudança em Task no contexto de uma reunião — NÃO executa, só registra como proposta pendente em MeetingTaskAction. O PM aprova/edita/rejeita pela UI da reunião e o sistema aplica em batch. Use SEMPRE em vez de create_task/update_task/bulk_update_tasks quando houver reunião ativa do tipo daily, super_planning, pm_review ou private. **Em private:** permitido SOMENTE quando há projetos vinculados, e SOMENTE nesses projetos; sem projetos vinculados, não chame esta tool (use create_todo).",
      inputSchema: z.object({
        meetingId: z.string().uuid().optional().describe("UUID da reunião (opcional — default: reunião do contexto)"),
        type: z.enum(["create", "update", "delete", "move", "review"]).describe(
          "create=task nova; update=editar campos; delete=tirar do sprint; move=mudar de sprint; review=marcar pra discutir"
        ),
        projectName: z.string().optional().describe("Nome parcial do projeto (obrigatório pra type=create; pra outros tipos vem da task)"),
        taskReference: z.string().optional().describe("Referência da task (ex: TASK-042) — obrigatória pra update/delete/move/review"),
        targetSprintName: z.string().optional().describe("Nome parcial do sprint destino (obrigatório pra type=move)"),
        payload: z.record(z.string(), z.unknown()).optional().describe(
          "Campos da ação. Pra create: { title, description?, scope, complexity, type, priority?, status?, assigneeIds?, sprintId?, userStoryId? }. **assigneeIds são UUIDs** (resolva nomes via get_allocated_project_members ANTES — não passe nomes). **userStoryId é UUID de uma US existente** — escolha da lista `### User Stories do projeto` no contexto (ou chame `list_stories`). NUNCA invente UUID; se nenhuma US bate, omita o campo (task isolada). Sem sprintId, status default = 'backlog'. Pra update: campos a mudar (mesmas chaves). Pra review: ignorado (use reviewReasons/reviewNote)."
        ),
        reasoning: z.string().min(1).describe("1-2 frases em pt-BR explicando o porquê da proposta"),
        confidence: z.number().min(0).max(1).default(0.7).describe("0..1, sua confiança na proposta. <0.5 considere usar type=review."),
        reviewReasons: z.array(z.enum([
          "scope", "acceptance_criteria", "dependencies", "estimate", "assignee", "other",
        ])).optional().describe("Pra type=review: o que precisa ser discutido"),
        reviewNote: z.string().optional().describe("Pra type=review: nota livre"),
      }),
      execute: async (args) => {
        const {
          meetingId, type, projectName, taskReference, targetSprintName,
          payload, reasoning, confidence, reviewReasons, reviewNote,
        } = args;

        const targetMeetingId = meetingId || activeMeetingId;
        if (!targetMeetingId) {
          return { error: "Nenhuma reunião no contexto. Esta tool só funciona dentro de uma reunião." };
        }

        // Validar consistência
        if (type === "create" && taskReference) {
          return { error: "type=create não aceita taskReference (a task ainda não existe)." };
        }
        if (type !== "create" && !taskReference) {
          return { error: `type=${type} exige taskReference da task afetada.` };
        }
        if (type === "move" && !targetSprintName) {
          return { error: "type=move exige targetSprintName." };
        }

        // Resolver projectId + taskId
        let resolvedProjectId: string | null = null;
        let resolvedTaskId: string | null = null;

        if (taskReference) {
          const { data: task } = await supabase
            .from("Task")
            .select("id, projectId, title")
            .eq("reference", taskReference)
            .maybeSingle();
          if (!task) return { error: `Task "${taskReference}" não encontrada.` };
          resolvedTaskId = task.id;
          resolvedProjectId = task.projectId;
        }

        if (type === "create") {
          if (!projectName) {
            return { error: "type=create exige projectName pra resolver o projeto." };
          }
          const { data: project } = await supabase
            .from("Project")
            .select("id, name")
            .ilike("name", `%${projectName}%`)
            .limit(1)
            .maybeSingle();
          if (!project) return { error: `Projeto "${projectName}" não encontrado.` };
          resolvedProjectId = project.id;
        }

        if (!resolvedProjectId) {
          return { error: "Não foi possível determinar projectId da proposta." };
        }

        // Resolver targetSprintId pra move — match exato (sprints renumeram cronologicamente)
        let resolvedTargetSprintId: string | null = null;
        if (type === "move" && targetSprintName) {
          const { data: sprint } = await supabase
            .from("Sprint")
            .select("id, name, projectId")
            .eq("name", targetSprintName)
            .eq("projectId", resolvedProjectId)
            .maybeSingle();
          if (!sprint) {
            return { error: `Sprint "${targetSprintName}" não encontrado no projeto da task.` };
          }
          resolvedTargetSprintId = sprint.id;
        }

        const insertPayload = {
          id: crypto.randomUUID(),
          meetingId: targetMeetingId,
          projectId: resolvedProjectId,
          type,
          taskId: resolvedTaskId,
          targetSprintId: resolvedTargetSprintId,
          payload: (payload ?? {}) as never,
          decision: "pending" as const,
          execution: "pending" as const,
          source: "ai" as const,
          aiReasoning: reasoning,
          aiConfidence: confidence,
          reviewReasons: reviewReasons ?? null,
          reviewNote: reviewNote ?? null,
          updatedAt: new Date().toISOString(),
        };

        const { data: created, error } = await supabase
          .from("MeetingTaskAction")
          .insert(insertPayload)
          .select("id, type, decision, execution")
          .single();

        if (error) return { error: `Erro ao registrar proposta: ${error.message}` };

        return {
          proposed: true,
          actionId: created.id,
          type: created.type,
          decision: created.decision,
          note: "Proposta registrada — PM decide via UI da reunião.",
        };
      },
    });

    tools.discard_meeting_action = tool({
      description:
        "Descarta uma proposta de MeetingTaskAction que ainda está pending (decision=pending, execution=pending). Use quando você quiser refazer uma sugestão ou o PM pediu pra remover. Não funciona em propostas já decididas/aplicadas — pra essas, peça ao PM pra rejeitar/desfazer pela UI.",
      inputSchema: z.object({
        actionId: z.string().describe("ID da MeetingTaskAction a descartar"),
      }),
      execute: async ({ actionId }) => {
        const { data: existing } = await supabase
          .from("MeetingTaskAction")
          .select("id, decision, execution, type")
          .eq("id", actionId)
          .maybeSingle();

        if (!existing) return { error: `Proposta "${actionId}" não encontrada.` };
        if (existing.decision !== "pending" || existing.execution !== "pending") {
          return {
            error: `Proposta já decidida/aplicada (decision=${existing.decision}, execution=${existing.execution}). Não dá pra descartar via Alpha.`,
          };
        }

        const { error } = await supabase
          .from("MeetingTaskAction")
          .delete()
          .eq("id", actionId);
        if (error) return { error: `Erro ao descartar: ${error.message}` };

        return { discarded: true, actionId, type: existing.type };
      },
    });
  }

  tools.get_pending_actions = tool({
    description:
      "Lista To-dos pendentes (status != done) com suas origens (reunião ou manual). Use para cobrar ações, preparar pauta da próxima reunião, ou verificar carga atual.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data: actions } = await supabase
        .from("Todo")
        .select("description, status, dueDate, source, assignee:Member!Todo_assigneeId_fkey(name), meeting:Meeting(date)")
        .neq("status", "done")
        .order("dueDate", { ascending: true });

      const actionList = (actions || []).map((a) => ({
        description: a.description,
        status: a.status,
        dueDate: a.dueDate,
        assignee: (a.assignee as { name: string } | null)?.name || "Sem responsavel",
        meetingDate: (a.meeting as { date: string } | null)?.date || "?",
        isOverdue: isOverdue(a.dueDate, a.status),
      }));

      const overdue = actionList.filter((a) => a.isOverdue);

      return {
        pendingActions: actionList,
        total: actionList.length,
        overdue: overdue.length,
      };
    },
  });

  return tools;
}
