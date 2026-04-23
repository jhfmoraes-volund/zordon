import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { suggestFunctionPoints, ACTIVE_STATUSES } from "@/lib/function-points";
import { TASK_STATUSES, TASK_TYPES, SCOPES, COMPLEXITIES } from "@/lib/task-constants";
import { RoamClient, cuesToText } from "@/lib/roam";
import { loadAgentHeuristic, loadFpMatrix } from "../../config";
import { ZORDON_AGENT_ID } from "./context";
import type { Capabilities } from "../../types";

/**
 * Assembles Zordon's native tools.
 * Composio tools are merged separately by the agent definition.
 */
export function assembleZordonTools(capabilities: Capabilities): ToolSet {
  const supabase = db();
  const tools: ToolSet = {};
  const roamToken = capabilities.roamToken;
  const NO_ROAM_TOKEN =
    "Roam nao conectado. Peca ao PM para conectar em Configuracoes > Integracoes.";

  // ─── Read tools ──────────────────────────────────────────

  tools.get_sprint_overview = tool({
    description:
      "Retorna o estado completo do sprint ativo: tasks, membros com capacidade, e alertas. Use para ter uma visao atualizada da operacao.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data: sprint } = await supabase
        .from("Sprint")
        .select("id, name, startDate, endDate, status, project:Project(name)")
        .neq("status", "done")
        .order("startDate", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!sprint) return { error: "Nenhum sprint ativo encontrado." };

      const { data: tasks } = await supabase
        .from("Task")
        .select("reference, title, status, type, functionPoints, dueDate, assignments:TaskAssignment(member:Member(id, name))")
        .eq("sprintId", sprint.id)
        .order("priority", { ascending: false });

      const { data: members } = await supabase
        .from("member_capacity_overview")
        .select("*");

      return { sprint, tasks: tasks || [], members: members || [] };
    },
  });

  tools.get_member_allocation = tool({
    description:
      "Retorna a alocacao de FP de cada membro: capacidade total, alocado, restante. Use para saber quem esta disponivel.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data } = await supabase
        .from("member_capacity_overview")
        .select("*");
      return {
        members: (data || []).map((m) => ({
          name: m.name,
          role: m.role,
          fpCapacity: m.fp_capacity,
          fpAllocated: m.fp_allocated,
          fpRemaining: (Number(m.fp_capacity) || 0) - (Number(m.fp_allocated) || 0),
          activeTaskCount: m.active_task_count,
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
      "Retorna alertas operacionais: membros sobrecarregados, tasks sem atribuicao, prazos vencidos, sprint acima da capacidade.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data: members } = await supabase
        .from("member_capacity_overview")
        .select("*");

      const { data: sprint } = await supabase
        .from("Sprint")
        .select("id")
        .neq("status", "done")
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
          .eq("sprintId", sprint.id);

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
      "Lista todos os sprints não-concluídos (planning, active) do projeto. Use ao replanejar, redistribuir tasks ou quando precisar ver o pipeline.",
    inputSchema: z.object({
      projectName: z.string().optional().describe("Filtrar por nome parcial do projeto (case-insensitive)"),
    }),
    execute: async ({ projectName }) => {
      const query = supabase
        .from("Sprint")
        .select("id, name, status, startDate, endDate, project:Project(id, name)")
        .neq("status", "done")
        .order("startDate", { ascending: true });

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
            .eq("sprintId", s.id);
          const { data: fpRows } = await supabase
            .from("Task")
            .select("functionPoints")
            .eq("sprintId", s.id);
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
      "Lista tasks no backlog (sem sprint atribuído). Use ao replanejar — quais tasks podem entrar em sprints.",
    inputSchema: z.object({
      projectName: z.string().optional().describe("Filtrar por nome parcial do projeto"),
      limit: z.number().int().min(1).max(200).default(100).describe("Máximo de tasks (default 100)"),
    }),
    execute: async ({ projectName, limit }) => {
      const query = supabase
        .from("Task")
        .select("reference, title, type, scope, complexity, functionPoints, priority, dueDate, project:Project(id, name)")
        .is("sprintId", null)
        .order("priority", { ascending: false })
        .order("createdAt", { ascending: false })
        .limit(limit);

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
      const heuristic = await loadAgentHeuristic(ZORDON_AGENT_ID, name);
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
        name: z.string().min(1).describe("Nome do sprint (ex: Sprint 4 — Consolidação)"),
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
        const matrix = await loadFpMatrix(ZORDON_AGENT_ID);
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

        const matrix = await loadFpMatrix(ZORDON_AGENT_ID);
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
      "Lista reunioes recentes — combina dados internos (WeeklyMeeting com reviews e acoes) e transcricoes do Roam. Use para contexto de reunioes passadas, acoes pendentes, ou preparar pauta.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(90).default(14).describe("Quantos dias para tras buscar (padrao: 14)"),
    }),
    execute: async ({ days }) => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceISO = since.toISOString().split("T")[0];

      // Internal meetings
      const { data: meetings } = await supabase
        .from("WeeklyMeeting")
        .select("id, date, status, notes")
        .gte("date", sinceISO)
        .order("date", { ascending: false });

      const meetingList = meetings || [];

      // Load reviews and actions for each meeting
      const enriched = await Promise.all(
        meetingList.map(async (m) => {
          const [{ data: reviews }, { data: actions }] = await Promise.all([
            supabase
              .from("MeetingProjectReview")
              .select("projectId, sprintHealth, attentionPoints, nextSteps, additionalNotes, member:Member(name), project:Project(name)")
              .eq("meetingId", m.id),
            supabase
              .from("MeetingActionItem")
              .select("description, status, dueDate, resolvedAt, assignee:Member(name)")
              .eq("meetingId", m.id),
          ]);
          return { ...m, reviews: reviews || [], actions: actions || [] };
        })
      );

      // Roam transcripts (if the PM has connected their account)
      let roamTranscripts: Array<{ id: string; date: string; title: string; participants: string[]; hasSummary: boolean }> = [];
      if (roamToken) {
        try {
          const roam = new RoamClient(roamToken);
          const { transcripts } = await roam.listTranscripts({ after: sinceISO, limit: 20 });
          roamTranscripts = transcripts.map((t) => ({
            id: t.id,
            date: t.start,
            title: t.eventName || "Sem titulo",
            participants: t.participants.map((p) => p.name),
            hasSummary: true,
          }));
        } catch {
          // Token call failed — continue without Roam data
        }
      }

      return {
        internalMeetings: enriched,
        roamTranscripts,
        totalInternal: enriched.length,
        totalRoam: roamTranscripts.length,
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

  tools.get_pending_actions = tool({
    description:
      "Lista acoes de reunioes que ainda nao foram resolvidas. Cruza MeetingActionItem com status pendente. Use para cobrar acoes ou preparar pauta da proxima reuniao.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data: actions } = await supabase
        .from("MeetingActionItem")
        .select("description, status, dueDate, assignee:Member(name), meeting:WeeklyMeeting(date)")
        .neq("status", "resolved")
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
