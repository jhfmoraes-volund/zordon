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
} from "@/lib/dal/planning-session";
import { getPrdsForProject, getPrdById } from "@/lib/dal/product-requirements";
import { createReadContextSourceTool } from "@/lib/agent/tools/read-context-source";
import { buildProjectProfile } from "./profile";
import type { Database } from "@/lib/supabase/database.types";
import type { PromptContext, SystemPrompt } from "../../types";

type PrdDependency = { prdId: string; kind: string };

// ─── Context loader ───────────────────────────────────────────────────────

export async function loadReleasePlanningContext(
  sessionId: string,
  memberId?: string | null,
) {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`PlanningSession ${sessionId} não encontrada`);

  const projectId = session.projectId;
  const supabase = db();

  // Insumos linkados (EntityLink → ContextSource). Mesma forma do Planning.
  const linkedContextsRes = await supabase
    .from("EntityLink")
    .select(
      `contextSourceId, weight,
       source:ContextSource!EntityLink_contextSourceId_fkey(id, title, source, kind, capturedAt)`,
    )
    .eq("planningSessionId", sessionId)
    .not("contextSourceId", "is", null);

  const [project, profile, projectMem, prdUniverse] = await Promise.all([
    supabase
      .from("Project")
      .select(
        "id, name, referenceKey, status, repoUrl, githubRepoOwner, githubRepoName, githubDefaultBranch, repoManifest",
      )
      .eq("id", projectId)
      .maybeSingle(),
    buildProjectProfile(projectId, { currentSprintId: null }),
    supabase
      .from("Project")
      .select("memoryMd, memoryVersion")
      .eq("id", projectId)
      .maybeSingle(),
    getPrdsForProject(projectId, { status: ["approved", "review", "draft"] }),
  ]);

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
    // PRDs já no board (assignments atuais)
    assignedPrds: session.prds,
    // PRDs do projeto que podem ser vinculados
    prdUniverse: prdUniverse.map((p) => ({
      id: p.id,
      reference: p.reference,
      title: p.title,
      status: p.status,
      oneLiner: p.oneLiner,
      dependencies: (p.dependencies as PrdDependency[] | null) ?? [],
    })),
    linkedContexts: linkedContextsRes.data ?? [],
    upcomingSprints: profile.core.upcomingSprints,
    squadMembers: profile.core.squadMembers,
    projectMemoryMd: projectMem.data?.memoryMd ?? null,
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

  const prdUniverse = (agentContext.prdUniverse as Array<{
    id: string;
    reference: string;
    title: string;
    status: string;
    oneLiner: string;
    dependencies: PrdDependency[];
  }>) ?? [];

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

  const refById = new Map(prdUniverse.map((p) => [p.id, p.reference]));
  const prdUniverseBlock =
    prdUniverse.length === 0
      ? "(nenhum PRD no projeto — peça pro PM gerar PRDs com o Vitor antes)"
      : prdUniverse
          .map((p) => {
            const deps = p.dependencies
              .map((d) => `${d.kind}→${refById.get(d.prdId) ?? d.prdId}`)
              .join(", ");
            const lines = [
              `- ${p.reference} [${p.status}] productRequirementId=${p.id} · ${p.title}`,
            ];
            if (p.oneLiner) lines.push(`  ${p.oneLiner}`);
            if (deps) lines.push(`  deps: ${deps}`);
            return lines.join("\n");
          })
          .join("\n");

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

  const stable = `Você é Vitoria, conduzindo o **Release Planning** do projeto **${projectName ?? "(?)"}** — o momento inicial do projeto, onde o backlog de PRDs vira um roadmap de **${sprintCount} sprints** coesas e coerentes.

O que "coesa e coerente" significa:
  • Dependências respeitadas — PRD que depende de outro nunca vem antes dele.
  • Cada sprint tem um tema/objetivo nomeável — não uma sacola de itens soltos.
  • Fundação primeiro (auth, schema, infra) quando PRDs ou insumos indicarem.
  • Carga distribuída de forma compatível com a capacidade do squad.

COMO TRABALHAR:
  1. **Leia antes de alocar.** \`read_prd\` traz o conteúdo completo de um PRD
     (problema, objetivo, AC, dependências, riscos). \`read_context_source\` lê
     qualquer insumo linkado (transcript, doc, planilha, Notion, Drive, GitHub).
  2. **Garimpe o pool do projeto.** \`list_context_sources\` mostra TODOS os
     insumos do projeto, inclusive não-linkados. Achou um doc relevante? Use
     \`link_context_source\` pra trazê-lo pra esta sessão (fica visível pro PM).
  3. **Monte o board.** \`link_prd_to_sprint\` (exige justification),
     \`move_prd\`, \`unlink_prd\`. Cada vínculo é staging — o plano só "fecha"
     quando o PM aprova (status → approved).
  4. **Quantidade de sprints é negociável.** Se o escopo não cabe (ou sobra),
     proponha ajustar e use \`set_sprint_count\` — explique o porquê antes.

REGRAS:
  • A FONTE de funcionalidades são os PRDs existentes (ProductRequirement). Você
    NÃO inventa PRD novo. Se um insumo revelar funcionalidade sem PRD, aponte o
    buraco pro PM criar com o Vitor — não aloque o que não existe.
  • Toda alocação carrega justification curta e concreta (dependência, fundação,
    risco, capacidade). Ela aparece no board pro PM.
  • Sprints vão de 1 a ${sprintCount}. Nunca aloque além disso (a menos que
    ajuste via set_sprint_count primeiro).
  • Quando o board estiver vazio e o PM pedir uma proposta, monte o plano
    completo: leia os PRDs e insumos primeiro, depois aloque sprint a sprint
    narrando o racional.

Nunca peça projectId ou sessionId — você já tem.

## Estado atual do Release Planning (ID: ${sessionId})

**Título**: ${title}
**Status**: ${status}
**Sprints**: ${sprintCount}

### PRDs já no board
${assignedBlock}

### PRDs do projeto disponíveis pra vincular
${prdUniverseBlock}

### Insumos linkados (contexto)
${contextsBlock}
`;

  const upcomingSprints = (agentContext.upcomingSprints as Array<{
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
  }>) ?? [];
  const upcomingBlock =
    upcomingSprints.length === 0
      ? "(nenhuma sprint cadastrada)"
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

  // Mode block fica no volatile: o PM alterna PLAN/ACT por turno.
  const modeBlock = ctx.capabilities.planMode
    ? `## Modo atual: PLAN
Você está em modo planejamento. NÃO chame tools de escrita (link_prd_to_sprint, move_prd, unlink_prd, link_context_source, set_sprint_count) — leitura é livre.
Apresente a proposta em texto curto: alocação por sprint com o porquê. Quando o PM disser "vai" / "executa" / "aplica" / "pode", chame as tools de escrita SEM nova proposta — o ok já foi dado. Se ele ajustar o plano, refaça a proposta e espere novo ok.`
    : `## Modo atual: ACT
Execute com confirmação proporcional: alocações pontuais que o PM pediu, faça direto; plano completo (3+ PRDs de uma vez) ou set_sprint_count, proponha curto e peça ok antes.`;

  const volatile = `${modeBlock}

## Sprints do projeto
${upcomingBlock}

## Squad (capacidade)
${squadBlock}

${projectMemoryMd ? `## Memória do projeto (curada pelo Vitor)\n${projectMemoryMd.slice(0, 4000)}\n` : ""}`;

  return { stable, volatile };
}

// ─── Tools ────────────────────────────────────────────────────────────────

export function buildReleasePlanningTools(
  sessionId: string,
  projectId: string,
  memberId: string | null,
) {
  return {
    read_context_source: createReadContextSourceTool(),

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
        "Use o productRequirementId listado em 'PRDs do projeto disponíveis'. " +
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
