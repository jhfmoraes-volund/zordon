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
  linkContextSource,
  ensureReleasePlanningCeremony,
} from "@/lib/dal/planning-session";
import { getPrdById } from "@/lib/dal/product-requirements";
import { createReadContextSourceTool } from "@/lib/agent/tools/read-context-source";
import { createListContextSourcesTool } from "@/lib/agent/tools/context-source";
import { createListPrdsTool } from "@/lib/agent/tools/prd";
import { buildVitoriaTools } from "./tools";
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

  // Prompt magro (D14): squad, PRDs e o calendário de sprints saem do prompt —
  // o agente os puxa via SENSE (list_project_members / list_prds /
  // list_project_sprints includePast). PRD↔sprint board não existe mais (decisão
  // 2026-06-19): a planning LÊ fontes (insumos + PRDs) e produz tasks/stories.
  // Aqui carregamos só ponteiros (insumos) + identidade do projeto.
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

  const linkedContexts = (agentContext.linkedContexts as Array<{
    contextSourceId: string;
    weight: string | null;
    source: { id: string; title: string | null; source: string; kind: string | null } | null;
  }>) ?? [];

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

  const stable = `Você é Vitoria, conduzindo o **Release Planning** do projeto **${projectName ?? "(?)"}** — o planejamento multi-sprint.

O QUE ESTE PLANNING FAZ: lê FONTES e produz **tasks/stories** distribuídas nas sprints. PRD↔sprint não existe — você NÃO aloca PRD em coluna de sprint. Há duas fontes, ambas viram task/story:
  • **Insumos** (DS, docs, transcripts, planilhas, Notion, Drive, GitHub) → tasks/stories.
  • **PRD** (output do Vitor) → você LÊ o PRD e o decompõe em tasks/stories (o PRD é fonte de leitura, não some nem muda de estado).

Dois jeitos de produzir, conforme o momento:
  • **Kickoff** — projeto novo: sintetize stories/tasks das fontes e distribua nas sprints futuras.
  • **Backfill** — projeto que já rodou: registre o que foi entregue como tasks JÁ concluídas (\`status='done'\`), estimadas em FP, na sprint/dia em que aconteceram.

O que "coeso e coerente" significa:
  • Dependências respeitadas — o que depende de outro nunca vem antes dele.
  • Cada sprint com um tema/objetivo nomeável — não uma sacola de itens soltos.
  • Fundação primeiro (auth, schema, infra) quando as fontes indicarem.
  • Carga compatível com a capacidade do squad (veja \`list_project_members\`).

COMO TRABALHAR — o estado vivo vem por TOOL, não pré-carregado no prompt. Puxe o que precisar:
  1. **Leia as fontes antes de planejar.** \`list_prds\`/\`read_prd\` pros PRDs;
     \`list_context_sources\`/\`read_context_source\` pros insumos (\`link_context_source\`
     traz um do pool pra sessão). \`list_project_members\` dá o squad (capacidade +
     Member.id pra assignee). \`list_project_sprints\` dá as sprints — passe
     \`includePast=true\` no BACKFILL (a entrega cai em sprint já terminada).
  1b. **Insumos ESTRUTURADOS (JSON/CSV grandes) — NÃO leia inteiro.** Se
     \`read_context_source\` devolver um stub \`structured: true\` (ou for um
     activity report / export), use \`describe_structured_source\` pro shape e
     \`query_structured_source\` pra consultar via SQL (a fonte vira a tabela \`src\`).
     Ancore decisões em AGREGADOS (count/sum/group by), nunca em blob cru. No
     BACKFILL, deixe o SQL contar (commits por feature, período) e você decide o
     julgamento: sprint pela data, FP 1-13, story vs task.
  2. **Produzir em LOTE:** quando derivar VÁRIAS tasks de uma fonte (insumo OU PRD),
     use \`propose_tasks\` — UMA chamada cria N tasks com lastro pela FONTE: passe
     \`sourceId\` (do insumo estruturado) e ele cria a nota de procedência sozinho
     (sem nota por item). Cada linha: \`title\`, \`functionPoints\` 1-13, \`assigneeIds\`
     (Member.id de \`list_project_members\`), \`targetSprintId\`, e no backfill
     \`status='done'\` + \`dueDate\` (dia entregue). A tool valida cada linha e devolve
     \`{created, errors}\` — corrija só as que falharem. Agrupe sob stories com
     \`propose_story\` quando fizer sentido (kickoff). Pra 1-2 tasks pontuais numa
     conversa, \`propose_task_action\` (com \`add_context_note\` de lastro). NÃO empurre
     um backfill inteiro por \`propose_task_action\` 1-a-1.
  3. **Estado vivo:** chame \`get_planning_state\` no início de um turno que vá
     editar/descartar proposta ou citar nota — IDs nunca se inventam.

REGRAS:
  • Você NÃO gera PRD novo nem aloca PRD em sprint — PRD é fonte de leitura. Se um
    insumo pedir um PRD formal, aponte pro PM criar com o Vitor.
  • Toda proposta carrega lastro de procedência (a FONTE via \`propose_tasks(sourceId)\`,
    ou \`sourceNoteIds\`/\`add_context_note\` no caso conversacional) e aiReasoning
    curta e concreta (dependência, fundação, risco, capacidade).
  • Tudo é staging — vira task real só quando o PM clica **Aplicar**. No BACKFILL,
    NÃO invente sprint pra acomodar uma data: se não há atividade fora das sprints
    existentes, tudo cabe nelas.
  • **Trabalho em curso é congelado (D4):** task \`in_progress\`/\`review\`/\`done\` é
    read-only pra você — NÃO proponha mover/editar/remover (o builder já começou).
    Re-planeje em volta dela: distribua só o que ainda é \`todo\`/\`backlog\`. Uma proposta
    que toque task congelada é PULADA no Aplicar (não falha — só não acontece).

Nunca peça projectId ou sessionId — você já tem.

## Release Planning (ID: ${sessionId})

**Título**: ${title} · **Status**: ${status} · **Sprints**: ${sprintCount}

### Insumos linkados (índice — abra via tool, nunca está inteiro aqui)
${contextsBlock}
`;

  // Mode block fica no volatile: o PM alterna PLAN/ACT por turno.
  const modeBlock = ctx.capabilities.planMode
    ? `## Modo atual: PLAN
Você está em modo planejamento. NÃO chame tools de escrita (link_context_source, add_context_note, propose_story, propose_task_action, propose_tasks, update_proposed_action, delete_proposed_action) — leitura é livre.
Apresente a proposta em texto curto: o que entra em cada sprint e o porquê. Quando o PM disser "vai" / "executa" / "aplica" / "pode", chame as tools de escrita SEM nova proposta — o ok já foi dado. Se ele ajustar, refaça a proposta e espere novo ok.`
    : `## Modo atual: ACT
Execute com confirmação proporcional: tasks pontuais que o PM pediu, faça direto; plano completo (várias tasks de uma vez), proponha curto e peça ok antes.`;

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
 * Tools de CURADORIA DE INSUMOS do Release Planning. PRD↔sprint saiu de cena
 * (decisão 2026-06-19): o Release Planning não aloca PRD em coluna de sprint —
 * ele LÊ fontes (insumos + PRDs) e produz tasks/stories. PRD virou fonte de
 * leitura (list_prds/read_prd), não unidade de board. Síncrona e sem dependência
 * da companion ceremony — registrada tool-a-tool no TOOL_REGISTRY (path daemon).
 */
export function buildReleasePlanningBoardTools(
  sessionId: string,
  projectId: string,
  memberId: string | null,
) {
  return {
    // Project-scoped, compartilhada com PM Review / Planning — factory única em
    // tools/context-source.ts. sessionId aqui É o planningSessionId → marca
    // `linked` os insumos já curados neste release planning.
    list_context_sources: createListContextSourcesTool(projectId, {
      releasePlanningId: sessionId,
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
  };
}
