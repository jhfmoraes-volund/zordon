/**
 * Vitoria — modo PM Review.
 *
 * Mesmo agent que opera Planning, com outro "surface": prompt, tools e
 * contexto trocados. Despachado por `params.surface === 'pm_review'` em
 * vitoria/index.ts.
 *
 * Diferenças de comportamento:
 *   • NÃO propõe tasks (sem propose_task_action / update_proposed_action / delete_proposed_action).
 *   • ESCREVE notes em PMReviewNote (kinds próprios) via add_pm_review_note.
 *   • SINTETIZA o report em PMReview.reportMarkdown via update_pm_review_report.
 *   • LÊ indicadores do time via get_project_indicators (velocity, throughput, blockers).
 */
import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  addPMReviewNote,
  updatePMReview,
  PM_REVIEW_NOTE_KINDS,
  type PMReviewNoteKind,
} from "@/lib/dal/pm-review";
import { buildProjectProfile } from "./profile";
import type { PromptContext, SystemPrompt } from "../../types";

// ─── Context loader ───────────────────────────────────────────────────────

export async function loadPMReviewContext(pmReviewId: string, memberId?: string | null) {
  const { data: pm } = await db()
    .from("PMReview")
    .select(
      `
      id, status, projectId, referenceWeek, reportMarkdown, reportGeneratedAt,
      project:Project(id, name, referenceKey, status),
      linkedMeetings:PMReviewMeetingLink(
        meetingId, meeting:Meeting(id, title, date)
      ),
      linkedTranscripts:PMReviewTranscriptLink(
        transcriptRefId, weight,
        transcript:TranscriptRef(id, title, source, capturedAt)
      ),
      notes:PMReviewNote(id, kind, content, dismissedAt, priority, sourceTranscriptIds, sourceMeetingIds)
      `,
    )
    .eq("id", pmReviewId)
    .single();

  if (!pm) throw new Error(`PMReview ${pmReviewId} não encontrado`);

  const activeNotes = (
    pm.notes as Array<{
      id: string;
      kind: string;
      content: string;
      dismissedAt: string | null;
      priority: number;
      sourceTranscriptIds: string[] | null;
      sourceMeetingIds: string[] | null;
    }>
  )
    .filter((n) => !n.dismissedAt)
    .sort((a, b) => b.priority - a.priority);

  const profile = await buildProjectProfile(pm.projectId, { currentSprintId: null });

  const project = pm.project as
    | { id: string; name: string; referenceKey: string | null; status: string }
    | null;

  return {
    surface: "pm_review" as const,
    pmReviewId,
    status: pm.status,
    projectId: pm.projectId,
    projectName: project?.name ?? null,
    projectStatus: project?.status ?? null,
    referenceWeek: pm.referenceWeek,
    reportMarkdown: pm.reportMarkdown,
    reportGeneratedAt: pm.reportGeneratedAt,
    linkedMeetings: pm.linkedMeetings ?? [],
    linkedTranscripts: pm.linkedTranscripts ?? [],
    activeNotes,
    upcomingSprints: profile.core.upcomingSprints,
    activeStories: profile.core.activeStories,
    squadMembers: profile.core.squadMembers,
    memberId: memberId ?? null,
  };
}

// ─── Prompt ───────────────────────────────────────────────────────────────

