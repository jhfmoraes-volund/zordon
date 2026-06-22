import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { addContextNote } from "@/lib/dal/planning";
import { createCommentAs } from "@/lib/dal/task-comments";
import { getStepData } from "@/lib/agent/context";
import { applyMarkdownMutation } from "@/lib/agent/tools/_markdown";
import { createReadContextSourceTool } from "@/lib/agent/tools/read-context-source";
import { getSprintOutcomes } from "@/lib/dal/sprint-outcomes";
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
  // Backfill: trabalho JÁ entregue (status='done') não precisa da cerimônia de
  // planejamento pra frente (SDD ≥60 chars + 3 AC observáveis) — só do registro
  // fiel + estimativa em PFV. Pra criação prospectiva, a cerimônia continua dura.
  const isBackfill = payload.status === "done";
  const title = payload.title;
  if (typeof title !== "string" || title.trim().length < 3) {
    issues.push({ path: ["title"], message: "title obrigatório (string ≥3 chars)" });
  }
  const description = payload.description;
  if (!isBackfill && (typeof description !== "string" || description.trim().length < 60)) {
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
  if (!isBackfill && (!Array.isArray(ac) || ac.length < 3)) {
    issues.push({
      path: ["acceptanceCriteria"],
      message: "acceptanceCriteria obrigatório: array de ≥3 strings observáveis pelo PM",
    });
  } else if (Array.isArray(ac)) {
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

/**
 * Set de Member.id que EXISTEM, dado um conjunto de candidatos. Usado por
 * `propose_tasks` pra validar `assigneeIds` em lote (D14: o piso é integridade —
 * assignee inexistente vira FK-fail no conclude; pegar cedo devolve erro por-linha
 * pro agente se corrigir). NÃO valida "está no squad do projeto": a calibração do
 * eval mostrou que membership vive fora de ProjectSquad (contribuidor de backfill
 * pode não estar no squad atual). O agente descobre os IDs válidos via
 * list_project_members; aqui só barramos ID que não é Member nenhum.
 */
async function loadExistingMemberIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await db().from("Member").select("id").in("id", ids);
  return new Set((data ?? []).map((m) => m.id));
}

/** Set de Sprint.id do projeto — valida `targetSprintId` em lote (propose_tasks). */
async function loadProjectSprintIds(projectId: string): Promise<Set<string>> {
  const { data } = await db().from("Sprint").select("id").eq("projectId", projectId);
  return new Set((data ?? []).map((s) => s.id));
}

/**
 * Set de Task.id que EXISTEM no projeto, dado um conjunto de candidatos. Usado
 * por `propose_task_bulk_update` pra validar `taskId` em lote: project-scoped
 * (barra task de OUTRO projeto vazar pelo lote) e pega cedo o que viraria
 * fail no conclude. Espelha loadProjectSprintIds — uma query pro lote inteiro.
 */
async function loadProjectTaskIds(
  taskIds: string[],
  projectId: string,
): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();
  const { data } = await db()
    .from("Task")
    .select("id")
    .eq("projectId", projectId)
    .in("id", taskIds);
  return new Set((data ?? []).map((t) => t.id));
}

type ProjectMemberRow = {
  id: string;
  name: string;
  fpCapacity: number;
  dedicationPercent: number;
  isPM: boolean;
};

/**
 * Membros de um projeto, unindo as TRÊS fontes que coexistem no schema (dedup por
 * id, PM ganha do resto):
 *   1. `Project.pmId`            — o PM (pode NÃO ter linha em ProjectMember).
 *   2. `ProjectMember`           — contribuidores explícitos.
 *   3. `ProjectSquad→SquadMember`— squad linkada, quando existe.
 *
 * O join SÓ-squad anterior regredia metade da carteira (8/16 projetos sem
 * ProjectSquad) — incl. SILFAE, onde João (pmId) e Davi (ProjectMember) sumiam e
 * a Vitoria devolvia squad vazio no Release Planning. UNION é o piso correto;
 * espelha o que o Alpha já faz em get_allocated_project_members.
 */
