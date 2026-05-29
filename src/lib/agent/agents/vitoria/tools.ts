import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { addContextNote } from "@/lib/dal/planning";
import { getStepData } from "@/lib/agent/context";
import { applyMarkdownMutation } from "@/lib/agent/tools/_markdown";
import type { Database, Json } from "@/lib/supabase/database.types";

type MeetingTaskActionUpdate = Database["public"]["Tables"]["MeetingTaskAction"]["Update"];

/**
 * Valida payload de propose_task_action quando type='create'.
 * Retornado como issues estruturadas pra superRefine — modelo vê path+message
 * por campo, sabe exatamente o que faltou. Não é parse Zod separado porque
 * o payload chega como Record<string,unknown> (jsonb) e queremos type-narrow
 * via shape, não substituir o campo.
 */
function validateCreatePayload(
  payload: Record<string, unknown>,
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const title = payload.title;
  if (typeof title !== "string" || title.trim().length < 3) {
    issues.push({ path: ["title"], message: "title obrigatório (string ≥3 chars)" });
  }
  const description = payload.description;
  if (typeof description !== "string" || description.trim().length < 60) {
    issues.push({
      path: ["description"],
      message:
        "description obrigatório com ≥60 chars. Use SDD: '## Problema\\n…\\n## Solução\\n…\\n## Invariantes\\n…'",
    });
  }
  const fp = payload.functionPoints;
  if (typeof fp !== "number" || !Number.isInteger(fp) || fp < 1 || fp > 13) {
    issues.push({
      path: ["functionPoints"],
      message: "functionPoints obrigatório: inteiro 1-13 (estimativa de tamanho)",
    });
  }
  const ac = payload.acceptanceCriteria;
  if (!Array.isArray(ac) || ac.length < 3) {
    issues.push({
      path: ["acceptanceCriteria"],
      message: "acceptanceCriteria obrigatório: array de ≥3 strings observáveis pelo PM",
    });
  } else {
    ac.forEach((item, idx) => {
      if (typeof item !== "string" || item.trim().length < 10) {
        issues.push({
          path: ["acceptanceCriteria", idx],
          message: "cada AC deve ser string ≥10 chars (verificável pelo PM)",
        });
      }
    });
  }
  return issues;
}

