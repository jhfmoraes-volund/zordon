// PRD tools — factories pra MCP/daemon path. Espelham as definitions inline
// em src/lib/agent/agents/vitor/index.ts (path openrouter). Mantemos as duas
// porque o vitorAgent.buildTools usa closure (sessionId/projectId/memberId
// vêm do AgentRunRequest) e o MCP server precisa de factory pura(ctx).
import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  createPrd,
  getPrdById,
  updatePrd,
  approvePrd,
  getPrdsForProject,
} from "@/lib/dal/product-requirements";
import {
  ProposePrdInput,
  UpdatePrdInput,
  ApprovePrdInput,
  LinkPrdDependencyInput,
} from "../agents/vitor/prd-schemas";

export function createProposePrdTool(
  sessionId: string,
  projectId: string,
  memberId: string | null,
): Tool {
  return tool({
    description:
      "Propoe um OU MAIS PRDs num unico call via `prds: [...]`. Passe TODOS os PRDs do scaffold de uma vez (NAO faca um call por PRD — isso para no meio). Cada PRD requer problem (>=50 chars), goal (>=20 chars), >=3 acceptance criteria E `stories` (§16): >=1 story implementavel, cada uma com >=1 `verifiable` automatizavel (typecheck/sql/http/lint — NAO use manual_browser como unico check), estimateMinutes <=30, `dependsOn` (DAG) e `agentProfile` (db/api/ui/wiring/test/doc). Sem stories validas o PRD nao roda na Forja. Retorna { created: [{id, reference, title, status, storiesCount}] }.",
    inputSchema: z.object({
      prds: z
        .array(
          ProposePrdInput.omit({
            projectId: true,
            designSessionId: true,
          }),
        )
        .min(1),
    }),
    execute: async ({ prds }) => {
      const created: Array<{
        id: string;
        reference: string;
        title: string;
        status: string;
        storiesCount: number;
      }> = [];
      for (const args of prds) {
        const row = await createPrd({
          projectId,
          designSessionId: sessionId,
          moduleId: args.moduleId ?? null,
          title: args.title,
          oneLiner: args.oneLiner,
          personaIds: args.personaIds,
          problem: args.problem,
          goal: args.goal,
          userJourney: args.userJourney,
          acceptanceCriteria: args.acceptanceCriteria,
          successMetrics: args.successMetrics,
          outOfScope: args.outOfScope,
          technicalNotes: args.technicalNotes,
          risksAndAssumptions: args.risksAndAssumptions,
          sourceCardIds: args.sourceCardIds,
          stories: args.stories as never,
          actorAgent: "vitor",
          actorMemberId: memberId ?? null,
        });
        created.push({
          id: row.id,
          reference: row.reference,
          title: row.title,
          status: row.status,
          storiesCount: args.stories.length,
        });
      }
      return { created };
    },
  });
}

export function createReadPrdTool(): Tool {
  return tool({
    description:
      "Le um PRD inteiro por id (todos campos: problem/goal/acceptanceCriteria/userJourney/successMetrics/stories/dependencies/etc). Use SEMPRE antes de `update_prd` em campos jsonb (arrays/objects) — update faz REPLACE do campo inteiro, nao merge.",
    inputSchema: z.object({ id: z.string().uuid() }),
    execute: async ({ id }) => {
      const row = await getPrdById(id);
      if (!row) throw new Error("PRD not found");
      return row;
    },
  });
}

export function createUpdatePrdTool(memberId: string | null): Tool {
  return tool({
    description:
      "Edita um PRD draft/review. Semantica: colunas top-level que voce passa sao trocadas (outras ficam intactas), MAS campos jsonb (acceptanceCriteria, successMetrics, userJourney, risksAndAssumptions, dependencies, stories) sao REPLACE do array/object inteiro — nao merge. Pra editar 1 item de uma lista jsonb: chame `read_prd` primeiro, modifique localmente, devolva a lista completa. Nao pode editar PRD approved.",
    inputSchema: UpdatePrdInput.omit({
      projectId: true,
      designSessionId: true,
    }),
    execute: async ({ id, ...patch }) => {
      const current = await getPrdById(id);
      if (!current) throw new Error("PRD not found");
      if (current.status === "approved") {
        throw new Error("PRD approved — use uma nova versao");
      }
      const row = await updatePrd(id, patch, {
        actorAgent: "vitor",
        actorMemberId: memberId ?? null,
      });
      return { id: row.id, version: row.version, status: row.status };
    },
  });
}

export function createApprovePrdTool(memberId: string | null): Tool {
  return tool({
    description:
      "Aprova um PRD (status=approved). Valida que o PRD tem problem/goal/AC suficientes. Apos aprovacao, Vitoria pode materializar em Tasks.",
    inputSchema: ApprovePrdInput,
    execute: async ({ id }) => {
      if (!memberId) throw new Error("approve_prd requires memberId");
      const row = await approvePrd(id, { actorMemberId: memberId });
      return { id: row.id, status: row.status, approvedAt: row.approvedAt };
    },
  });
}

export function createLinkPrdDependencyTool(memberId: string | null): Tool {
  return tool({
    description:
      "Liga dois PRDs por uma dependencia. Edita o array dependencies do fromPrdId. Direção do kind: 'depends_on' = from roda DEPOIS de to (to é pré-requisito) · 'blocks'/'enables' = from roda ANTES de to · 'shares-data' = sem ordem.",
    inputSchema: LinkPrdDependencyInput,
    execute: async ({ fromPrdId, toPrdId, kind }) => {
      const from = await getPrdById(fromPrdId);
      if (!from) throw new Error("fromPrd not found");
      const existing = Array.isArray(from.dependencies)
        ? (from.dependencies as Array<{ prdId: string; kind: string }>)
        : [];
      const deps = [...existing, { prdId: toPrdId, kind }];
      await updatePrd(
        fromPrdId,
        { dependencies: deps },
        { actorAgent: "vitor", actorMemberId: memberId ?? null },
      );
      return { ok: true };
    },
  });
}

export function createListPrdsTool(projectId: string): Tool {
  return tool({
    description:
      "Lista PRDs do projeto. Opcional filtro por status. Use pra checar o que ja foi criado antes de duplicar.",
    inputSchema: z.object({
      status: z
        .array(z.enum(["draft", "review", "approved", "superseded"]))
        .optional(),
    }),
    execute: async ({ status }) => {
      const rows = await getPrdsForProject(projectId, { status });
      return rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        title: r.title,
        status: r.status,
        moduleId: r.moduleId,
      }));
    },
  });
}