async function loadProjectMembers(projectId: string): Promise<ProjectMemberRow[]> {
  const supabase = db();
  const byId = new Map<string, ProjectMemberRow>();

  type MemberFields = {
    id: string;
    name: string;
    fpCapacity: number;
    dedicationPercent: number;
  };

  // 1) PM (Project.pmId) — fonte primária; frequentemente fora de ProjectMember.
  const { data: project } = await supabase
    .from("Project")
    .select(
      "pm:Member!Project_pmId_fkey(id, name, fpCapacity, dedicationPercent)",
    )
    .eq("id", projectId)
    .maybeSingle();
  const pm = (project?.pm ?? null) as MemberFields | null;
  if (pm) byId.set(pm.id, { ...pm, isPM: true });

  // 2) ProjectMember — contribuidores explícitos.
  const { data: pmRows } = await supabase
    .from("ProjectMember")
    .select("member:Member(id, name, fpCapacity, dedicationPercent)")
    .eq("projectId", projectId);
  for (const row of (pmRows ?? []) as Array<{ member: MemberFields | null }>) {
    if (row.member && !byId.has(row.member.id))
      byId.set(row.member.id, { ...row.member, isPM: false });
  }

  // 3) Squad linkada (quando existe) — complementa, nunca substitui.
  const { data: ps } = await supabase
    .from("ProjectSquad")
    .select("squadId")
    .eq("projectId", projectId);
  const squadIds = (ps ?? []).map((r) => r.squadId);
  if (squadIds.length > 0) {
    const { data: smRows } = await supabase
      .from("SquadMember")
      .select("member:Member(id, name, fpCapacity, dedicationPercent)")
      .in("squadId", squadIds);
    for (const row of (smRows ?? []) as Array<{ member: MemberFields | null }>) {
      if (row.member && !byId.has(row.member.id))
        byId.set(row.member.id, { ...row.member, isPM: false });
    }
  }

  return Array.from(byId.values());
}

