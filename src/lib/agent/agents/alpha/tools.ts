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
import { upsertTranscriptRef } from "@/lib/transcripts/upsert";

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
      "Lista tasks (não-draft) com filtros opcionais por status, membro ou projeto. Retorna referencia, titulo, status, PFV, projeto e atribuicao. Quando o usuário está numa página de projeto/sprint, filtra pelo escopo da rota automaticamente; passe `projectName` explicitamente pra escapar do escopo e consultar cross-project.",
    inputSchema: z.object({
      status: z.enum(TASK_STATUSES).optional().describe("Filtrar por status"),
      memberName: z.string().optional().describe("Filtrar por nome do membro atribuido"),
      projectName: z.string().optional().describe("Nome parcial do projeto (case-insensitive). Passe explicitamente pra consultar cross-project, ignorando o escopo da rota."),
      limit: z.number().int().min(1).max(200).default(50).describe("Máximo de tasks (default 50)"),
    }),
    execute: async ({ status, memberName, projectName, limit }) => {
      // Resolve explicit projectName → id (pre-limit filter, not post-filter) so
      // tasks de um projeto de baixa prioridade não sejam descartadas pelo cap global.
      let scopedProjectId: string | undefined;
      if (projectName) {
        const { data: project } = await supabase
          .from("Project")
          .select("id, name")
          .ilike("name", `%${projectName}%`)
          .limit(1)
          .maybeSingle();
        if (!project) return { error: `Projeto "${projectName}" não encontrado.` };
        scopedProjectId = project.id;
      }

      let query = supabase
        .from("Task")
        .select("reference, title, status, type, functionPoints, dueDate, project:Project(name), assignments:TaskAssignment(member:Member(id, name))")
        .neq("status", "draft")
        .order("priority", { ascending: false })
        .limit(limit);

      if (status) query = query.eq("status", status);

      // Escopo: projectName explícito > sprint da rota > projeto da rota > global.
      if (scopedProjectId) query = query.eq("projectId", scopedProjectId);
      else if (routeSprintId) query = query.eq("sprintId", routeSprintId);
      else if (routeProjectId) query = query.eq("projectId", routeProjectId);

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
          alerts.push(`${m.name} sobrecarregado: ${allocated}/${capacity} PFV`);
        }
        if (capacity > 0 && allocated === 0) {
          alerts.push(`${m.name} sem tasks alocadas (${capacity} PFV disponiveis)`);
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
        "Cria uma nova task no backlog. Auto-calcula PFV (Ponto de Função Volund) a partir de scope x complexity. Opcionalmente atribui a um membro.",
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
          .describe("Novo scope — junto com complexity recalcula PFV"),
        complexity: z
          .enum(COMPLEXITIES)
          .optional()
          .describe("Nova complexity — junto com scope recalcula PFV"),
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

        // PFV recalc only if scope or complexity changed
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
          .describe("PFV/sprint dedicados (obrigatório se action='set')"),
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
              warning: `${member.name} ficou em overcommit (${commit?.committed}/${commit?.capacity} PFV).`,
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
      "Lista reuniões candidatas — combina Meetings internos (private + general) com transcrições de provedores externos (Roam e Granola). Use SEMPRE como primeira fase pra apresentar candidatas ao usuário; só busque transcrição completa depois que o usuário confirmar QUAL reunião quer.",
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

  if (capabilities.writeTools) {
    tools.create_meeting = tool({
      description:
        "Cria uma reunião nova (Meeting) na aba global — somente tipos `general` (pública, quem participou vê) ou `private` (só o owner). Resolve nomes de projetos/participantes em IDs. Carrega Todos pendentes da última reunião (carry-over). **Daily/super_planning/pm_review NÃO são Meeting — viraram Planning Ceremony no projeto.** Pra criar private com transcrição importada, prefira o MeetingSheet/UI (botão \"Importar do Granola\").",
      inputSchema: z.object({
        type: z.enum(["general", "private"]).describe("Tipo: general (pública) ou private (só owner)"),
        date: z.string().describe("Data e hora em ISO (YYYY-MM-DD ou YYYY-MM-DDTHH:mm). Use a data corrente do bloco '## Hoje' como referência."),
        title: z.string().optional().describe("Título opcional"),
        projectNames: z.array(z.string()).optional().describe("Nomes parciais dos projetos vinculados (opcional pra ambos os tipos)"),
        attendeeNames: z.array(z.string()).optional().describe("Nomes parciais de Members participantes (explícitos). Mergeados com auto-derive sem duplicar. Ignorado em `private`."),
        attendeesFromProjects: z.boolean().optional().describe("Se true, deriva attendees do squad dos projetos vinculados (PM + ProjectMembers). Default: true em general; ignorado em private (owner-only)."),
        notes: z.string().optional().describe("Notas/transcrição (opcional)"),
      }),
      execute: async (args) => {
        const { type, date, title, projectNames, attendeeNames, attendeesFromProjects, notes } = args;
        const autoDerive = type === "general" && (attendeesFromProjects ?? true);

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

        const attendeeMap = new Map<string, { memberId: string; role?: string | null }>();

        if (type === "general" && attendeeNames && attendeeNames.length > 0) {
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

        const attendees = Array.from(attendeeMap.values());

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
            p_reviews: [] as never,
            p_carry_actions: carryActions as never,
            p_type: type,
            p_title: title ?? undefined,
            p_attendees: attendees as never,
            p_project_ids: projectIds as never,
            p_notes: notes ?? undefined,
            p_sprint_id: undefined,
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
          attendeeCount: attendees.length,
          carryOverCount: carryActions.length,
        };
      },
    });

    tools.save_meeting_transcript_text = tool({
      description:
        "Persiste o texto BRUTO da transcrição num TranscriptRef (SSOT). Use logo após `get_meeting_transcript` durante ingestão pra cachear o texto — futuras leituras (suggest-actions, page meeting) usam isso sem precisar re-bater na API do provedor. Idempotente: re-chamar só atualiza o texto se vier diferente.",
      inputSchema: z.object({
        meetingId: z.string().uuid().optional().describe("UUID da reunião no Volund (opcional — default: reunião do contexto)"),
        source: z.enum(["roam", "granola"]).describe("Provedor de origem (mesmo source de get_meeting_transcript)"),
        sourceId: z.string().describe("ID externo da transcrição (mesmo ID usado em get_meeting_transcript)"),
        fullText: z.string().describe("Texto completo da transcrição (campo `transcript` do retorno de get_meeting_transcript)"),
      }),
      execute: async ({ meetingId, source, sourceId, fullText }) => {
        const targetId = meetingId || activeMeetingId;
        if (!targetId) return { error: "Nenhuma reunião no contexto. Informe meetingId." };

        try {
          const id = await upsertTranscriptRef(supabase, {
            source,
            sourceId,
            meetingId: targetId,
            fullText,
            importedById: currentMemberId ?? null,
          });
          return { saved: true, transcriptRefId: id, length: fullText.length };
        } catch (err) {
          return { error: `Erro ao salvar transcript: ${(err as Error).message}` };
        }
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
