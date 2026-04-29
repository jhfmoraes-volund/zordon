import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { suggestFunctionPoints, ACTIVE_STATUSES } from "@/lib/function-points";
import { TASK_STATUSES, TASK_TYPES, SCOPES, COMPLEXITIES } from "@/lib/task-constants";
import { RoamClient, cuesToText } from "@/lib/roam";
import { loadAgentHeuristic, loadFpMatrix } from "../../config";
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
  } = {},
): ToolSet {
  const supabase = db();
  const tools: ToolSet = {};
  const roamToken = capabilities.roamToken;
  const activeMeetingId = opts.activeMeetingId;
  const routeProjectId = opts.routeProjectId;
  const routeSprintId = opts.routeSprintId;
  const currentMemberId = opts.currentMemberId;
  const NO_ROAM_TOKEN =
    "Roam nao conectado. Peca ao PM para conectar em Configuracoes > Integracoes.";

  // ─── Read tools ──────────────────────────────────────────

  tools.get_sprint_overview = tool({
    description:
      "Retorna o estado completo do sprint ativo: tasks, membros com capacidade, e alertas. Use para ter uma visao atualizada da operacao. Quando o usuário está numa página de projeto/sprint, retorna o sprint daquele escopo automaticamente.",
    inputSchema: z.object({}),
    execute: async () => {
      let sprintQuery = supabase
        .from("Sprint")
        .select("id, name, startDate, endDate, status, project:Project(name)")
        .neq("status", "done");
      if (routeSprintId) {
        sprintQuery = supabase
          .from("Sprint")
          .select("id, name, startDate, endDate, status, project:Project(name)")
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

      return { sprint, tasks: tasks || [], members: members || [] };
    },
  });

  tools.get_member_commitments = tool({
    description:
      "Retorna a bateria de cada membro: capacidade total, committed (soma das alocações em projetos), e restante. Use pra saber quem tem espaço para novos projetos.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data } = await supabase
        .from("member_commitment_overview")
        .select("*")
        .order("name");
      return {
        members: (data || []).map((m) => ({
          name: m.name,
          role: m.role,
          capacity: m.capacity,
          committed: m.committed,
          remaining: m.remaining,
          projectCount: m.project_count,
          overcommit: (Number(m.committed) || 0) > (Number(m.capacity) || 0),
        })),
      };
    },
  });

  tools.get_sprint_capacity = tool({
    description:
      "Retorna a capacidade real de um sprint (soma das alocações dos membros no projeto, respeitando overrides) e quanto já foi alocado em tasks ativas. Se sprintId for omitido, usa o ativo.",
    inputSchema: z.object({
      sprintId: z.string().optional().describe("UUID do sprint (opcional — default: ativo)"),
    }),
    execute: async ({ sprintId }) => {
      let targetId = sprintId;
      if (!targetId) {
        const { data: active } = await supabase
          .from("Sprint")
          .select("id")
          .neq("status", "done")
          .order("startDate", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!active) return { error: "Nenhum sprint ativo." };
        targetId = active.id;
      }

      const [{ data: cap }, { data: members }] = await Promise.all([
        supabase
          .from("sprint_capacity_overview")
          .select("*")
          .eq("sprintId", targetId)
          .maybeSingle(),
        supabase
          .from("sprint_member_capacity")
          .select("*")
          .eq("sprintId", targetId)
          .order("member_name"),
      ]);

      return {
        sprintId: targetId,
        capacity: cap?.capacity ?? 0,
        allocated: cap?.allocated ?? 0,
        remaining: cap?.remaining ?? 0,
        members: (members || []).map((m) => ({
          name: m.member_name,
          allocation: m.fp_allocation,
          used: m.fp_used,
          hasOverride: m.has_sprint_override,
        })),
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
          ACTIVE_STATUSES.includes(t.status as typeof ACTIVE_STATUSES[number])
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

  // ─── Write tools ─────────────────────────────────────────

  if (capabilities.writeTools) {
    tools.create_sprint = tool({
      description:
        "Cria um novo sprint vinculado a um projeto. Retorna o sprint criado com estatisticas zeradas.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Nome do sprint no formato 'Sprint N' onde N é o número sequencial (ex: 'Sprint 4'). Não adicionar tema/sufixo a menos que o usuário peça explicitamente."),
        projectName: z.string().describe("Nome do projeto (busca por nome parcial)"),
        startDate: z.string().describe("Data de inicio no formato YYYY-MM-DD"),
        endDate: z.string().describe("Data de fim no formato YYYY-MM-DD"),
        status: z.enum(["planning", "active", "done"]).default("planning").describe("Status inicial do sprint"),
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
        const { data: ref } = await supabase.rpc("next_task_reference");
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

    tools.assign_task = tool({
      description:
        "Atribui um membro a uma task existente. Valida se o membro tem capacidade restante.",
      inputSchema: z.object({
        taskReference: z.string().describe("Referencia da task (ex: TSK-042)"),
        memberName: z.string().describe("Nome do membro"),
      }),
      execute: async ({ taskReference, memberName }) => {
        const { data: task } = await supabase
          .from("Task")
          .select("id, title, functionPoints")
          .eq("reference", taskReference)
          .maybeSingle();

        if (!task) return { error: `Task "${taskReference}" nao encontrada.` };

        const { data: member } = await supabase
          .from("Member")
          .select("id, name, fpCapacity")
          .ilike("name", `%${memberName}%`)
          .limit(1)
          .maybeSingle();

        if (!member) return { error: `Membro "${memberName}" nao encontrado.` };

        // Check capacity
        const { data: capacity } = await supabase
          .from("member_capacity_overview")
          .select("fp_allocated, fp_capacity")
          .eq("id", member.id)
          .maybeSingle();

        const allocated = Number(capacity?.fp_allocated) || 0;
        const cap = Number(capacity?.fp_capacity) || 0;
        const taskFP = task.functionPoints || 0;
        const willExceed = cap > 0 && (allocated + taskFP) > cap;

        // Remove existing assignments
        await supabase.from("TaskAssignment").delete().eq("taskId", task.id);

        // Create new assignment
        await supabase.from("TaskAssignment").insert({
          id: crypto.randomUUID(),
          taskId: task.id,
          memberId: member.id,
        });

        return {
          assigned: true,
          task: { reference: taskReference, title: task.title },
          member: member.name,
          ...(willExceed && {
            warning: `${member.name} ficara sobrecarregado: ${allocated + taskFP}/${cap} FP apos esta atribuicao.`,
          }),
        };
      },
    });

    tools.update_task_priority = tool({
      description:
        "Atualiza a prioridade de uma task. Valores de 0 (baixa) a 10 (critica).",
      inputSchema: z.object({
        taskReference: z.string().describe("Referencia da task (ex: TSK-042)"),
        priority: z.number().int().min(0).max(10).describe("Nova prioridade (0=baixa, 10=critica)"),
      }),
      execute: async ({ taskReference, priority }) => {
        const { data: task } = await supabase
          .from("Task")
          .select("id, title, priority")
          .eq("reference", taskReference)
          .maybeSingle();

        if (!task) return { error: `Task "${taskReference}" nao encontrada.` };

        const { error } = await supabase
          .from("Task")
          .update({ priority, updatedAt: new Date().toISOString() })
          .eq("id", task.id);

        if (error) return { error: `Erro ao atualizar prioridade: ${error.message}` };

        return {
          updated: true,
          task: { reference: taskReference, title: task.title },
          from: task.priority,
          to: priority,
        };
      },
    });

    tools.update_task_estimate = tool({
      description:
        "Atualiza scope e complexity de uma task, recalculando os Function Points automaticamente.",
      inputSchema: z.object({
        taskReference: z.string().describe("Referencia da task (ex: TSK-042)"),
        scope: z.enum(SCOPES).describe("Novo scope (micro, small, medium, large)"),
        complexity: z.enum(COMPLEXITIES).describe("Nova complexity (trivial, low, medium, high)"),
      }),
      execute: async ({ taskReference, scope, complexity }) => {
        const { data: task } = await supabase
          .from("Task")
          .select("id, title, scope, complexity, functionPoints")
          .eq("reference", taskReference)
          .maybeSingle();

        if (!task) return { error: `Task "${taskReference}" nao encontrada.` };

        const matrix = await loadFpMatrix(ALPHA_AGENT_ID);
        const newFP = suggestFunctionPoints(scope, complexity, matrix);

        const { error } = await supabase
          .from("Task")
          .update({ scope, complexity, functionPoints: newFP, updatedAt: new Date().toISOString() })
          .eq("id", task.id);

        if (error) return { error: `Erro ao atualizar estimativa: ${error.message}` };

        return {
          updated: true,
          task: { reference: taskReference, title: task.title },
          from: { scope: task.scope, complexity: task.complexity, fp: task.functionPoints },
          to: { scope, complexity, fp: newFP },
        };
      },
    });

    tools.set_project_allocation = tool({
      description:
        "Define o teto padrão de FP por sprint que um membro dedica a um projeto (ProjectMember.fpAllocation). Cria o ProjectMember se não existir.",
      inputSchema: z.object({
        projectName: z.string().describe("Nome parcial do projeto"),
        memberName: z.string().describe("Nome parcial do membro"),
        fpAllocation: z.number().int().min(0).max(500).describe("FP por sprint dedicados a esse projeto"),
      }),
      execute: async ({ projectName, memberName, fpAllocation }) => {
        const { data: project } = await supabase
          .from("Project")
          .select("id, name")
          .ilike("name", `%${projectName}%`)
          .limit(1)
          .maybeSingle();
        if (!project) return { error: `Projeto "${projectName}" não encontrado.` };

        const { data: member } = await supabase
          .from("Member")
          .select("id, name, fpCapacity")
          .ilike("name", `%${memberName}%`)
          .limit(1)
          .maybeSingle();
        if (!member) return { error: `Membro "${memberName}" não encontrado.` };

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

        // Check bateria for overcommit after change
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
          project: project.name,
          member: member.name,
          fpAllocation,
          ...(overcommit && {
            warning: `${member.name} ficou em overcommit (${commit?.committed}/${commit?.capacity} FP).`,
          }),
        };
      },
    });

    tools.set_sprint_allocation = tool({
      description:
        "Sobrescreve a alocação de FP de um membro para um sprint específico (SprintMember). Use para férias, crunch, redistribuição pontual. Se omitir, cai na ProjectMember.fpAllocation padrão.",
      inputSchema: z.object({
        sprintName: z.string().describe("Nome parcial do sprint"),
        memberName: z.string().describe("Nome parcial do membro"),
        fpAllocation: z.number().int().min(0).max(500).describe("FP nesse sprint (override)"),
      }),
      execute: async ({ sprintName, memberName, fpAllocation }) => {
        const { data: sprint } = await supabase
          .from("Sprint")
          .select("id, name, projectId")
          .ilike("name", `%${sprintName}%`)
          .limit(1)
          .maybeSingle();
        if (!sprint) return { error: `Sprint "${sprintName}" não encontrado.` };

        const { data: member } = await supabase
          .from("Member")
          .select("id, name")
          .ilike("name", `%${memberName}%`)
          .limit(1)
          .maybeSingle();
        if (!member) return { error: `Membro "${memberName}" não encontrado.` };

        // Validate member is in the project
        const { data: pm } = await supabase
          .from("ProjectMember")
          .select("id")
          .eq("projectId", sprint.projectId)
          .eq("memberId", member.id)
          .maybeSingle();
        if (!pm) {
          return { error: `${member.name} não está alocado ao projeto desse sprint — use set_project_allocation primeiro.` };
        }

        const { error } = await supabase.from("SprintMember").upsert(
          {
            sprintId: sprint.id,
            memberId: member.id,
            fpAllocation,
            updatedAt: new Date().toISOString(),
          },
          { onConflict: "sprintId,memberId" },
        );
        if (error) return { error: error.message };

        return {
          updated: true,
          sprint: sprint.name,
          member: member.name,
          fpAllocation,
          note: "Override ativo só para este sprint — outros sprints continuam com ProjectMember.fpAllocation.",
        };
      },
    });

    tools.clear_sprint_allocation = tool({
      description:
        "Remove o override de SprintMember, voltando o membro à alocação padrão do ProjectMember naquele sprint.",
      inputSchema: z.object({
        sprintName: z.string().describe("Nome parcial do sprint"),
        memberName: z.string().describe("Nome parcial do membro"),
      }),
      execute: async ({ sprintName, memberName }) => {
        const { data: sprint } = await supabase
          .from("Sprint")
          .select("id, name")
          .ilike("name", `%${sprintName}%`)
          .limit(1)
          .maybeSingle();
        if (!sprint) return { error: `Sprint "${sprintName}" não encontrado.` };

        const { data: member } = await supabase
          .from("Member")
          .select("id, name")
          .ilike("name", `%${memberName}%`)
          .limit(1)
          .maybeSingle();
        if (!member) return { error: `Membro "${memberName}" não encontrado.` };

        const { error } = await supabase
          .from("SprintMember")
          .delete()
          .eq("sprintId", sprint.id)
          .eq("memberId", member.id);
        if (error) return { error: error.message };

        return {
          cleared: true,
          sprint: sprint.name,
          member: member.name,
        };
      },
    });

    tools.move_task_to_sprint = tool({
      description:
        "Move uma task existente para um sprint (por nome parcial). Funciona para tasks no backlog ou já em outro sprint. Use ao replanejar.",
      inputSchema: z.object({
        taskReference: z.string().describe("Referência da task (ex: TSK-042)"),
        sprintName: z.string().describe("Nome parcial do sprint alvo (case-insensitive)"),
      }),
      execute: async ({ taskReference, sprintName }) => {
        const { data: task } = await supabase
          .from("Task")
          .select("id, title, sprintId, projectId")
          .eq("reference", taskReference)
          .maybeSingle();

        if (!task) return { error: `Task "${taskReference}" não encontrada.` };

        const { data: sprint } = await supabase
          .from("Sprint")
          .select("id, name, projectId")
          .ilike("name", `%${sprintName}%`)
          .eq("projectId", task.projectId)
          .limit(1)
          .maybeSingle();

        if (!sprint) {
          return { error: `Sprint "${sprintName}" não encontrado no mesmo projeto da task.` };
        }

        const { error } = await supabase
          .from("Task")
          .update({ sprintId: sprint.id, updatedAt: new Date().toISOString() })
          .eq("id", task.id);

        if (error) return { error: `Erro ao mover task: ${error.message}` };

        return {
          moved: true,
          task: { reference: taskReference, title: task.title },
          fromSprintId: task.sprintId,
          toSprint: { id: sprint.id, name: sprint.name },
        };
      },
    });

    tools.remove_task_from_sprint = tool({
      description:
        "Remove uma task do sprint atual (seta sprintId como null). A task volta ao backlog geral do projeto.",
      inputSchema: z.object({
        taskReference: z.string().describe("Referencia da task (ex: TSK-042)"),
      }),
      execute: async ({ taskReference }) => {
        const { data: task } = await supabase
          .from("Task")
          .select("id, title, sprintId")
          .eq("reference", taskReference)
          .maybeSingle();

        if (!task) return { error: `Task "${taskReference}" nao encontrada.` };
        if (!task.sprintId) return { error: `Task "${taskReference}" ja nao esta em nenhum sprint.` };

        const { error } = await supabase
          .from("Task")
          .update({ sprintId: null, status: "backlog", updatedAt: new Date().toISOString() })
          .eq("id", task.id);

        if (error) return { error: `Erro ao remover do sprint: ${error.message}` };

        return {
          removed: true,
          task: { reference: taskReference, title: task.title },
        };
      },
    });

    tools.update_task_status = tool({
      description:
        "Atualiza o status de uma task. Transicoes validas: backlog → todo → in_progress → review → done.",
      inputSchema: z.object({
        taskReference: z.string().describe("Referencia da task (ex: TSK-042)"),
        newStatus: z.enum(TASK_STATUSES).describe("Novo status"),
      }),
      execute: async ({ taskReference, newStatus }) => {
        const { data: task } = await supabase
          .from("Task")
          .select("id, title, status")
          .eq("reference", taskReference)
          .maybeSingle();

        if (!task) return { error: `Task "${taskReference}" nao encontrada.` };

        const { error } = await supabase
          .from("Task")
          .update({ status: newStatus, updatedAt: new Date().toISOString() })
          .eq("id", task.id);

        if (error) return { error: `Erro ao atualizar status: ${error.message}` };

        return {
          updated: true,
          task: { reference: taskReference, title: task.title },
          from: task.status,
          to: newStatus,
        };
      },
    });
  }

  // ─── Meeting / Roam tools ────────────────────────────────

  tools.get_recent_meetings = tool({
    description:
      "Lista reuniões candidatas — combina dados internos (Meeting, type=pm_review|general) e transcrições do Roam. Use SEMPRE como primeira fase pra apresentar candidatas ao usuário; só busque transcrição completa depois que o usuário confirmar QUAL reunião quer.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(90).default(14).describe("Janela em dias contados pra trás a partir de hoje (ignorado se 'date' for passado)"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Filtra por uma data específica YYYY-MM-DD (sobrepõe 'days')"),
      participant: z.string().optional().describe("Filtra Roam por nome parcial de participante (case-insensitive)"),
    }),
    execute: async ({ days, date, participant }) => {
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

      // Roam transcripts (paginated DESC; stops when items fall below `since`)
      let roamTranscripts: Array<{
        id: string;
        date: string;
        title: string;
        participants: string[];
      }> = [];
      let roamError: string | null = null;
      if (roamToken) {
        try {
          const roam = new RoamClient(roamToken);
          const transcripts = await roam.listTranscriptsInRange({
            since: since.toISOString(),
            until: until ? until.toISOString() : undefined,
            max: 50,
          });
          roamTranscripts = transcripts.map((t) => ({
            id: t.id,
            date: t.start,
            title: t.eventName || "Sem título",
            participants: t.participants.map((p) => p.name),
          }));
          if (participant) {
            const needle = participant.toLowerCase();
            roamTranscripts = roamTranscripts.filter((t) =>
              t.participants.some((p) => p.toLowerCase().includes(needle))
            );
          }
        } catch (err) {
          roamError = (err as Error).message;
        }
      }

      return {
        filter: {
          date: date ?? null,
          days: date ? null : days,
          participant: participant ?? null,
        },
        internalMeetings: enriched,
        roamTranscripts,
        totalInternal: enriched.length,
        totalRoam: roamTranscripts.length,
        ...(roamError ? { roamError } : {}),
        ...(roamToken ? {} : { roamNotConnected: true }),
      };
    },
  });

  tools.get_meeting_transcript = tool({
    description:
      "Busca a transcricao completa de uma reuniao do Roam. Retorna o texto formatado com timestamps e speakers, alem do resumo e acoes extraidas pelo Roam. Use para analisar o que foi discutido.",
    inputSchema: z.object({
      transcriptId: z.string().describe("ID da transcricao do Roam"),
    }),
    execute: async ({ transcriptId }) => {
      if (!roamToken) return { error: NO_ROAM_TOKEN };
      try {
        const roam = new RoamClient(roamToken);
        const transcript = await roam.getTranscript(transcriptId);

        const text = cuesToText(transcript.cues);
        const durationMin = Math.round(
          (new Date(transcript.end).getTime() - new Date(transcript.start).getTime()) / 60000
        );

        return {
          id: transcript.id,
          title: transcript.eventName || "Sem titulo",
          date: transcript.start,
          durationMinutes: durationMin,
          participants: transcript.participants.map((p) => ({
            name: p.name,
            type: p.type,
          })),
          summary: transcript.summary,
          actionItems: transcript.actionItems,
          transcript: text,
        };
      } catch (err) {
        return { error: `Erro ao buscar transcricao: ${(err as Error).message}` };
      }
    },
  });

  tools.ask_meeting = tool({
    description:
      "Faz uma pergunta sobre uma reuniao especifica ao Roam AI. Use para extrair informacoes pontuais sem ler a transcricao inteira (ex: 'o que o Joao disse sobre o projeto X?', 'quais decisoes foram tomadas?').",
    inputSchema: z.object({
      transcriptId: z.string().describe("ID da transcricao do Roam"),
      question: z.string().describe("Pergunta sobre a reuniao"),
    }),
    execute: async ({ transcriptId, question }) => {
      if (!roamToken) return { error: NO_ROAM_TOKEN };
      try {
        const roam = new RoamClient(roamToken);
        const { answer } = await roam.promptTranscript(transcriptId, question);
        return { answer };
      } catch (err) {
        return { error: `Erro ao perguntar ao Roam: ${(err as Error).message}` };
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

    tools.propose_task_action = tool({
      description:
        "Propõe uma mudança em Task no contexto de uma reunião — NÃO executa, só registra como proposta pendente em MeetingTaskAction. O PM aprova/edita/rejeita pela UI da reunião e o sistema aplica em batch. Use SEMPRE em vez de create_task/update_task_*/move_task_to_sprint quando houver reunião ativa do tipo daily, super_planning ou pm_review.",
      inputSchema: z.object({
        meetingId: z.string().uuid().optional().describe("UUID da reunião (opcional — default: reunião do contexto)"),
        type: z.enum(["create", "update", "delete", "move", "review"]).describe(
          "create=task nova; update=editar campos; delete=tirar do sprint; move=mudar de sprint; review=marcar pra discutir"
        ),
        projectName: z.string().optional().describe("Nome parcial do projeto (obrigatório pra type=create; pra outros tipos vem da task)"),
        taskReference: z.string().optional().describe("Referência da task (ex: TASK-042) — obrigatória pra update/delete/move/review"),
        targetSprintName: z.string().optional().describe("Nome parcial do sprint destino (obrigatório pra type=move)"),
        payload: z.record(z.string(), z.unknown()).optional().describe(
          "Campos da ação. Pra create: { title, description?, scope, complexity, type, priority?, status?, assigneeNames? }. Pra update: campos a mudar. Pra review: ignorado (use reviewReasons/reviewNote)."
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

        // Resolver targetSprintId pra move
        let resolvedTargetSprintId: string | null = null;
        if (type === "move" && targetSprintName) {
          const { data: sprint } = await supabase
            .from("Sprint")
            .select("id, name, projectId")
            .ilike("name", `%${targetSprintName}%`)
            .eq("projectId", resolvedProjectId)
            .limit(1)
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
        isOverdue: a.dueDate ? new Date(a.dueDate) < new Date() : false,
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