export function buildVitoriaTools(
  planningId: string,
  projectId: string,
  memberId?: string | null,
) {
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
          // projectId NÃO é arg do modelo: vem do closure (buildVitoriaTools),
          // resolvido autoritativamente pelo tool router a partir do escopo do
          // turno. Espelha propose_story e as demais tools. Expor como input era
          // footgun — o modelo adivinhava o projeto (FK violation / projeto errado).
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
                "• create: { title, description, functionPoints (1-13), acceptanceCriteria (array de strings ≥3), type?, scope?, priority?, assigneeIds?, userStoryId?, status?, dueDate?, doneAt? }\n" +
                "• update: campos a alterar (qualquer subset dos de create; assigneeIds substitui o set inteiro)\n" +
                "• move: { } (vazio — use targetSprintId top-level)\n" +
                "• delete: { } (vazio)\n" +
                "assigneeIds: array de Member.id — resolva via list_project_members ANTES (1 responsável por task é o ideal). " +
                "userStoryId: id de uma UserStory pra pendurar a task — crie a story antes via propose_story se ainda não existe. " +
                "description deve usar template SDD: H2 ## Problema, H2 ## Solução, H2 ## Invariantes (cite path do código quando relevante).\n" +
                "BACKFILL (trabalho já entregue): passe status='done' — aí description SDD e os 3 AC deixam de ser exigidos (só title + functionPoints). " +
                "dueDate (YYYY-MM-DD) crava o dia em que a task aconteceu; doneAt (ISO) marca a conclusão (default = dueDate). targetSprintId top-level põe na sprint que entregou.",
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
            projectId, // closure (buildVitoriaTools) — autoritativo, não vem do modelo
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

    propose_tasks: tool({
      description:
        "Cria N propostas de task de UMA vez (lote) pra aprovação do PM — o write " +
        "que fala lote. Use quando montar várias tasks derivadas de uma fonte: " +
        "BACKFILL (trabalho já entregue → status='done'), KICKOFF (tasks iniciais " +
        "de uma DS/transcript) ou import de planilha. Pra 1-2 tasks conversacionais, " +
        "use propose_task_action. " +
        "PROCEDÊNCIA (obrigatória, lastro por-FONTE — não nota por item): passe " +
        "`sourceId` (o ContextSource de onde o lote saiu — auto-cria UMA nota de " +
        "lastro e a aplica a todas as tasks) OU `sourceNoteIds` (PlanningContextNote.id " +
        "já existentes). " +
        "Valida cada linha (PFV 1-13, assignee no squad, sprint válida) e devolve " +
        "{created, errors:[{index,msg}]} — corrija só as que falharem e re-chame com elas. " +
        "PM aprova item a item; o lote é só no write.",
      inputSchema: z.object({
        // projectId + planningCeremonyId vêm do closure (D13) — nunca args do modelo.
        sourceId: z
          .string()
          .uuid()
          .optional()
          .describe(
            "ContextSource de onde o lote derivou (ex: o JSON estruturado do " +
              "backfill). Auto-cria UMA nota de lastro 'Lote de <título> — N tasks' " +
              "e a usa em todas as tasks. Prefira isto quando o lote vem de uma fonte.",
          ),
        sourceNoteIds: z
          .array(z.string().uuid())
          .optional()
          .describe(
            "PlanningContextNote.id já existentes pra lastrear (kickoff sem fonte " +
              "estruturada). Ignorado quando sourceId é passado. IDs vêm de get_planning_state.",
          ),
        reasoning: z
          .string()
          .min(20)
          .describe(
            "O critério COMUM do lote (vale pra todas as tasks). Ex: 'backfill das " +
              "features entregues; PFV por commit_count; sprint pela data do último commit'.",
          ),
        aiConfidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Confiança 0-1. Default 0.8."),
        tasks: z
          .array(
            z.object({
              title: z.string().min(3).describe("Título da task (ex: nome da feature)"),
              functionPoints: z
                .number()
                .int()
                .min(1)
                .max(13)
                .describe("Tamanho estimado 1-13"),
              assigneeIds: z
                .array(z.string().uuid())
                .optional()
                .describe(
                  "Member.id responsáveis — resolva via list_project_members ANTES (nunca invente).",
                ),
              targetSprintId: z
                .string()
                .uuid()
                .optional()
                .describe(
                  "Sprint destino. Backfill cai em sprint passada → use list_project_sprints includePast=true.",
                ),
              status: z
                .string()
                .optional()
                .describe(
                  "Status inicial. BACKFILL: 'done'. Sem isso: 'todo' (com sprint) ou 'backlog'.",
                ),
              dueDate: z
                .string()
                .optional()
                .describe("YYYY-MM-DD — dia entregue (backfill) ou prazo."),
              scope: z.string().optional().describe("'small'|'medium'|'large' (opcional)"),
              description: z
                .string()
                .optional()
                .describe("Descrição da task (opcional; backfill dispensa SDD)."),
              userStoryId: z
                .string()
                .uuid()
                .optional()
                .describe("UserStory pra pendurar a task (crie antes via propose_story)."),
              acceptanceCriteria: z
                .array(z.string())
                .optional()
                .describe(
                  "Critérios de aceitação observáveis pelo PM (OPCIONAL no lote — " +
                    "backfill/kickoff dispensam SDD; quando presente, o apply materializa " +
                    "AcceptanceCriterion via coerceAcTexts).",
                ),
            }),
          )
          .describe(
            "Linhas do lote (≥1). Cada linha vira uma MeetingTaskAction(type=create) " +
              "em staging. Sem teto de schema — validação/clamp é server-side.",
          ),
      }),
      execute: async ({ sourceId, sourceNoteIds, reasoning, aiConfidence, tasks }) => {
        const supabase = db();
        if (!Array.isArray(tasks) || tasks.length === 0) {
          return { ok: false, error: "tasks vazio — passe ≥1 task no lote." };
        }

        // Validação server-side por linha (D14: integridade/forma, não estratégia).
        // 1× cada: existência dos assignees citados (piso anti-FK) + sprints do
        // projeto (sprint é project-scoped — barra cross-project leak).
        const allAssigneeIds = [
          ...new Set(tasks.flatMap((t) => t.assigneeIds ?? [])),
        ];
        const [existingMemberIds, validSprintIds] = await Promise.all([
          loadExistingMemberIds(allAssigneeIds),
          loadProjectSprintIds(projectId),
        ]);

        const errors: { index: number; msg: string }[] = [];
        const valid: Array<{ t: (typeof tasks)[number] }> = [];
        tasks.forEach((t, index) => {
          const issues: string[] = [];
          if (typeof t.title !== "string" || t.title.trim().length < 3)
            issues.push("title obrigatório (≥3 chars)");
          if (
            typeof t.functionPoints !== "number" ||
            !Number.isInteger(t.functionPoints) ||
            t.functionPoints < 1 ||
            t.functionPoints > 13
          )
            issues.push("functionPoints inteiro 1-13");
          if (t.assigneeIds && t.assigneeIds.length > 0) {
            const bad = t.assigneeIds.filter((id) => !existingMemberIds.has(id));
            if (bad.length)
              issues.push(
                `assigneeIds não é Member válido: ${bad.join(", ")} — resolva via list_project_members`,
              );
          }
          if (t.targetSprintId && !validSprintIds.has(t.targetSprintId))
            issues.push(
              `targetSprintId inválido (${t.targetSprintId}) — use list_project_sprints includePast=true`,
            );
          if (issues.length) errors.push({ index, msg: issues.join("; ") });
          else valid.push({ t });
        });

        if (valid.length === 0) {
          return {
            ok: false,
            created: 0,
            errors,
            hint: "Nenhuma linha válida — corrija os erros por index e re-chame.",
          };
        }

        // Procedência (D14): lastro por-FONTE. Só cria a nota quando há ≥1 linha
        // válida (evita nota órfã se o lote inteiro falhar a validação).
        let noteIds: string[];
        if (sourceId) {
          const { data: src } = await supabase
            .from("ContextSource")
            .select("id, title")
            .eq("id", sourceId)
            .maybeSingle();
          if (!src)
            return {
              ok: false,
              created: 0,
              errors,
              error: `sourceId ${sourceId} não encontrado (ContextSource).`,
            };
          const note = await addContextNote({
            planningCeremonyId: planningId,
            kind: "summary",
            content: `Lote de "${src.title ?? "fonte"}" — ${valid.length} tasks. ${reasoning}`,
            priority: 5,
            generatedByAgent: "vitoria",
          });
          noteIds = [note.id];
        } else if (sourceNoteIds && sourceNoteIds.length > 0) {
          noteIds = sourceNoteIds;
        } else {
          return {
            ok: false,
            created: 0,
            errors,
            error:
              "Procedência obrigatória: passe sourceId (fonte do lote) ou sourceNoteIds (notas existentes). Sem lastro não publica.",
          };
        }

        // Bulk-insert das linhas válidas (1 statement). projectId + ceremony do
        // closure — nunca do modelo (D13). targetSprintId top-level; status/PFV/
        // assigneeIds/dueDate no payload (mesmo contrato do executor de create).
        const rows = valid.map(({ t }) => ({
          planningCeremonyId: planningId,
          projectId,
          type: "create" as const,
          taskId: null,
          targetSprintId: t.targetSprintId ?? null,
          payload: {
            title: t.title,
            functionPoints: t.functionPoints,
            ...(t.assigneeIds && t.assigneeIds.length ? { assigneeIds: t.assigneeIds } : {}),
            ...(t.status ? { status: t.status } : {}),
            ...(t.dueDate ? { dueDate: t.dueDate } : {}),
            ...(t.scope ? { scope: t.scope } : {}),
            ...(t.description ? { description: t.description } : {}),
            ...(t.userStoryId ? { userStoryId: t.userStoryId } : {}),
            ...(t.acceptanceCriteria && t.acceptanceCriteria.length
              ? { acceptanceCriteria: t.acceptanceCriteria }
              : {}),
          } as Json,
          aiReasoning: reasoning,
          aiConfidence: aiConfidence ?? 0.8,
          sourceNoteIds: noteIds as unknown as string[],
          decision: "pending" as const,
          execution: "pending" as const,
          source: "ai" as const,
          notes: null,
        }));

        const { data, error } = await supabase
          .from("MeetingTaskAction")
          .insert(rows)
          .select("id");
        if (error)
          return {
            ok: false,
            created: 0,
            errors,
            error: `Falha ao inserir lote: ${error.message}`,
          };

        return {
          ok: errors.length === 0,
          created: data?.length ?? 0,
          actionIds: (data ?? []).map((r) => r.id),
          sourceNoteIds: noteIds,
          errors,
          ...(errors.length
            ? {
                hint: "Corrija as linhas em `errors` (por index) e re-chame propose_tasks só com elas.",
              }
            : {}),
        };
      },
    }),

    propose_task_bulk_update: tool({
      description:
        "Atualiza N tasks EXISTENTES de UMA vez (lote) — propostas pra aprovação do PM. " +
        "É o `propose_task_action(type=update)` que fala lote: use pra repriorizar/re-PFV/" +
        "remanejar muitas tasks (ex: 'sobe a prioridade dessas 15', 'move o backlog de " +
        "cobrança pra Sprint 12'). Pra mover de sprint, passe `sprintId` no patch. " +
        "Cada update vira UMA MeetingTaskAction(type=update) em staging (o PM aplica ao " +
        "Concluir, item a item) — o ganho é no write (1 tool call → N rows), não na semântica. " +
        "PROCEDÊNCIA obrigatória: `sourceNoteIds` (≥1 PlanningContextNote.id, espelha o single). " +
        "Valida cada linha (taskId é do projeto, patch não-vazio) e devolve " +
        "{created, errors:[{index,msg}]} — corrija só as que falharem e re-chame com elas.",
      inputSchema: z.object({
        // projectId + planningCeremonyId vêm do closure (D13) — nunca args do modelo.
        updates: z
          .array(
            z.object({
              taskId: z
                .string()
                .uuid()
                .describe("UUID da task a atualizar (resolva via list_project_tasks/get_task_detail)"),
              patch: z
                .record(z.string(), z.unknown())
                .describe(
                  "Campos a alterar (subset de: title, description, status, type, scope, " +
                    "complexity, priority, functionPoints (1-13), notes, dueDate, sprintId, " +
                    "userStoryId, assigneeIds, acceptanceCriteria). MERGE no apply — só os " +
                    "campos passados mudam. Pra MOVER de sprint use patch.sprintId. " +
                    "JSON OBJECT (nunca string stringificada).",
                ),
            }),
          )
          .describe(
            "Linhas do lote (≥1). Cada linha vira uma MeetingTaskAction(type=update) em " +
              "staging. Sem teto de schema — validação/clamp é server-side.",
          ),
        reasoning: z
          .string()
          .min(20)
          .describe(
            "O critério COMUM do lote (vale pra todas as updates). Ex: 'repriorização pós-" +
              "granola: cobrança vira P0 porque o cliente subiu a urgência'. PM lê pra decidir.",
          ),
        sourceNoteIds: z
          .array(z.string().uuid())
          .min(1, "Cite ≥1 PlanningContextNote.id que embasa o lote")
          .describe(
            "PlanningContextNote.id que embasam o lote. OBRIGATÓRIO ≥1 (espelha " +
              "propose_task_action). IDs vêm de get_planning_state; nunca invente.",
          ),
        aiConfidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Confiança 0-1. Default 0.8."),
      }),
      execute: async ({ updates, reasoning, sourceNoteIds, aiConfidence }) => {
        const supabase = db();
        if (!Array.isArray(updates) || updates.length === 0) {
          return { ok: false, error: "updates vazio — passe ≥1 update no lote." };
        }

        // Validação server-side por-linha (D14: integridade/forma, não estratégia):
        // taskId existe NO PROJETO (1 query pro lote; barra cross-project) + patch
        // não-vazio. O apply (writeUpdate) filtra os campos permitidos — campo
        // desconhecido no patch é ignorado lá, não aqui (mesmo contrato do single).
        const allTaskIds = [...new Set(updates.map((u) => u.taskId))];
        const projectTaskIds = await loadProjectTaskIds(allTaskIds, projectId);

        const errors: { index: number; msg: string }[] = [];
        const valid: Array<{ u: (typeof updates)[number] }> = [];
        updates.forEach((u, index) => {
          const issues: string[] = [];
          if (!projectTaskIds.has(u.taskId))
            issues.push(
              `taskId ${u.taskId} não é task deste projeto — resolva via list_project_tasks`,
            );
          if (
            !u.patch ||
            typeof u.patch !== "object" ||
            Object.keys(u.patch).length === 0
          )
            issues.push("patch vazio — passe ≥1 campo a alterar");
          if (issues.length) errors.push({ index, msg: issues.join("; ") });
          else valid.push({ u });
        });

        if (valid.length === 0) {
          return {
            ok: false,
            created: 0,
            errors,
            hint: "Nenhuma linha válida — corrija os erros por index e re-chame.",
          };
        }

        // Bulk-insert das linhas válidas (1 statement). type=update: taskId
        // top-level, patch no payload (mesmo contrato que o executor lê em
        // writeUpdate). projectId + ceremony do closure — nunca do modelo (D13).
        const rows = valid.map(({ u }) => ({
          planningCeremonyId: planningId,
          projectId,
          type: "update" as const,
          taskId: u.taskId,
          targetSprintId: null,
          payload: u.patch as Json,
          aiReasoning: reasoning,
          aiConfidence: aiConfidence ?? 0.8,
          sourceNoteIds: sourceNoteIds as unknown as string[],
          decision: "pending" as const,
          execution: "pending" as const,
          source: "ai" as const,
          notes: null,
        }));

        const { data, error } = await supabase
          .from("MeetingTaskAction")
          .insert(rows)
          .select("id");
        if (error)
          return {
            ok: false,
            created: 0,
            errors,
            error: `Falha ao inserir lote: ${error.message}`,
          };

        return {
          ok: errors.length === 0,
          created: data?.length ?? 0,
          actionIds: (data ?? []).map((r) => r.id),
          errors,
          ...(errors.length
            ? {
                hint: "Corrija as linhas em `errors` (por index) e re-chame propose_task_bulk_update só com elas.",
              }
            : {}),
        };
      },
    }),

    propose_story: tool({
      description:
        "Cria uma User Story pra AGRUPAR tasks da planning. A story é o container; as tasks vão penduradas via `userStoryId` no propose_task_action (use o storyId retornado aqui). " +
        "A story é criada NA HORA (aparece na árvore já agrupando os ghosts das tasks) — mas as TASKS continuam propostas até o PM concluir a planning. " +
        "Use proposedModuleName pra agrupar a story sob um módulo nomeado (ex: 'Cobrança', 'Notas Fiscais'); sem isso ela cai em '(sem módulo)'. " +
        "NÃO crie stories pra itens operacionais soltos (bugs/ajustes avulsos) — esses ficam como tasks sem story. Story é pra agrupar trabalho que compartilha um objetivo de usuário.",
      inputSchema: z.object({
        title: z.string().min(3).describe("Título curto da story (ex: 'Conciliação de cobrança')"),
        want: z
          .string()
          .min(10)
          .describe("O 'quero' da story — 'Como <persona>, quero <want>'. Foco na capacidade do usuário."),
        soThat: z
          .string()
          .optional()
          .describe("O 'para que' — valor/porquê. 'para que <soThat>'."),
        proposedModuleName: z
          .string()
          .optional()
          .describe("Nome do módulo pra agrupar a story na árvore. Reuse o mesmo nome entre stories do mesmo tema."),
      }),
      execute: async ({ title, want, soThat, proposedModuleName }) => {
        const supabase = db();
        const { data: reference, error: rpcErr } = await supabase.rpc(
          "next_user_story_reference",
          { p_project_id: projectId },
        );
        if (rpcErr || !reference) {
          return { ok: false, error: `Falha ao gerar reference: ${rpcErr?.message ?? "sem valor"}` };
        }
        const { data, error } = await supabase
          .from("UserStory")
          .insert({
            projectId,
            reference: reference as string,
            title,
            want,
            soThat: soThat ?? null,
            proposedModuleName: proposedModuleName ?? null,
            refinementStatus: "draft",
            createdByAgent: true,
            updatedAt: new Date().toISOString(),
          })
          .select("id, reference, title")
          .single();
        if (error) return { ok: false, error: error.message };
        return {
          ok: true,
          storyId: data.id,
          reference: data.reference,
          title: data.title,
          hint: "Use storyId em payload.userStoryId dos propose_task_action pra pendurar as tasks.",
        };
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

    add_task_comment: tool({
      description:
        "Comenta NA HORA (write direto, live) numa task — deixa uma anotação/decisão " +
        "visível no board imediatamente. Use quando o PM pedir pra registrar um recado " +
        "ou justificativa numa task específica (ex: 'comenta na VLD-204 que o cliente " +
        "mudou o escopo'). NÃO passa pelo staging — aparece na hora. " +
        "GROUNDED (anti-alucinação): cite a fonte no próprio body (transcript/nota/decisão). " +
        "Pra MUDAR PFV/status/sprint de tasks, use propose_task_action/propose_task_bulk_update — " +
        "essas vão pro staging e o PM aplica ao Concluir.",
      inputSchema: z.object({
        // projectId/memberId vêm do closure (D2) — nunca args do modelo.
        taskId: z
          .string()
          .uuid()
          .describe("UUID da task a comentar (resolva via list_project_tasks/get_task_detail)"),
        body: z
          .string()
          .min(1)
          .describe(
            "Texto do comentário. Cite a fonte (transcript/nota) quando registrar uma decisão.",
          ),
        mentionedMemberIds: z
          .array(z.string().uuid())
          .optional()
          .describe(
            "Member.id mencionados (opcional). Resolva via list_project_members — nunca invente.",
          ),
      }),
      execute: async ({ taskId, body, mentionedMemberIds }) => {
        // Guard cross-project: a task TEM que ser deste projeto (closure). Sem
        // isso um taskId de outro projeto passaria (FK válida) e vazaria comentário.
        const { data: task, error: tErr } = await db()
          .from("Task")
          .select("id, projectId")
          .eq("id", taskId)
          .maybeSingle();
        if (tErr) return { ok: false, error: tErr.message };
        if (!task) return { ok: false, error: "task não encontrada" };
        if (task.projectId !== projectId) {
          return { ok: false, error: "task pertence a outro projeto" };
        }
        try {
          const comment = await createCommentAs({
            taskId,
            body,
            mentionedMemberIds: mentionedMemberIds ?? [],
            authorMemberId: memberId ?? null,
          });
          return { ok: true, commentId: comment.id };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    read_context_source: createReadContextSourceTool(),

    list_project_sprints: tool({
      description:
        "Lista sprints do projeto, ordenadas por startDate. Default: as próximas 3 " +
        "(endDate >= hoje) — use antes de propor 'move'. Para BACKFILL passe " +
        "includePast=true: traz TODAS as sprints (passadas inclusive, com IDs e " +
        "datas) pra cravar a task na sprint em que a entrega aconteceu.",
      inputSchema: z.object({
        includePast: z
          .boolean()
          .optional()
          .describe(
            "true = todas as sprints (passadas inclusive), sem limite. Default false (próximas 3).",
          ),
      }),
      execute: async ({ includePast }) => {
        let q = db()
          .from("Sprint")
          .select("id, name, startDate, endDate, status, goal")
          .eq("projectId", projectId)
          .order("startDate", { ascending: true });
        if (!includePast) {
          // Default: só as futuras (move/planejamento pra frente). Backfill precisa
          // das passadas (a entrega cai numa sprint já terminada) → includePast.
          const todayISO = new Date().toISOString().slice(0, 10);
          q = q.gte("endDate", todayISO).limit(3);
        }
        const { data, error } = await q;
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

    list_project_members: tool({
      description:
        "Lista os membros do projeto (id, nome, capacidade PFV, dedicação, isPM). " +
        "Une PM (Project.pmId) + ProjectMembers + squad linkada — funciona mesmo " +
        "quando o projeto não tem squad cadastrada (caso comum). " +
        "Use SEMPRE antes de propor assigneeIds num create/update — nunca invente Member.id. " +
        "Lista vazia de verdade só se o projeto não tem PM nem membros: aí avise o PM.",
      inputSchema: z.object({}),
      execute: async () => {
        const members = await loadProjectMembers(projectId);
        return { ok: true, members };
      },
    }),

    get_sprint_capacity: tool({
      description:
        "Mostra PFV planejado vs capacity dos members do squad numa sprint. Use pra avaliar risco de sobrecarga antes de propor novas tasks.",
      inputSchema: z.object({
        sprintId: z.string().describe("ID da sprint"),
      }),
      execute: async ({ sprintId }) => {
        const supabase = db();

        // Tasks da sprint com assignees + PFV
        const { data: tasks, error: tErr } = await supabase
          .from("Task")
          .select(
            "id, functionPoints, status, TaskAssignment(memberId)",
          )
          .eq("sprintId", sprintId)
          .is("dismissedAt", null);
        if (tErr) return { ok: false, error: tErr.message };

        // Members do projeto (PM + ProjectMembers + squad) — mesma fonte que
        // list_project_members; só-squad regredia projetos sem ProjectSquad.
        const members = await loadProjectMembers(projectId);

        // PFV planejado por member
        const fpByMember = new Map<string, number>();
        for (const t of tasks ?? []) {
          const fp = t.functionPoints ?? 0;
          const assigns = (t.TaskAssignment ?? []) as Array<{ memberId: string | null }>;
          if (assigns.length === 0) continue;
          // Divide PFV igual entre assignees (heurística simples)
          const share = fp / assigns.length;
          for (const a of assigns) {
            if (!a.memberId) continue;
            fpByMember.set(a.memberId, (fpByMember.get(a.memberId) ?? 0) + share);
          }
        }

        const capacity = members.map((m) => {
          const planned = Math.round((fpByMember.get(m.id) ?? 0) * 10) / 10;
          const cap = m.fpCapacity ?? 0;
          const dedication = (m.dedicationPercent ?? 100) / 100;
          const effectiveCap = Math.round(cap * dedication * 10) / 10;
          return {
            memberId: m.id,
            name: m.name,
            fpCapacity: cap,
            dedicationPercent: m.dedicationPercent,
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

    get_planning_state: tool({
      description:
        "Snapshot do estado VIVO desta planning AGORA: propostas pendentes (com IDs pra editar/descartar), " +
        "notas de contexto ativas (com IDs pra usar em sourceNoteIds), fase, sprint e memória das últimas sprints. " +
        "No daemon o system prompt é congelado no 1º turn — então SEMPRE chame esta tool no início de um turn que vá " +
        "editar/descartar proposta ou citar nota: os IDs de turns anteriores podem estar desatualizados. NUNCA invente ID.",
      inputSchema: z.object({}),
      execute: async () => {
        const supabase = db();
        const [{ data: planning }, { data: pendingRows }, { data: noteRows }] =
          await Promise.all([
            supabase
              .from("PlanningCeremony")
              .select("phase, sprintId, sprint:Sprint(name)")
              .eq("id", planningId)
              .maybeSingle(),
            supabase
              .from("MeetingTaskAction")
              .select(
                "id, type, taskId, targetSprintId, payload, aiReasoning, aiConfidence",
              )
              .eq("planningCeremonyId", planningId)
              .eq("decision", "pending")
              .eq("execution", "pending")
              .order("createdAt", { ascending: true }),
            supabase
              .from("PlanningContextNote")
              .select("id, kind, content, priority")
              .eq("planningCeremonyId", planningId)
              .is("dismissedAt", null)
              .order("priority", { ascending: false }),
          ]);

        const sprintOutcomes = await getSprintOutcomes(projectId, 3).catch(() => []);

        return {
          ok: true,
          phase: planning?.phase ?? null,
          sprintName: (planning?.sprint as { name: string } | null)?.name ?? null,
          pendingProposals: (pendingRows ?? []).map((r) => ({
            id: r.id,
            type: r.type,
            taskId: r.taskId,
            targetSprintId: r.targetSprintId,
            title: (r.payload as { title?: string } | null)?.title ?? null,
            aiConfidence: r.aiConfidence,
            aiReasoning: r.aiReasoning,
          })),
          activeNotes: (noteRows ?? []).map((n) => ({
            id: n.id,
            kind: n.kind,
            content: n.content,
            priority: n.priority,
          })),
          sprintMemory: sprintOutcomes.map((o) => ({
            name: o.name,
            doneCount: o.doneCount,
            totalCount: o.totalCount,
            velocityFp: o.velocityFp,
            carryoverCount: o.carryoverCount,
          })),
        };
      },
    }),
  };
}
