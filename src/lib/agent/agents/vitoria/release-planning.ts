/**
 * Vitoria — modo Release Planning.
 *
 * Mesmo agent que opera Planning/PM Review, com outro "surface": despachado por
 * `params.surface === 'release_planning'` em vitoria/index.ts.
 *
 * Missão: o momento inicial do projeto — transformar o backlog de PRDs (output
 * do Vitor) em N sprints coesas e coerentes, usando insumos de qualquer
 * natureza (transcripts, docs, planilhas, Notion, Drive, GitHub) como CONTEXTO.
 * Dois modos:
 *   • Conversacional (in-the-loop): o PM conversa, Vitoria lê PRDs/insumos e
 *     vincula/move PRDs no board via tools. Editar vira status='in-review'.
 *   • Automático: a cascata (orchestrate) roda separada — não usa este surface.
 *
 * Diferenças de comportamento:
 *   • NÃO gera PRD novo (insumos são contexto, não fonte de PRD).
 *   • Lê conteúdo completo via read_prd / read_context_source; descobre insumos
 *     não-linkados via list_context_sources e cura com link_context_source.
 *   • Toda alocação carrega justification (PlanningSessionPRD.agentJustification).
 *   • Pode propor ajuste da quantidade de sprints via set_sprint_count.
 */
import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  getSession,
  addLinkedPrd,
  removeLinkedPrd,
  updatePrdAssignment,
  updateStatus,
  updateSession,
  linkContextSource,
  ensureReleasePlanningCeremony,
} from "@/lib/dal/planning-session";
import { getPrdById } from "@/lib/dal/product-requirements";
import { createReadContextSourceTool } from "@/lib/agent/tools/read-context-source";
import { createListPrdsTool } from "@/lib/agent/tools/prd";
import { buildVitoriaTools } from "./tools";
import type { Database } from "@/lib/supabase/database.types";
import type { PromptContext, SystemPrompt } from "../../types";

// ─── Context loader ───────────────────────────────────────────────────────

export async function loadReleasePlanningContext(
  sessionId: string,
  memberId?: string | null,
) {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`PlanningSession ${sessionId} não encontrada`);

  const projectId = session.projectId;
  const supabase = db();

  // Insumos linkados (EntityLink → ContextSource) — só o ÍNDICE (ponteiro), nunca
  // o conteúdo. O agente abre via read_context_source / describe_structured_source.
  const linkedContextsRes = await supabase
    .from("EntityLink")
    .select(
      `contextSourceId, weight,
       source:ContextSource!EntityLink_contextSourceId_fkey(id, title, source, kind, capturedAt)`,
    )
    .eq("planningSessionId", sessionId)
    .not("contextSourceId", "is", null);

  // Prompt magro (D14/Fase 3.0): squad, universo de PRDs e o calendário de sprints
  // saíram do prompt — o agente os puxa via SENSE (list_project_members / list_prds /
  // list_project_sprints includePast). Aqui carregamos só o que é estado de board
  // (PRDs já alocados) + ponteiros (insumos) + identidade do projeto.
  const project = await supabase
    .from("Project")
    .select(
      "id, name, referenceKey, status, repoUrl, githubRepoOwner, githubRepoName, githubDefaultBranch, repoManifest, memoryMd",
    )
    .eq("id", projectId)
    .maybeSingle();

  const projectRow = project.data;

  return {
    surface: "release_planning" as const,
    sessionId,
    status: session.status,
    title: session.title,
    sprintCount: session.sprintCount,
    projectId,
    projectName: projectRow?.name ?? null,
    projectReferenceKey: projectRow?.referenceKey ?? null,
    projectRepoOwner: projectRow?.githubRepoOwner ?? null,
    projectRepoName: projectRow?.githubRepoName ?? null,
    projectRepoBranch: projectRow?.githubDefaultBranch ?? null,
    projectRepoManifest: projectRow?.repoManifest ?? null,
    // PRDs já no board (estado atual — pequeno). O UNIVERSO de PRDs disponíveis
    // o agente descobre via list_prds (não pré-carregado).
    assignedPrds: session.prds,
    linkedContexts: linkedContextsRes.data ?? [],
    projectMemoryMd: projectRow?.memoryMd ?? null,
    memberId: memberId ?? null,
  };
}