export function buildVitoriaTools(planningId: string, projectId: string) {
  return {
    add_context_note: tool({
      description:
        "Adiciona uma nota de contexto ao briefing da planning. Use para registrar temas, riscos, sinais de capacidade, observações de código ou questões extraídas das transcrições.",
      inputSchema: z.object({
        kind: z
          .enum([
            "summary",
            "theme",
            "risk",
            "capacity_signal",
            "code_observation",
            "open_question",
            "scope_creep",
          ])
          .describe("Tipo da nota"),
        content: z
          .string()
          .min(10)
          .describe("Conteúdo da nota. Seja específico e conciso."),
        sourceMeetingIds: z
          .array(z.string())
          .optional()
          .describe("IDs de reuniões que embasam esta nota"),
        sourceTranscriptIds: z
          .array(z.string())
          .optional()
          .describe("IDs de TranscriptRef que embasam esta nota"),
        priority: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe("Prioridade 0-10. Default 5."),
      }),
      execute: async ({ kind, content, sourceMeetingIds, sourceTranscriptIds, priority }) => {
        const note = await addContextNote({
          planningCeremonyId: planningId,
          kind,
          content,
          sourceMeetingIds: sourceMeetingIds ?? [],
          sourceTranscriptIds: sourceTranscriptIds ?? [],
          priority: priority ?? 5,
          generatedByAgent: "vitoria",
        });
        return { ok: true, noteId: note.id, kind: note.kind };
      },
    }),

    propose_task_action: tool({
      description:
        "Cria uma proposta de ação no backlog (MeetingTaskAction) para aprovação do PM. Use para propor criar, atualizar, mover ou excluir tasks com base no contexto. " +
        "Payload é JSON OBJECT (nunca string stringificada — schema rejeita se você passar `\"{...}\"` em vez de `{...}`) e tipado por `type`: create sem functionPoints/acceptanceCriteria/description SDD é rejeitado.",
      inputSchema: z
        .object({
          projectId: z.string().describe("ID do projeto"),
          type: z
            .enum(["create", "update", "delete", "move"])
            .describe("Tipo de ação"),
          taskId: z
            .string()
            .optional()
            .describe("ID da task alvo. OBRIGATÓRIO em update/delete/move; omita em create"),
          targetSprintId: z
            .string()
            .optional()
            .describe("Sprint destino. OBRIGATÓRIO em move (resolva via list_project_sprints antes)"),
          payload: z
            .record(z.string(), z.unknown())
            .describe(
              "Dados da ação. SHAPE POR TYPE:\n" +
                "• create: { title, description, functionPoints (1-13), acceptanceCriteria (array ≥3), type?, scope?, priority? }\n" +
                "• update: campos a alterar (qualquer subset dos de create)\n" +
                "• move: { } (vazio — use targetSprintId top-level)\n" +
                "• delete: { } (vazio)\n" +
                "description deve usar template SDD: H2 ## Problema, H2 ## Solução, H2 ## Invariantes (cite path do código quando relevante).",
            ),
          aiReasoning: z
            .string()
            .min(40)
            .describe(
              "Explicação de POR QUÊ esta ação é proposta. PM lê pra decidir. " +
                "DEVE citar a(s) nota(s) que originaram a proposta — referencie pelo conteúdo curto.",
            ),
          aiConfidence: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe("Confiança 0-1. Default 0.8."),
          sourceNoteIds: z
            .array(z.string().uuid())
            .min(1, "Cite ≥1 PlanningContextNote.id que embasa esta proposta")
            .describe(
              "IDs de PlanningContextNote.id que embasam a proposta. " +
                "OBRIGATÓRIO ≥1. IDs aparecem em 'Notas de contexto' do system prompt; nunca invente.",
            ),
        })
        .superRefine((data, ctx) => {
          if (data.type === "create") {
            const issues = validateCreatePayload(data.payload);
            for (const i of issues) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["payload", ...i.path],
                message: i.message,
              });
            }
          }
          if (data.type === "move") {
            if (!data.targetSprintId)
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["targetSprintId"],
                message: "type=move exige targetSprintId (chame list_project_sprints antes)",
              });
            if (!data.taskId)
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["taskId"],
                message: "type=move exige taskId da task a mover",
              });
          }
          if ((data.type === "update" || data.type === "delete") && !data.taskId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["taskId"],
              message: `type=${data.type} exige taskId`,
            });
          }
        }),
      execute: async ({
        projectId,
        type,
        taskId,
        targetSprintId,
        payload,
        aiReasoning,
        aiConfidence,
        sourceNoteIds,
      }) => {
        const { data, error } = await db()
          .from("MeetingTaskAction")
          .insert({
            planningCeremonyId: planningId,
            projectId,
            type,
            taskId: taskId ?? null,
            targetSprintId: targetSprintId ?? null,
            payload: payload as Json,
            aiReasoning,
            aiConfidence: aiConfidence ?? 0.8,
            sourceNoteIds: (sourceNoteIds ?? []) as unknown as string[],
            decision: "pending",
            execution: "pending",
            source: "ai",
            notes: null,
          })
          .select("id, type, decision")
          .single();

        if (error) throw new Error(`Falha ao criar proposta: ${error.message}`);
        return { ok: true, actionId: data.id, type: data.type };
      },
    }),

    update_proposed_action: tool({
      description:
        "Edita uma proposta pendente (MeetingTaskAction) desta planning. Use quando o PM pedir pra ajustar payload, raciocínio, sprint destino ou confiança. Só funciona em decision=pending e execution=pending. " +
        "payload é JSON OBJECT (nunca string), e usa MERGE shallow no top-level: passe APENAS os campos que mudam — campos não passados ficam preservados. Ex: pra mudar só priority, mande payload={priority: 0}.",
      inputSchema: z.object({
        actionId: z.string().uuid().describe("UUID da MeetingTaskAction a editar (do contexto Propostas pendentes)"),
        payload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Patch shallow do payload — só os campos que MUDAM. Campos omitidos preservam valor atual. Ex: {priority: 0} muda só priority; {description: '...', functionPoints: 8} muda 2 campos. NUNCA stringify — é objeto JSON.",
          ),
        targetSprintId: z
          .string()
          .nullable()
          .optional()
          .describe("Nova sprint destino (use null pra limpar)"),
        aiReasoning: z
          .string()
          .optional()
          .describe("Novo raciocínio"),
        aiConfidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Nova confiança 0-1"),
      }),
      execute: async ({ actionId, payload, targetSprintId, aiReasoning, aiConfidence }) => {
        const { data: row } = await db()
          .from("MeetingTaskAction")
          .select("id, decision, execution, planningCeremonyId, payload")
          .eq("id", actionId)
          .eq("planningCeremonyId", planningId)
          .single();

        if (!row) return { ok: false, error: "proposta não encontrada nesta planning" };
        if (row.decision !== "pending" || row.execution !== "pending") {
          return {
            ok: false,
            error: `proposta já ${row.decision}/${row.execution} — não dá pra editar`,
          };
        }

        const patch: MeetingTaskActionUpdate = {};
        if (payload !== undefined) {
          // Shallow merge: preserva campos não mencionados no patch.
          // Modelo costuma mandar só os campos que mudam — replace destruiria
          // title/description/AC do payload original.
          const current = (row.payload ?? {}) as Record<string, unknown>;
          patch.payload = { ...current, ...payload } as Json;
        }
        if (targetSprintId !== undefined) patch.targetSprintId = targetSprintId;
        if (aiReasoning !== undefined) patch.aiReasoning = aiReasoning;
        if (aiConfidence !== undefined) patch.aiConfidence = aiConfidence;

        if (Object.keys(patch).length === 0) {
          return { ok: false, error: "nenhum campo passado pra editar" };
        }

        const { error } = await db()
          .from("MeetingTaskAction")
          .update(patch)
          .eq("id", actionId);
        if (error) return { ok: false, error: error.message };
        return {
          ok: true,
          actionId,
          fieldsUpdated: Object.keys(patch),
          payloadKeysMerged: payload ? Object.keys(payload) : [],
        };
      },
    }),

    delete_proposed_action: tool({
      description:
        "Descarta uma proposta de MeetingTaskAction (decision=pending, execution=pending) desta planning. Use quando o PM discordar via chat ('não, essa não') ou você quiser refazer. Não funciona em propostas já decididas/aplicadas.",
      inputSchema: z.object({
        actionId: z.string().describe("ID da MeetingTaskAction a descartar"),
      }),
      execute: async ({ actionId }) => {
        const { data: row } = await db()
          .from("MeetingTaskAction")
          .select("id, decision, execution, planningCeremonyId, source, payload")
          .eq("id", actionId)
          .eq("planningCeremonyId", planningId)
          .single();

        if (!row) return { ok: false, error: "proposta não encontrada nesta planning" };
        if (row.decision !== "pending" || row.execution !== "pending") {
          return {
            ok: false,
            error: `proposta já ${row.decision}/${row.execution} — não dá pra descartar`,
          };
        }

        // Registra outcome ANTES do delete (FK cascade limparia a row).
        // Só pra propostas da IA — outcome humano não interessa pra métrica.
        if (row.source === "ai") {
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          const fpEstimated =
            typeof payload.functionPoints === "number" ? payload.functionPoints : null;
          await db()
            .from("AgentProposalOutcome")
            .insert({
              proposalId: actionId,
              agentName: "vitoria",
              callKind: "turn",
              decision: "deleted",
              fpEstimated,
            });
        }

        const { error } = await db()
          .from("MeetingTaskAction")
          .delete()
          .eq("id", actionId);
        if (error) return { ok: false, error: error.message };
        return { ok: true, actionId };
      },
    }),

    read_transcript_content: tool({
      description:
        "Lê o conteúdo de um transcript linkado. Use para extrair insights detalhados antes de criar notas.",
      inputSchema: z.object({
        transcriptRefId: z.string().describe("ID do TranscriptRef"),
      }),
      execute: async ({ transcriptRefId }) => {
        const { data: ref } = await db()
          .from("TranscriptRef")
          .select("id, title, source, sourceId, capturedAt, meetingId, fullText")
          .eq("id", transcriptRefId)
          .single();

        if (!ref) return { ok: false, error: "TranscriptRef não encontrado" };

        if (ref.fullText) {
          return {
            ok: true,
            id: ref.id,
            title: ref.title,
            capturedAt: ref.capturedAt,
            content: ref.fullText,
          };
        }

        if (ref.meetingId) {
          // Sem fullText no TranscriptRef → cai pra notas do Meeting.
          // (Meeting.transcript foi droppado; fullText vive só em TranscriptRef.)
          const { data: meeting } = await db()
            .from("Meeting")
            .select("id, title, date, notes")
            .eq("id", ref.meetingId)
            .single();
          if (meeting) {
            return {
              ok: true,
              id: ref.id,
              title: ref.title ?? meeting.title,
              capturedAt: ref.capturedAt,
              content: meeting.notes ?? "(sem conteúdo)",
            };
          }
        }

        return {
          ok: true,
          id: ref.id,
          title: ref.title,
          capturedAt: ref.capturedAt,
          content: "(conteúdo não disponível — só metadados)",
        };
      },
    }),

    list_project_sprints: tool({
      description:
        "Lista as próximas 3 sprints do projeto (endDate >= hoje), ordenadas por startDate. Use SEMPRE antes de propor 'move' pra pegar o targetSprintId real.",
      inputSchema: z.object({}),
      execute: async () => {
        const todayISO = new Date().toISOString().slice(0, 10);
        const { data, error } = await db()
          .from("Sprint")
          .select("id, name, startDate, endDate, status, goal")
          .eq("projectId", projectId)
          .gte("endDate", todayISO)
          .order("startDate", { ascending: true })
          .limit(3);
        if (error) return { ok: false, error: error.message };
        return { ok: true, sprints: data ?? [] };
      },
    }),

    list_project_tasks: tool({
      description:
        "Lista tasks do projeto inteiro com filtros (busca paginada). Use pra encontrar duplicatas fora da sprint atual antes de propor 'create'. NÃO traz description/AC; pra detalhe use get_task_detail.",
      inputSchema: z.object({
        status: z
          .array(z.string())
          .optional()
          .describe("Filtra por status (ex ['todo','in_progress','done'])"),
        userStoryId: z.string().optional().describe("Filtra por user story"),
        sprintId: z.string().optional().describe("Filtra por sprint"),
        searchTitle: z
          .string()
          .optional()
          .describe("Busca substring case-insensitive no título"),
        limit: z.number().int().min(1).max(100).optional().describe("Default 50, máx 100"),
        offset: z.number().int().min(0).optional().describe("Offset pra paginar"),
      }),
      execute: async ({ status, userStoryId, sprintId, searchTitle, limit, offset }) => {
        let q = db()
          .from("Task")
          .select(
            "id, reference, title, status, scope, complexity, functionPoints, priority, type, sprintId, userStoryId",
            { count: "exact" },
          )
          .eq("projectId", projectId)
          .is("dismissedAt", null);
        if (status && status.length > 0) q = q.in("status", status);
        if (userStoryId) q = q.eq("userStoryId", userStoryId);
        if (sprintId) q = q.eq("sprintId", sprintId);
        if (searchTitle) q = q.ilike("title", `%${searchTitle}%`);

        const lim = limit ?? 50;
        const off = offset ?? 0;
        const { data, error, count } = await q
          .order("priority", { ascending: false })
          .range(off, off + lim - 1);
        if (error) return { ok: false, error: error.message };
        return {
          ok: true,
          tasks: data ?? [],
          total: count ?? 0,
          limit: lim,
          offset: off,
        };
      },
    }),

    get_sprint_capacity: tool({
      description:
        "Mostra FP planejado vs capacity dos members do squad numa sprint. Use pra avaliar risco de sobrecarga antes de propor novas tasks.",
      inputSchema: z.object({
        sprintId: z.string().describe("ID da sprint"),
      }),
      execute: async ({ sprintId }) => {
        const supabase = db();

        // Tasks da sprint com assignees + FP
        const { data: tasks, error: tErr } = await supabase
          .from("Task")
          .select(
            "id, functionPoints, status, TaskAssignment(memberId)",
          )
          .eq("sprintId", sprintId)
          .is("dismissedAt", null);
        if (tErr) return { ok: false, error: tErr.message };

        // Members do squad do projeto
        const { data: ps } = await supabase
          .from("ProjectSquad")
          .select("squadId")
          .eq("projectId", projectId);
        const squadIds = (ps ?? []).map((r) => r.squadId);

        type SquadMemberRow = {
          memberId: string;
          member: {
            id: string;
            name: string;
            fpCapacity: number;
            dedicationPercent: number;
          } | null;
        };

        let members: SquadMemberRow[] = [];
        if (squadIds.length > 0) {
          const { data: smRows } = await supabase
            .from("SquadMember")
            .select(
              "memberId, member:Member(id, name, fpCapacity, dedicationPercent)",
            )
            .in("squadId", squadIds);
          members = (smRows ?? []) as unknown as SquadMemberRow[];
        }

        // FP planejado por member
        const fpByMember = new Map<string, number>();
        for (const t of tasks ?? []) {
          const fp = t.functionPoints ?? 0;
          const assigns = (t.TaskAssignment ?? []) as Array<{ memberId: string | null }>;
          if (assigns.length === 0) continue;
          // Divide FP igual entre assignees (heurística simples)
          const share = fp / assigns.length;
          for (const a of assigns) {
            if (!a.memberId) continue;
            fpByMember.set(a.memberId, (fpByMember.get(a.memberId) ?? 0) + share);
          }
        }

        const capacity = members
          .filter((m) => m.member)
          .map((m) => {
            const planned = Math.round((fpByMember.get(m.memberId) ?? 0) * 10) / 10;
            const cap = m.member?.fpCapacity ?? 0;
            const dedication = (m.member?.dedicationPercent ?? 100) / 100;
            const effectiveCap = Math.round(cap * dedication * 10) / 10;
            return {
              memberId: m.member?.id,
              name: m.member?.name,
              fpCapacity: cap,
              dedicationPercent: m.member?.dedicationPercent,
              effectiveCapacity: effectiveCap,
              fpPlanned: planned,
              utilization: effectiveCap > 0 ? Math.round((planned / effectiveCap) * 100) : null,
            };
          });

        return { ok: true, sprintId, capacity };
      },
    }),

    get_task_detail: tool({
      description:
        "Carrega 1 task com description + acceptance criteria + assignees + dependências. Use quando o PM citar uma task específica ou você precisar comparar antes de propor update/duplicata.",
      inputSchema: z.object({
        refOrId: z
          .string()
          .describe("Reference (ex 'VLD-105') OU id (uuid) da task"),
      }),
      execute: async ({ refOrId }) => {
        const supabase = db();
        const isUuid = /^[0-9a-f-]{36}$/i.test(refOrId);

        const baseQ = supabase
          .from("Task")
          .select(
            `id, reference, title, description, status, scope, complexity, functionPoints, priority, type, sprintId, userStoryId, doneAt,
             TaskAssignment(memberId, member:Member(id, name)),
             AcceptanceCriterion(id, text, order, checkedAt)`,
          )
          .eq("projectId", projectId)
          .is("dismissedAt", null);

        const q = isUuid ? baseQ.eq("id", refOrId) : baseQ.eq("reference", refOrId);

        const { data: task, error } = await q.maybeSingle();
        if (error) return { ok: false, error: error.message };
        if (!task) return { ok: false, error: "task não encontrada" };

        // Dependências in/out
        const { data: deps } = await supabase
          .from("TaskDependency")
          .select("taskId, dependsOn, kind")
          .or(`taskId.eq.${task.id},dependsOn.eq.${task.id}`);

        return {
          ok: true,
          task: {
            ...task,
            dependencies: deps ?? [],
          },
        };
      },
    }),

    list_active_design_sessions: tool({
      description:
        "Lista as design sessions ativas do projeto (status in 'active','in_progress'). Cada item traz id, título, type, status e memoryAbstract — use os IDs em read_design_session_memory / read_design_session_step quando precisar de detalhe.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await db()
          .from("DesignSession")
          .select("id, title, type, status, memoryAbstract, updatedAt")
          .eq("projectId", projectId)
          .in("status", ["active", "in_progress"])
          .order("updatedAt", { ascending: false });
        if (error) return { ok: false, error: error.message };
        return { ok: true, sessions: data ?? [] };
      },
    }),

    read_design_session_memory: tool({
      description:
        "Lê a memória narrativa (markdown) de uma design session específica do projeto. Use quando precisar do 'porquê' detalhado de uma decisão ativa ou de uma persona — o resumo de seções (Hipóteses, Personas, Descartado-e-por-quê) está aí. Valida que a session pertence ao mesmo projeto.",
      inputSchema: z.object({
        sessionId: z.string().describe("ID da DesignSession a ler"),
      }),
      execute: async ({ sessionId }) => {
        const { data, error } = await db()
          .from("DesignSession")
          .select("id, title, type, status, projectId, memoryMd, memoryVersion, memoryUpdatedAt")
          .eq("id", sessionId)
          .maybeSingle();
        if (error) return { ok: false, error: error.message };
        if (!data) return { ok: false, error: "design session não encontrada" };
        if (data.projectId !== projectId) {
          return { ok: false, error: "design session pertence a outro projeto" };
        }
        return {
          ok: true,
          session: {
            id: data.id,
            title: data.title,
            type: data.type,
            status: data.status,
            memoryMd: data.memoryMd ?? "",
            memoryVersion: data.memoryVersion ?? 0,
            memoryUpdatedAt: data.memoryUpdatedAt,
          },
        };
      },
    }),

    read_design_session_step: tool({
      description:
        "Lê o payload bruto de UM step de uma DS (personas_journeys, brainstorm, prioritization, briefing, etc). **Custo alto** — só chame quando a memória narrativa não basta. Steps comuns: 'personas_journeys' (personas + dores), 'brainstorm' (features brutas), 'prioritization' (MoSCoW), 'briefing' (estrutura final).",
      inputSchema: z.object({
        sessionId: z.string().describe("ID da DesignSession"),
        stepKey: z.string().describe("Chave do step (ex: 'personas_journeys', 'brainstorm', 'prioritization', 'briefing')"),
      }),
      execute: async ({ sessionId, stepKey }) => {
        const { data: ds } = await db()
          .from("DesignSession")
          .select("id, projectId")
          .eq("id", sessionId)
          .maybeSingle();
        if (!ds) return { ok: false, error: "design session não encontrada" };
        if (ds.projectId !== projectId) {
          return { ok: false, error: "design session pertence a outro projeto" };
        }
        const data = await getStepData(sessionId, stepKey);
        return { ok: true, sessionId, stepKey, data };
      },
    }),

    append_project_memory: tool({
      description:
        "Anexa contexto à memória narrativa do projeto (Project.memoryMd). Use pra registrar info cross-session que veio à tona na planning: mudança de business context, restrição econômica nova, decisão de escopo cross-sprint. Vitor lê esse mesmo markdown na próxima design session. Use optimistic lock: passe `expectedVersion` lido da seção 'Memória do projeto' no prompt — em conflito, devolve o estado atual pra você relê e tentar de novo. NÃO use pra detalhes de task individual ou status report de sprint.",
      inputSchema: z.object({
        action: z.enum(["append_section", "edit_section"]).default("append_section"),
        section: z.string().describe("Nome da seção (ex: 'Aprendizados Cruciais', 'Riscos Conhecidos', 'Visão de Produto'). Sem '## '"),
        content: z.string().min(10).describe("Conteúdo a anexar. Use bullets; cite data e fonte (ex: 'planning sprint X, 2026-05-29')."),
        expectedVersion: z.number().int().min(0).describe("Versão atual lida do prompt (Project.memoryVersion). Optimistic lock."),
      }),
      execute: async ({ action, section, content, expectedVersion }) => {
        const { data: current, error: rErr } = await db()
          .from("Project")
          .select("memoryMd, memoryVersion")
          .eq("id", projectId)
          .single();
        if (rErr) return { ok: false, error: rErr.message };
        if ((current.memoryVersion ?? 0) !== expectedVersion) {
          return {
            ok: false,
            conflict: true,
            currentVersion: current.memoryVersion ?? 0,
            currentMd: current.memoryMd ?? "",
          };
        }

        let updated: string;
        try {
          updated = applyMarkdownMutation(
            current.memoryMd ?? "",
            action,
            section,
            content,
          );
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }

        const newVersion = expectedVersion + 1;
        const { error: uErr } = await db()
          .from("Project")
          .update({
            memoryMd: updated,
            memoryVersion: newVersion,
            memoryUpdatedAt: new Date().toISOString(),
          })
          .eq("id", projectId);
        if (uErr) return { ok: false, error: uErr.message };
        return { ok: true, newVersion };
      },
    }),

    get_dependency_graph: tool({
      description:
        "Devolve o grafo de bloqueios e dependências de uma sprint (1 hop). Use quando o PM perguntar 'o que está bloqueado?' ou 'qual a ordem disso?'.",
      inputSchema: z.object({
        sprintId: z.string().describe("ID da sprint"),
      }),
      execute: async ({ sprintId }) => {
        const supabase = db();

        const { data: tasks, error: tErr } = await supabase
          .from("Task")
          .select("id, reference, title, status")
          .eq("sprintId", sprintId)
          .is("dismissedAt", null);
        if (tErr) return { ok: false, error: tErr.message };

        const taskIds = (tasks ?? []).map((t) => t.id);
        if (taskIds.length === 0) {
          return { ok: true, sprintId, tasks: [], edges: [] };
        }

        const { data: edges } = await supabase
          .from("TaskDependency")
          .select("taskId, dependsOn, kind")
          .or(`taskId.in.(${taskIds.join(",")}),dependsOn.in.(${taskIds.join(",")})`);

        return {
          ok: true,
          sprintId,
          tasks: tasks ?? [],
          edges: edges ?? [],
        };
      },
    }),
  };
}
