/**
 * Vitoria — modo Release Planning.
 *
 * Mesmo agent que opera Planning/PM Review, com outro "surface": despachado por
 * `params.surface === 'release_planning'` em vitoria/index.ts.
 *
 * Missão: organizar os PRDs (output do Vitor) ao longo das N sprints da
 * PlanningSession, usando os insumos linkados (reuniões/planilhas/repo) como
 * CONTEXTO. Dois modos:
 *   • Conversacional (in-the-loop): o PM conversa, Vitoria vincula/move PRDs no
 *     board incremental via tools. Editar vira status='in-review' (staging).
 *   • Automático: a cascata (orchestrate) roda separada — não usa este surface.
 *
 * Diferenças de comportamento:
 *   • NÃO gera PRD novo (insumos são contexto, não fonte de PRD).
 *   • Vincula ProductRequirement existentes via link_prd_to_sprint.
 *   • Move/desvincula via move_prd / unlink_prd.
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
} from "@/lib/dal/planning-session";
import { getPrdsForProject } from "@/lib/dal/product-requirements";
import { createReadContextSourceTool } from "@/lib/agent/tools/read-context-source";
import { buildProjectProfile } from "./profile";
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

  const prdUniverseBlock =
    prdUniverse.length === 0
      ? "(nenhum PRD no projeto — peça pro PM gerar PRDs com o Vitor antes)"
      : prdUniverse
          .map((p) => `- ${p.reference} [${p.status}] productRequirementId=${p.id} · ${p.title}`)
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

  const stable = `Você é Vitoria, organizando o **Release Planning** do projeto **${projectName ?? "(?)"}**.

Sua missão: distribuir os PRDs (funcionalidades já especificadas pelo Vitor) ao
longo de **${sprintCount} sprints**, formando um roadmap de release coerente —
respeitando dependências, capacidade do time e prioridade.

REGRAS:
  • A FONTE de funcionalidades são os PRDs existentes (ProductRequirement). Você
    NÃO inventa PRD novo. Se faltar PRD, diga ao PM pra criar com o Vitor.
  • Os insumos linkados (reuniões, planilhas, repositório) são CONTEXTO pra você
    sequenciar melhor — leia-os com \`read_context_source\` quando precisar
    entender prioridade/risco/dependência.
  • Pra montar o board: \`link_prd_to_sprint\` (vincula um PRD a uma sprint),
    \`move_prd\` (reposiciona), \`unlink_prd\` (remove). Cada vínculo é staging —
    o plano só "fecha" quando o PM aprova (status → approved).
  • Sprints vão de 1 a ${sprintCount}. Nunca aloque além disso.
  • Seja explícita sobre o porquê de cada alocação (dependência, esforço, risco).

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

  const volatile = `## Sprints do projeto
${upcomingBlock}

## Squad (capacidade)
${squadBlock}

${projectMemoryMd ? `## Memória do projeto (curada pelo Vitor)\n${projectMemoryMd.slice(0, 4000)}\n` : ""}`;

  return { stable, volatile };
}

// ─── Tools ────────────────────────────────────────────────────────────────

export function buildReleasePlanningTools(sessionId: string) {
  return {
    read_context_source: createReadContextSourceTool(),

    link_prd_to_sprint: tool({
      description:
        "Vincula um PRD (ProductRequirement) a uma sprint do release planning. " +
        "Use o productRequirementId listado em 'PRDs do projeto disponíveis'. " +
        "Vincular um PRD coloca o plano em staging (status='in-review').",
      inputSchema: z.object({
        productRequirementId: z.string().uuid().describe("ID do ProductRequirement"),
        sprintStart: z.number().int().min(1).describe("Sprint inicial (1-based)"),
        sprintCount: z
          .number()
          .int()
          .min(1)
          .max(6)
          .optional()
          .describe("Quantas sprints o PRD ocupa. Default 1."),
      }),
      execute: async ({ productRequirementId, sprintStart, sprintCount }) => {
        const row = await addLinkedPrd(sessionId, productRequirementId, {
          sprintStart,
          sprintCount,
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
        sprintStart: z.number().int().min(1).optional(),
        sprintCount: z.number().int().min(1).max(6).optional(),
        order: z.number().int().min(0).optional(),
      }),
      execute: async ({ prdRowId, sprintStart, sprintCount, order }) => {
        const row = await updatePrdAssignment(prdRowId, {
          sprintStart,
          sprintCount,
          order,
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
  };
}