// ─── Prompt ───────────────────────────────────────────────────────────────

export function buildReleasePlanningPrompt(ctx: PromptContext): SystemPrompt {
  const { agentContext } = ctx;
  const sessionId = agentContext.sessionId as string;
  const status = agentContext.status as string;
  const title = agentContext.title as string;
  const sprintCount = agentContext.sprintCount as number;
  const projectName = agentContext.projectName as string | null;

  const assignedPrds = (agentContext.assignedPrds as Array<{
    id: string;
    sprintStart: number;
    sprintCount: number;
    order: number;
    prdSlug: string | null;
    productRequirementId: string | null;
    productRequirement: { reference: string; title: string; status: string } | null;
  }>) ?? [];

  const linkedContexts = (agentContext.linkedContexts as Array<{
    contextSourceId: string;
    weight: string | null;
    source: { id: string; title: string | null; source: string; kind: string | null } | null;
  }>) ?? [];

  const assignedBlock =
    assignedPrds.length === 0
      ? "(board vazio — nenhum PRD vinculado ainda)"
      : assignedPrds
          .map((p) => {
            const label = p.productRequirement
              ? `${p.productRequirement.reference} · ${p.productRequirement.title}`
              : (p.prdSlug ?? "(?)");
            return `- prdRowId=${p.id} · sprint ${p.sprintStart}-${p.sprintStart + p.sprintCount - 1} · ${label}`;
          })
          .join("\n");

  const contextsBlock =
    linkedContexts.length === 0
      ? "(nenhum insumo linkado)"
      : linkedContexts
          .map((l) => {
            const s = l.source;
            if (!s) return null;
            return `- contextSourceId=${s.id} · ${s.kind ?? s.source} · ${s.title ?? "(sem título)"}`;
          })
          .filter(Boolean)
          .join("\n");

  const projectMemoryMd = agentContext.projectMemoryMd as string | null;

  const stable = `Você é Vitoria, conduzindo o **Planning** do projeto **${projectName ?? "(?)"}** — o planejamento multi-sprint: distribuir o trabalho em **${sprintCount} sprints** coesas e coerentes.

Você opera em três modos, conforme o insumo. PRD é UMA das fontes de trabalho, não a única — story e task podem nascer de qualquer insumo:
  • **Roadmap de PRDs** — há PRDs (output do Vitor): descubra-os via \`list_prds\` e monte o board ligando PRD↔sprint via \`link_prd_to_sprint\`.
  • **Kickoff** — projeto novo sem PRD ainda: sintetize stories/tasks direto dos insumos (DS, docs, transcripts) e distribua nas sprints.
  • **Backfill** — projeto que já rodou (ex: importado do Notion): registre o que foi entregue como tasks JÁ concluídas (\`status='done'\`), estimadas em FP, na sprint/dia em que aconteceram.

O que "coesa e coerente" significa:
  • Dependências respeitadas — o que depende de outro nunca vem antes dele.
  • Cada sprint tem um tema/objetivo nomeável — não uma sacola de itens soltos.
  • Fundação primeiro (auth, schema, infra) quando PRDs ou insumos indicarem.
  • Carga distribuída de forma compatível com a capacidade do squad (veja \`list_project_members\`).

COMO TRABALHAR — o estado vivo vem por TOOL, não pré-carregado no prompt. Puxe o que precisar:
  1. **Leia antes de planejar.** \`list_prds\` lista os PRDs do projeto; \`read_prd\`
     traz o conteúdo completo de um. \`list_context_sources\` mostra TODO o pool de
     insumos (linkados e não); \`read_context_source\` abre um; \`link_context_source\`
     traz um pra esta sessão. \`list_project_members\` dá o squad (capacidade +
     Member.id pra assignee). \`list_project_sprints\` dá as sprints — passe
     \`includePast=true\` no BACKFILL (a entrega cai em sprint já terminada).
  1b. **Insumos ESTRUTURADOS (JSON/CSV grandes) — NÃO leia inteiro.** Se
     \`read_context_source\` devolver um stub \`structured: true\` (ou for um
     activity report / export), use \`describe_structured_source\` pro shape
     (colunas/tipos/contagem) e \`query_structured_source\` pra consultar via SQL
     (a fonte vira a tabela \`src\`). Ancore decisões em AGREGADOS (count/sum/group
     by), nunca em leitura de blob cru. No BACKFILL, deixe o SQL contar (commits
     por feature, período) e você decide o julgamento: sprint pela data, FP 1-13,
     story vs task.
  2. **Roadmap de PRDs:** \`link_prd_to_sprint\` (exige justification),
     \`move_prd\`, \`unlink_prd\`.
  3. **Criar trabalho em LOTE (kickoff/backfill):** quando derivar VÁRIAS tasks de
     uma fonte, use \`propose_tasks\` — UMA chamada cria N tasks com lastro pela
     FONTE: passe \`sourceId\` do insumo e ele cria a nota de procedência sozinho
     (sem nota por item). Cada linha: \`title\`, \`functionPoints\` 1-13,
     \`assigneeIds\` (Member.id de \`list_project_members\`), \`targetSprintId\`, e no
     backfill \`status='done'\` + \`dueDate\` (dia entregue). A tool valida cada linha
     e devolve \`{created, errors}\` — corrija só as que falharem. Pra 1-2 tasks
     pontuais numa conversa, use \`propose_task_action\` (com \`add_context_note\` de
     lastro). NÃO empurre um backfill inteiro por \`propose_task_action\` 1-a-1.
  4. **Estado vivo:** chame \`get_planning_state\` no início de um turno que vá
     editar/descartar proposta ou citar nota — IDs nunca se inventam.
  5. **Quantidade de sprints é negociável.** Não coube (ou sobrou)? Proponha e
     use \`set_sprint_count\` — explique o porquê antes. Mas no BACKFILL, NÃO crie
     sprints só pra acomodar uma data: se não há atividade fora das sprints
     existentes, tudo cabe nelas.

REGRAS:
  • PRDs são UMA fonte; você PODE sintetizar story/task direto de insumos quando
    fizer sentido (kickoff sem PRD, backfill de trabalho entregue). O que você NÃO
    faz é inventar PRD novo — se um insumo pedir um PRD formal, aponte pro PM criar
    com o Vitor.
  • Toda proposta carrega lastro de procedência (a FONTE via \`propose_tasks(sourceId)\`,
    ou \`sourceNoteIds\`/\`add_context_note\` no caso conversacional) e aiReasoning
    curta e concreta (dependência, fundação, risco, capacidade).
  • Sprints vão de 1 a ${sprintCount}. Nunca aloque além disso (a menos que
    ajuste via set_sprint_count primeiro).
  • Tudo é staging — o plano só "fecha" quando o PM aprova. Board vazio + pedido
    de proposta: leia PRDs/insumos primeiro, depois monte sprint a sprint narrando
    o racional.

Nunca peça projectId ou sessionId — você já tem.

## Estado atual do Release Planning (ID: ${sessionId})

**Título**: ${title}
**Status**: ${status}
**Sprints**: ${sprintCount}

### PRDs já no board
${assignedBlock}

### Insumos linkados (índice — abra via tool, nunca está inteiro aqui)
${contextsBlock}
`;

  // Mode block fica no volatile: o PM alterna PLAN/ACT por turno.
  const modeBlock = ctx.capabilities.planMode
    ? `## Modo atual: PLAN
Você está em modo planejamento. NÃO chame tools de escrita (link_prd_to_sprint, move_prd, unlink_prd, link_context_source, set_sprint_count, add_context_note, propose_story, propose_task_action, propose_tasks, update_proposed_action, delete_proposed_action) — leitura é livre.
Apresente a proposta em texto curto: alocação por sprint com o porquê. Quando o PM disser "vai" / "executa" / "aplica" / "pode", chame as tools de escrita SEM nova proposta — o ok já foi dado. Se ele ajustar o plano, refaça a proposta e espere novo ok.`
    : `## Modo atual: ACT
Execute com confirmação proporcional: alocações/tasks pontuais que o PM pediu, faça direto; plano completo (3+ PRDs ou várias tasks de uma vez) ou set_sprint_count, proponha curto e peça ok antes.`;

  const volatile = `${modeBlock}

${projectMemoryMd ? `## Memória do projeto (curada pelo Vitor)\n${projectMemoryMd.slice(0, 4000)}\n` : ""}`;

  return { stable, volatile };
}