export function buildPMReviewPrompt(ctx: PromptContext): SystemPrompt {
  const { agentContext } = ctx;
  const pmReviewId = agentContext.pmReviewId as string;
  const status = agentContext.status as string;
  const referenceWeek = agentContext.referenceWeek as string;
  const reportGeneratedAt = agentContext.reportGeneratedAt as string | null;
  const projectName = agentContext.projectName as string | null;

  const linkedMeetings = (agentContext.linkedMeetings as Array<{
    meetingId: string;
    meeting: { id: string; title: string | null; date: string } | null;
  }>) ?? [];

  const linkedTranscripts = (agentContext.linkedTranscripts as Array<{
    transcriptRefId: string;
    weight: string | null;
    transcript: { id: string; title: string | null; source: string; capturedAt: string | null } | null;
  }>) ?? [];

  const activeNotes = (agentContext.activeNotes as Array<{
    id: string;
    kind: string;
    content: string;
    priority: number;
  }>) ?? [];

  const linkedTranscriptsBlock =
    linkedTranscripts.length === 0
      ? "(nenhuma)"
      : linkedTranscripts
          .map((l) => {
            const t = l.transcript;
            if (!t) return null;
            return `- transcriptRefId=${t.id} · ${t.source} · ${t.title ?? "(sem título)"}`;
          })
          .filter(Boolean)
          .join("\n");

  const linkedMeetingsBlock =
    linkedMeetings.length === 0
      ? "(nenhuma)"
      : linkedMeetings
          .map((l) => {
            const m = l.meeting;
            if (!m) return null;
            return `- meetingId=${m.id} · ${m.title ?? "(sem título)"} · ${m.date}`;
          })
          .filter(Boolean)
          .join("\n");

  const notesBlock =
    activeNotes.length === 0
      ? "(nenhuma)"
      : activeNotes
          .map((n) => `- [${n.kind}] (p${n.priority}) noteId=${n.id} · ${n.content.slice(0, 180)}`)
          .join("\n");

  const reportHint = reportGeneratedAt
    ? `Última síntese: ${reportGeneratedAt}.`
    : "Report ainda não foi gerado.";

  const stable = `Você é Vitoria, a PM inteligente do projeto **${projectName ?? "(?)"}**.

Sua missão: manter o pulso do projeto pra que o PM humano possa consultar a
qualquer momento. Você opera em 3 camadas de contexto:
  1. Conversa — transcripts de reuniões/dailies/calls com cliente.
  2. Sistema — sprints, backlog, capacidade, tasks em andamento.
  3. Código — repositório (manifest), quando disponível.

Seu output principal é um REPORT estruturado em 6 seções fixas:
  • Rumo do projeto       (kind=project_direction)
  • Próximos passos       (kind=next_step)
  • Riscos                (kind=risk)
  • Necessidades          (kind=need)
  • Indicadores do time   (kind=team_signal)
  • Decisões em aberto    (kind=open_decision)

REGRAS:
  • NÃO proponha tasks. Não existe staging-commit aqui.
  • Toda observação vai em \`add_pm_review_note\` com kind ∈ {summary,
    project_direction, next_step, risk, need, team_signal, open_decision}.
    Use \`summary\` para um panorama curto que abre o report.
  • Quando o PM pedir "atualiza o report" / "gera o report" / "sintetiza", chame
    \`update_pm_review_report\` com markdown direto, organizado nas 6 seções
    fixas. Cite source IDs (transcriptRefId / meetingId) quando relevante.
  • Read first, write later: chame \`read_transcript_content\` nos transcriptRefId
    listados em "Fontes de contexto linkadas" antes de sintetizar.
  • Use \`get_project_indicators\` pra alimentar a seção "Indicadores do time".

NÃO use jargão de fase ("vou começar a leitura agora") — fluxo é livre.
Quando o PM perguntar "em qual projeto estamos?" responda **${projectName ?? "(?)"}**.
Nunca peça projectId ao PM — você já tem.

## Estado atual do PM Review (ID: ${pmReviewId})

**Status**: ${status}
**Semana de referência**: ${referenceWeek} (segunda-feira)
**${reportHint}**

## Fontes de contexto linkadas

### Reuniões (meetingId — use em sourceMeetingIds das notes)
${linkedMeetingsBlock}

### Transcripts (transcriptRefId — use em read_transcript_content e em sourceTranscriptIds)
${linkedTranscriptsBlock}

## Notas ativas (não-dismissed) — ordenadas por priority desc
${notesBlock}
`;

  // Project profile (sprints, squad, stories) — leve.
  const upcomingSprints = (agentContext.upcomingSprints as Array<{
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
  }>) ?? [];

  const upcomingBlock =
    upcomingSprints.length === 0
      ? "(nenhuma sprint próxima)"
      : upcomingSprints
          .map((s) => `- ${s.name} · ${s.startDate} → ${s.endDate} · ${s.status}`)
          .join("\n");

  const squad = (agentContext.squadMembers as Array<{
    id: string;
    name: string;
    position: string | null;
    fpCapacity: number;
    dedicationPercent: number;
  }>) ?? [];

  const squadBlock =
    squad.length === 0
      ? "(squad vazio)"
      : squad
          .map(
            (m) =>
              `- ${m.name} (${m.position ?? "?"}) — capacity ${m.fpCapacity} FP · ${m.dedicationPercent}% dedicação`,
          )
          .join("\n");

  return {
    stable,
    volatile: `## Sprints próximas\n${upcomingBlock}\n\n## Squad\n${squadBlock}`,
  };
}

// ─── Tools ────────────────────────────────────────────────────────────────

