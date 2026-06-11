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
  replaceExecutiveDigest,
  PM_REVIEW_NOTE_KINDS,
  PM_REVIEW_RISK_STANCES,
  type PMReviewNoteKind,
  type PMReviewRiskStance,
} from "@/lib/dal/pm-review";
import { buildProjectProfile } from "./profile";
import type { PromptContext, SystemPrompt } from "../../types";

// ─── Context loader ───────────────────────────────────────────────────────

export async function loadPMReviewContext(pmReviewId: string, memberId?: string | null) {
  const supabase = db();

  const { data: pm } = await supabase
    .from("PMReview")
    .select(
      `
      id, status, projectId, referenceWeek, reportMarkdown, reportGeneratedAt,
      project:Project(id, name, referenceKey, status, repoUrl, githubRepoOwner, githubRepoName, githubDefaultBranch, repoManifest, repoManifestUpdatedAt, memoryMd, memoryVersion, memoryUpdatedAt),
      linkedMeetings:EntityLink!EntityLink_pmReviewId_fkey(
        meetingId, meeting:Meeting!EntityLink_meetingId_fkey(id, title, date)
      ),
      linkedTranscripts:EntityLink!EntityLink_pmReviewId_fkey(
        contextSourceId, weight,
        transcript:ContextSource!EntityLink_contextSourceId_fkey(id, title, source, capturedAt)
      ),
      notes:PMReviewNote(id, kind, content, dismissedAt, priority, audience, stance, sourceTranscriptIds, sourceMeetingIds)
      `,
    )
    .eq("id", pmReviewId)
    .not("linkedMeetings.meetingId", "is", null)
    .not("linkedTranscripts.contextSourceId", "is", null)
    .single();

  if (!pm) throw new Error(`PMReview ${pmReviewId} não encontrado`);

  // Só notes 'detail' entram no contexto de trabalho — o digest 'executive'
  // é output da síntese, não insumo (evita a Vitoria reler o próprio digest).
  const activeNotes = (
    pm.notes as Array<{
      id: string;
      kind: string;
      content: string;
      dismissedAt: string | null;
      priority: number;
      audience: string;
      stance: string | null;
      sourceTranscriptIds: string[] | null;
      sourceMeetingIds: string[] | null;
    }>
  )
    .filter((n) => !n.dismissedAt && n.audience !== "executive")
    .sort((a, b) => b.priority - a.priority);

  // Resolve sprint atual do projeto (endDate >= hoje, mais próxima de começar).
  // Necessário pra `buildProjectProfile` carregar tasks da sprint + blockers
  // (que vão pro contexto da Vitoria).
  const todayISO = new Date().toISOString().slice(0, 10);
  const { data: currentSprint } = await supabase
    .from("Sprint")
    .select("id")
    .eq("projectId", pm.projectId)
    .lte("startDate", todayISO)
    .gte("endDate", todayISO)
    .order("startDate", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Camada 2 (Sistema) + Camada 3 (DS) em paralelo. Espelha o que Planning
  // Vitoria já carrega — sem isso PM Review sintetiza no escuro.
  const [profile, businessCtx, activeDecisions, openQuestions, activeSessions] =
    await Promise.all([
      buildProjectProfile(pm.projectId, {
        currentSprintId: currentSprint?.id ?? null,
      }),
      supabase
        .from("ProjectBusinessContext")
        .select("businessModel, stage, icp, ticketRangeBrl, runwayMonths, competitors, updatedAt")
        .eq("projectId", pm.projectId)
        .maybeSingle(),
      supabase
        .from("DesignDecision")
        .select("id, statement, rationale, confidence, tags, createdAt")
        .eq("projectId", pm.projectId)
        .eq("status", "active")
        .order("createdAt", { ascending: false }),
      supabase
        .from("DesignOpenQuestion")
        .select("id, question, blocksWhat, sessionId, createdAt")
        .eq("projectId", pm.projectId)
        .eq("status", "open")
        .order("createdAt", { ascending: false }),
      supabase
        .from("DesignSession")
        .select("id, title, type, status, memoryAbstract, updatedAt")
        .eq("projectId", pm.projectId)
        .in("status", ["active", "in_progress"])
        .order("updatedAt", { ascending: false }),
    ]);

  const project = pm.project as
    | {
        id: string;
        name: string;
        referenceKey: string | null;
        status: string;
        repoUrl: string | null;
        githubRepoOwner: string | null;
        githubRepoName: string | null;
        githubDefaultBranch: string | null;
        repoManifest: string | null;
        repoManifestUpdatedAt: string | null;
        memoryMd: string | null;
        memoryVersion: number | null;
        memoryUpdatedAt: string | null;
      }
    | null;

  return {
    surface: "pm_review" as const,
    pmReviewId,
    status: pm.status,
    projectId: pm.projectId,
    projectName: project?.name ?? null,
    projectReferenceKey: project?.referenceKey ?? null,
    projectStatus: project?.status ?? null,
    projectRepoUrl: project?.repoUrl ?? null,
    projectRepoOwner: project?.githubRepoOwner ?? null,
    projectRepoName: project?.githubRepoName ?? null,
    projectRepoBranch: project?.githubDefaultBranch ?? null,
    projectRepoManifest: project?.repoManifest ?? null,
    referenceWeek: pm.referenceWeek,
    reportMarkdown: pm.reportMarkdown,
    reportGeneratedAt: pm.reportGeneratedAt,
    linkedMeetings: pm.linkedMeetings ?? [],
    linkedTranscripts: pm.linkedTranscripts ?? [],
    activeNotes,
    // Camada 2 — Sistema (sprint atual + tasks + blockers + stories + squad)
    currentSprintId: currentSprint?.id ?? null,
    upcomingSprints: profile.core.upcomingSprints,
    activeStories: profile.core.activeStories,
    squadMembers: profile.core.squadMembers,
    sprintScopeTasks: profile.sprintScope?.tasks ?? [],
    sprintBlockers: profile.sprintScope?.blockers ?? [],
    // Camada 3 — DS (decisions/questions/business/sessions) + Project memory
    projectMemoryMd: project?.memoryMd ?? null,
    projectMemoryVersion: project?.memoryVersion ?? 0,
    businessContext: businessCtx.data ?? null,
    activeDecisions: activeDecisions.data ?? [],
    openQuestions: openQuestions.data ?? [],
    activeDesignSessions: activeSessions.data ?? [],
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
    stance?: string | null;
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
          .map(
            (n) =>
              `- [${n.kind}${n.stance ? `:${n.stance}` : ""}] (p${n.priority}) noteId=${n.id} · ${n.content.slice(0, 180)}`,
          )
          .join("\n");

  // ─── Camada 3 — DS (decisions/open questions/business/active sessions) ───
  const businessCtx = agentContext.businessContext as
    | {
        businessModel: string | null;
        stage: string | null;
        icp: string | null;
        ticketRangeBrl: string | null;
        runwayMonths: number | null;
      }
    | null;
  const businessBlock = businessCtx
    ? [
        `Modelo: ${businessCtx.businessModel ?? "?"}`,
        `Stage: ${businessCtx.stage ?? "?"}`,
        `ICP: ${businessCtx.icp ?? "?"}`,
        `Ticket: ${businessCtx.ticketRangeBrl ?? "?"}`,
        `Runway: ${businessCtx.runwayMonths ?? "?"} meses`,
      ].join(" · ")
    : "(business context não preenchido)";

  const activeDecisions = (agentContext.activeDecisions as Array<{
    id: string;
    statement: string;
    rationale: string;
    confidence: string;
    tags: string[] | null;
  }>) ?? [];
  const decisionsBlock =
    activeDecisions.length === 0
      ? "(nenhuma)"
      : activeDecisions
          .slice(0, 12)
          .map(
            (d) =>
              `- [${d.confidence}] ${d.statement}${d.rationale ? ` — ${d.rationale.slice(0, 120)}` : ""}`,
          )
          .join("\n");

  const openQuestions = (agentContext.openQuestions as Array<{
    id: string;
    question: string;
    blocksWhat: string | null;
  }>) ?? [];
  const openQuestionsBlock =
    openQuestions.length === 0
      ? "(nenhuma)"
      : openQuestions
          .slice(0, 10)
          .map(
            (q) =>
              `- ${q.question}${q.blocksWhat ? ` (bloqueia: ${q.blocksWhat})` : ""}`,
          )
          .join("\n");

  const activeDesignSessions = (agentContext.activeDesignSessions as Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    memoryAbstract: string | null;
  }>) ?? [];
  const designSessionsBlock =
    activeDesignSessions.length === 0
      ? "(nenhuma DS ativa)"
      : activeDesignSessions
          .slice(0, 8)
          .map(
            (s) =>
              `- ${s.title} (${s.type}/${s.status})${s.memoryAbstract ? ` — ${s.memoryAbstract.slice(0, 120)}` : ""}`,
          )
          .join("\n");

  const projectMemoryMd = agentContext.projectMemoryMd as string | null;

  // ─── Camada 2 — Sistema (sprint atual + tasks + blockers) ─────────────────
  const sprintScopeTasks = (agentContext.sprintScopeTasks as Array<{
    id: string;
    reference: string | null;
    title: string;
    status: string;
    functionPoints: number | null;
    priority: number;
    sprintId: string | null;
  }>) ?? [];
  const tasksByStatus: Record<string, number> = {};
  let totalFp = 0;
  let doneFp = 0;
  for (const t of sprintScopeTasks) {
    tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1;
    totalFp += t.functionPoints ?? 0;
    if (t.status === "done") doneFp += t.functionPoints ?? 0;
  }
  const sprintScopeBlock =
    sprintScopeTasks.length === 0
      ? "(sem tasks na sprint atual)"
      : `${sprintScopeTasks.length} tasks · ${doneFp}/${totalFp} FP done · status: ${Object.entries(
          tasksByStatus,
        )
          .map(([s, c]) => `${s}=${c}`)
          .join(" ")}`;

  const sprintBlockers = (agentContext.sprintBlockers as Array<{
    taskId: string;
    dependsOn: string;
    kind: string;
  }>) ?? [];

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
    project_direction, next_step, risk, need, team_signal, open_decision,
    milestone}. Use \`summary\` para um panorama curto que abre o report.
  • RISCO: toda note kind=\`risk\` leva \`stance\` — a postura dirige o health
    do projeto no portfólio. managed = mitigação em curso; needs_action =
    PM/time precisa agir; escalate = fora da alçada, escalar já. Não infle:
    risco com plano rodando é managed.
  • MARCO DO PROJETO: registre no máximo 1 note kind=\`milestone\` por review —
    o próximo marco relevante do projeto (go-live, entrega de fase, demo,
    homologação), com \`dueAt\` (YYYY-MM-DD) e content curto (ex.: "Go-live
    homologação"). Vira chip no Overview de projetos. Extraia de transcripts
    e decisões; se nenhuma data-marco existir nas fontes, não invente.
  • Quando o PM pedir "atualiza o report" / "gera o report" / "sintetiza":
    1. Chame \`get_project_indicators\` PRIMEIRO — alimenta a seção
       "Indicadores do time" com velocity das últimas sprints, throughput,
       blockers ativos. Sem isso a seção fica fraca.
    2. Se houver \`transcriptRefId\` listado em "Fontes de contexto linkadas"
       e VOCÊ ainda não leu, chame \`read_transcript_content\` neles antes
       de sintetizar.
    3. Aí sim, chame \`update_pm_review_report\` com markdown direto
       organizado nas 6 seções fixas. Cite source IDs (transcriptRefId /
       meetingId) e referencie decisões/questões abertas do contexto DS
       (blocos abaixo) quando relevante.
    4. O \`executiveDigest\` (mesma call) é a visão de PORTFÓLIO: o que um
       executivo que tem 20 segundos precisa saber. Cure — não despeje as
       notes. Frases curtas, autocontidas, sem markdown.
  • Read first, write later. NUNCA sintetize report sem antes ter pelo menos:
    1 transcript lido OU 3 notes ativas OU indicadores buscados.

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

  const volatile = `## Camada Sistema — Sprint atual

### Tasks da sprint
${sprintScopeBlock}

### Bloqueios detectados
${sprintBlockers.length === 0 ? "(nenhum)" : `${sprintBlockers.length} dependência(s) ativa(s)`}

### Sprints próximas
${upcomingBlock}

### Squad
${squadBlock}

## Camada DS — Decisões, questões e sessões ativas

### Business context
${businessBlock}

### Decisões ativas (curadas pelo Vitor)
${decisionsBlock}

### Questões em aberto
${openQuestionsBlock}

### Design Sessions ativas
${designSessionsBlock}

${projectMemoryMd ? `### Memória do projeto (curada pelo Vitor)\n${projectMemoryMd.slice(0, 4000)}\n` : ""}`;

  return { stable, volatile };
}

// ─── Tools ────────────────────────────────────────────────────────────────

export function buildPMReviewTools(pmReviewId: string, projectId: string) {
  return {
    read_transcript_content: tool({
      description:
        "Lê o conteúdo de um transcript linkado. Use para extrair insights antes de criar notas.",
      inputSchema: z.object({
        transcriptRefId: z.string().describe("ID do TranscriptRef"),
      }),
      execute: async ({ transcriptRefId }) => {
        const { data: ref } = await db()
          .from("ContextSource")
          .select('id, title, source, "sourceId", "capturedAt", "meetingId", "fullText"')
          .eq("id", transcriptRefId)
          .single();
        if (!ref) return { ok: false, error: "ContextSource não encontrado" };
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
              "team_signal (capacidade/moral/blockers), open_decision (decisão em aberto), " +
              "milestone (próximo marco do projeto — exige dueAt).",
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
        dueAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Data do marco (YYYY-MM-DD). Obrigatória quando kind=milestone."),
        stance: z
          .enum(PM_REVIEW_RISK_STANCES as [PMReviewRiskStance, ...PMReviewRiskStance[]])
          .optional()
          .describe(
            "Postura do risco. OBRIGATÓRIA quando kind=risk; não use em outros kinds. " +
              "managed (mitigação em curso / sob controle — não derruba o health do projeto), " +
              "needs_action (exige ação do PM/time esta semana — amber no portfólio), " +
              "escalate (fora da alçada do time, exige escalação humana JÁ — red no portfólio). " +
              "Risco com plano de mitigação rodando é managed, não escalate.",
          ),
      }),
      execute: async ({ kind, content, sourceMeetingIds, sourceTranscriptIds, priority, dueAt, stance }) => {
        if (kind === "milestone" && !dueAt) {
          return { ok: false, error: "kind=milestone exige dueAt (YYYY-MM-DD)." };
        }
        if (kind === "risk" && !stance) {
          return {
            ok: false,
            error: "kind=risk exige stance (managed | needs_action | escalate).",
          };
        }
        if (stance && kind !== "risk") {
          return { ok: false, error: "stance só se aplica a kind=risk." };
        }
        const note = await addPMReviewNote({
          pmReviewId,
          kind,
          content,
          sourceMeetingIds: sourceMeetingIds ?? [],
          sourceTranscriptIds: sourceTranscriptIds ?? [],
          priority: priority ?? 5,
          dueAt: dueAt ?? null,
          stance: stance ?? null,
          generatedByAgent: "vitoria",
        });
        return { ok: true, noteId: note.id, kind: note.kind };
      },
    }),

    update_pm_review_report: tool({
      description:
        "Grava o markdown SINTETIZADO do report do PM Review + o digest executivo. Substitui os anteriores. " +
        "Estrutura sugerida do markdown (mas pode variar conforme o contexto):\n" +
        "  ## Rumo do projeto\n  ## Próximos passos\n  ## Riscos\n  ## Necessidades\n" +
        "  ## Indicadores do time\n  ## Decisões em aberto\n" +
        "Cite source IDs (transcriptRef / meeting) inline quando relevante.\n" +
        "O executiveDigest alimenta o Overview de projetos (cards compactos): " +
        "frases curtas e autocontidas, sem markdown, o item mais crítico primeiro.",
      inputSchema: z.object({
        markdown: z
          .string()
          .min(50)
          .describe("Markdown completo do report (substitui o anterior)."),
        executiveDigest: z
          .object({
            panorama: z
              .string()
              .min(20)
              .describe(
                "2-3 frases: estado do projeto + rumo. É a primeira coisa que o gestor lê no portfólio.",
              ),
            risks: z
              .array(z.string().min(10))
              .describe(
                "Até 3 riscos que importam pra um executivo, mais crítico primeiro — a ordem " +
                  "comunica criticidade; NÃO escreva prefixos tipo 'CRÍTICO —'. UMA frase " +
                  "(~140 caracteres) por risco. Vazio se não há.",
              ),
            nextSteps: z
              .array(z.string().min(10))
              .describe(
                "Até 3 próximos passos da semana, mais relevante primeiro. UMA frase por item.",
              ),
            decisions: z
              .array(z.string().min(10))
              .describe(
                "Até 3 decisões/necessidades APENAS PENDENTES esperando o gestor humano — " +
                  "resolvida não entra no digest. UMA frase por item, sem prefixos de status. " +
                  "Vazio se não há.",
              ),
          })
          .describe(
            "Visão executiva curada — NÃO é resumo mecânico das notes: selecione e reescreva pro portfólio.",
          ),
      }),
      execute: async ({ markdown, executiveDigest }) => {
        const updated = await updatePMReview(pmReviewId, {
          reportMarkdown: markdown,
          reportGeneratedAt: new Date().toISOString(),
        });
        // Digest nasce junto do report (mesma call) — clamp de 3 por slot
        // fica aqui, não no schema (Anthropic recusa maxItems em arrays).
        const digestCount = await replaceExecutiveDigest(pmReviewId, [
          { kind: "summary" as const, content: executiveDigest.panorama },
          ...executiveDigest.risks
            .slice(0, 3)
            .map((content) => ({ kind: "risk" as const, content })),
          ...executiveDigest.nextSteps
            .slice(0, 3)
            .map((content) => ({ kind: "next_step" as const, content })),
          ...executiveDigest.decisions
            .slice(0, 3)
            .map((content) => ({ kind: "open_decision" as const, content })),
        ]);
        return {
          ok: true,
          pmReviewId,
          length: markdown.length,
          digestCount,
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