// ─── Tools ────────────────────────────────────────────────────────────────

export async function buildReleasePlanningTools(
  sessionId: string,
  projectId: string,
  memberId: string | null,
) {
  // Companion ceremony (headless, sprintId NULL) hospeda o staging de
  // tasks/stories. Reusa o motor inteiro da Sprint Planning ligado ao mesmo
  // thread do board de PRDs — PRD vira UMA fonte, não a única.
  const companionCeremonyId = await ensureReleasePlanningCeremony(
    sessionId,
    projectId,
    memberId,
  );
  const taskTools = buildVitoriaTools(companionCeremonyId, projectId);

  return {
    ...taskTools,
    read_context_source: createReadContextSourceTool(),
    // PRD-universe saiu do prompt (D14/Fase 3.0) — o agente descobre via SENSE.
    list_prds: createListPrdsTool(projectId),

    read_prd: tool({
      description:
        "Lê o conteúdo completo de um PRD: problema, objetivo, jornada, AC, " +
        "dependências, riscos, notas técnicas e markdown. Use ANTES de decidir " +
        "em qual sprint um PRD entra.",
      inputSchema: z.object({
        productRequirementId: z.string().uuid().describe("ID do ProductRequirement"),
      }),
      execute: async ({ productRequirementId }) => {
        const prd = await getPrdById(productRequirementId);
        if (!prd) return { ok: false, error: "PRD não encontrado" };
        return {
          ok: true,
          reference: prd.reference,
          title: prd.title,
          status: prd.status,
          oneLiner: prd.oneLiner,
          problem: prd.problem,
          goal: prd.goal,
          userJourney: prd.userJourney,
          acceptanceCriteria: prd.acceptanceCriteria,
          outOfScope: prd.outOfScope,
          dependencies: prd.dependencies,
          technicalNotes: prd.technicalNotes,
          risksAndAssumptions: prd.risksAndAssumptions,
          markdown: prd.markdown ? prd.markdown.slice(0, 8000) : "",
        };
      },
    }),

    // Board tools (PRD↔sprint + curadoria de insumos) — extraídas pra serem
    // registradas individualmente no TOOL_REGISTRY (path daemon). Só dependem
    // de sessionId/projectId/memberId, não da companion ceremony.
    ...buildReleasePlanningBoardTools(sessionId, projectId, memberId),
  };
}