export function buildPMReviewTools(pmReviewId: string, projectId: string) {
  return {
    add_pm_review_note: tool({
      description:
        "Adiciona uma nota tipada ao PM Review. Cada nota é fonte pro report final. " +
        "Use durante a conversa pra registrar achados; o report é montado depois via update_pm_review_report.",
      inputSchema: z.object({
        kind: z
          .enum(PM_REVIEW_NOTE_KINDS as [PMReviewNoteKind, ...PMReviewNoteKind[]])
          .describe(
            "Tipo: summary (panorama), project_direction (rumo), next_step (próximos passos), " +
              "risk (risco), need (necessidade — recurso/decisão/input), " +
              "team_signal (capacidade/moral/blockers), open_decision (decisão em aberto).",
          ),
        content: z
          .string()
          .min(10)
          .describe("Conteúdo da nota. Curto, específico, citando evidência quando der."),
        sourceMeetingIds: z
          .array(z.string().uuid())
          .optional()
          .describe("meetingIds que embasam esta nota (lidos no contexto)"),
        sourceTranscriptIds: z
          .array(z.string().uuid())
          .optional()
          .describe("transcriptRefIds que embasam esta nota"),
        priority: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe("Prioridade 0-10. Default 5."),
      }),
      execute: async ({ kind, content, sourceMeetingIds, sourceTranscriptIds, priority }) => {
        const note = await addPMReviewNote({
          pmReviewId,
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

    update_pm_review_report: tool({
      description:
        "Grava o markdown SINTETIZADO do report do PM Review. Substitui o anterior. " +
        "Estrutura sugerida (mas pode variar conforme o contexto):\n" +
        "  ## Rumo do projeto\n  ## Próximos passos\n  ## Riscos\n  ## Necessidades\n" +
        "  ## Indicadores do time\n  ## Decisões em aberto\n" +
        "Cite source IDs (transcriptRef / meeting) inline quando relevante.",
      inputSchema: z.object({
        markdown: z
          .string()
          .min(50)
          .describe("Markdown completo do report (substitui o anterior)."),
      }),
      execute: async ({ markdown }) => {
        const updated = await updatePMReview(pmReviewId, {
          reportMarkdown: markdown,
          reportGeneratedAt: new Date().toISOString(),
        });
        return {
          ok: true,
          pmReviewId,
          length: markdown.length,
          generatedAt: updated.reportGeneratedAt,
        };
      },
    }),

    get_project_indicators: tool({
      description:
        "Retorna indicadores do time do projeto: velocity das últimas 3 sprints fechadas, " +
        "throughput (tasks done), blockers ativos, capacity FP vs delivered. " +
        "Use pra preencher a seção 'Indicadores do time' do report.",
      inputSchema: z.object({}),
      execute: async () => {
        const supabase = db();

        const [sprintsRes, tasksRes, blockersRes] = await Promise.all([
          // Últimas 3 sprints fechadas (status='completed' OU endDate < hoje)
          supabase
            .from("Sprint")
            .select("id, name, startDate, endDate, status")
            .eq("projectId", projectId)
            .order("endDate", { ascending: false })
            .limit(5),
          // Tasks da sprint atual + últimas (qty + status mix)
          supabase
            .from("Task")
            .select("id, status, functionPoints, sprintId")
            .eq("projectId", projectId)
            .is("dismissedAt", null),
          // Blockers ativos: TaskDependency cujas dependsOn ainda não estão 'done'.
          supabase
            .from("TaskDependency")
            .select(
              "taskId, dependsOn, kind, dep:Task!TaskDependency_dependsOn_fkey(status, projectId)",
            )
            .eq("kind", "hard"),
        ]);

        const sprints = sprintsRes.data ?? [];
        const tasks = tasksRes.data ?? [];
        const allDeps = blockersRes.data ?? [];

        const tasksBySprint = new Map<string, { done: number; total: number; fpDone: number; fpTotal: number }>();
        for (const t of tasks) {
          if (!t.sprintId) continue;
          const acc = tasksBySprint.get(t.sprintId) ?? { done: 0, total: 0, fpDone: 0, fpTotal: 0 };
          acc.total += 1;
          acc.fpTotal += t.functionPoints ?? 0;
          if (t.status === "done") {
            acc.done += 1;
            acc.fpDone += t.functionPoints ?? 0;
          }
          tasksBySprint.set(t.sprintId, acc);
        }

        const velocity = sprints
          .filter((s) => s.status === "completed" || new Date(s.endDate) < new Date())
          .slice(0, 3)
          .map((s) => {
            const acc = tasksBySprint.get(s.id);
            return {
              sprintName: s.name,
              endDate: s.endDate,
              fpDelivered: acc?.fpDone ?? 0,
              tasksDelivered: acc?.done ?? 0,
              fpPlanned: acc?.fpTotal ?? 0,
              completionPct: acc && acc.fpTotal > 0 ? Math.round((acc.fpDone / acc.fpTotal) * 100) : 0,
            };
          });

        const blockersActive = allDeps.filter((d) => {
          const dep = d.dep as { status: string; projectId: string } | null;
          if (!dep) return false;
          return dep.projectId === projectId && dep.status !== "done";
        }).length;

        const statusMix: Record<string, number> = {};
        for (const t of tasks) {
          statusMix[t.status] = (statusMix[t.status] ?? 0) + 1;
        }

        return {
          ok: true,
          velocity,
          throughput: {
            totalTasks: tasks.length,
            statusMix,
          },
          blockersActive,
        };
      },
    }),
  };
}