/**
 * As 6 tools de BOARD do Release Planning (vincular/mover/desvincular PRD,
 * ajustar nº de sprints, listar/linkar insumos). Síncrona e sem dependência da
 * companion ceremony — por isso pode ser registrada tool-a-tool no
 * TOOL_REGISTRY (path daemon), ao lado do staging (buildVitoriaTools) e do
 * read_prd/read_context_source genéricos.
 */
export function buildReleasePlanningBoardTools(
  sessionId: string,
  projectId: string,
  memberId: string | null,
) {
  return {
    list_context_sources: tool({
      description:
        "Lista o pool de insumos do projeto (transcripts, docs, planilhas, " +
        "Notion, Drive, GitHub) — inclusive os ainda NÃO linkados a este " +
        "release planning. Use pra descobrir contexto além do que o PM linkou.",
      inputSchema: z.object({
        kind: z
          .string()
          .optional()
          .describe("Filtra por kind (ex: transcript, document, notion, gdrive_file)"),
      }),
      execute: async ({ kind }) => {
        let q = db()
          .from("ContextSource")
          .select("id, kind, title, source, capturedAt, summary")
          .eq("projectId", projectId)
          .order("capturedAt", { ascending: false, nullsFirst: false })
          .limit(50);
        if (kind) {
          q = q.eq("kind", kind as Database["public"]["Enums"]["context_source_kind"]);
        }
        const { data, error } = await q;
        if (error) return { ok: false, error: error.message };
        return { ok: true, sources: data ?? [] };
      },
    }),

    link_context_source: tool({
      description:
        "Linka um ContextSource do pool do projeto a este release planning — " +
        "vira insumo da sessão, visível pro PM na aba de contexto.",
      inputSchema: z.object({
        contextSourceId: z.string().uuid().describe("ID do ContextSource"),
      }),
      execute: async ({ contextSourceId }) => {
        const row = await linkContextSource(sessionId, contextSourceId, memberId);
        return { ok: true, linkId: row.id };
      },
    }),

    link_prd_to_sprint: tool({
      description:
        "Vincula um PRD (ProductRequirement) a uma sprint do release planning. " +
        "Use o productRequirementId — descubra-o via list_prds. " +
        "Vincular um PRD coloca o plano em staging (status='in-review').",
      inputSchema: z.object({
        productRequirementId: z.string().uuid().describe("ID do ProductRequirement"),
        sprintStart: z.number().int().min(1).max(12).describe("Sprint inicial (1-based)"),
        sprintCount: z
          .number()
          .int()
          .min(1)
          .max(6)
          .optional()
          .describe("Quantas sprints o PRD ocupa. Default 1."),
        justification: z
          .string()
          .min(1)
          .describe(
            "Por que este PRD entra NESTA sprint — dependência, fundação, risco ou capacidade. Curto e concreto; aparece no board.",
          ),
      }),
      execute: async ({ productRequirementId, sprintStart, sprintCount, justification }) => {
        const row = await addLinkedPrd(sessionId, productRequirementId, {
          sprintStart,
          sprintCount,
          justification,
        });
        // Vincular conversacionalmente tira o draft do limbo → staging.
        const session = await getSession(sessionId);
        if (session?.status === "draft") {
          await updateStatus(sessionId, "in-review");
        }
        return {
          ok: true,
          prdRowId: row.id,
          sprintStart: row.sprintStart,
          sprintCount: row.sprintCount,
        };
      },
    }),

    move_prd: tool({
      description:
        "Reposiciona um PRD já no board (muda sprint inicial, span ou ordem). " +
        "Use o prdRowId listado em 'PRDs já no board'.",
      inputSchema: z.object({
        prdRowId: z.string().uuid().describe("ID da row de PlanningSessionPRD"),
        sprintStart: z.number().int().min(1).max(12).optional(),
        sprintCount: z.number().int().min(1).max(6).optional(),
        order: z.number().int().min(0).optional(),
        justification: z
          .string()
          .optional()
          .describe("Novo porquê da posição, se o racional mudou."),
      }),
      execute: async ({ prdRowId, sprintStart, sprintCount, order, justification }) => {
        const row = await updatePrdAssignment(prdRowId, {
          sprintStart,
          sprintCount,
          order,
          ...(justification !== undefined ? { agentJustification: justification } : {}),
        });
        return { ok: true, prdRowId: row.id, sprintStart: row.sprintStart };
      },
    }),

    unlink_prd: tool({
      description:
        "Remove um PRD do board do release planning. Use o prdRowId. Não apaga o ProductRequirement.",
      inputSchema: z.object({
        prdRowId: z.string().uuid().describe("ID da row de PlanningSessionPRD"),
      }),
      execute: async ({ prdRowId }) => {
        await removeLinkedPrd(prdRowId);
        return { ok: true, prdRowId };
      },
    }),

    set_sprint_count: tool({
      description:
        "Ajusta a quantidade de sprints do release planning (1-12). Proponha e " +
        "explique o porquê ao PM antes de chamar.",
      inputSchema: z.object({
        sprintCount: z.number().int().min(1).max(12),
        reason: z.string().min(1).describe("Por que o escopo pede esse número de sprints"),
      }),
      execute: async ({ sprintCount, reason }) => {
        await updateSession(sessionId, { sprintCount });
        return { ok: true, sprintCount, reason };
      },
    }),
  };
}
