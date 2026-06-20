/**
 * mvp_check — gate estrutural antes de marcar feature como MVP.
 *
 * Lê brainstorm + personas_journeys + research log + business context e retorna:
 *  - pass: boolean — se a feature pode ser MVP
 *  - blockers: razões pra NÃO ser MVP (sem dor priorizada, sem evidência, etc)
 *  - warnings: sinais amarelos (PFV alto vs runway, etc)
 *  - suggestion: "MVP" | "Next" | "Out" | "needs_more_info"
 *
 * Vitor é instruído a chamar isso ANTES de update_item({bucket: "mvp"}).
 */

import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";

interface AsIsStep {
  id: string;
  description: string;
  painOrGain?: string;
}

export function createMvpCheckTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Avalia se uma feature pode entrar no MVP. CHAME ESTA TOOL ANTES de mover qualquer item pra bucket=mvp via write_priority({action:'move'}). Retorna pass=false se faltar dor priorizada, evidência ou se contraditar uma decisão ativa. Não é prompt rule frouxa — é gate estrutural pra disciplina de escopo.",
    inputSchema: z.object({
      featureId: z
        .string()
        .describe("ID da feature em brainstorm (ou priority item) que se quer marcar como MVP"),
    }),
    execute: async ({ featureId }) => {
      const blockers: string[] = [];
      const warnings: string[] = [];

      const { data: feature } = await db()
        .from("DesignSessionBrainstormFeature")
        .select("id, title, painPointRef")
        .eq("sessionId", sessionId)
        .eq("id", featureId)
        .maybeSingle();

      if (!feature) {
        return {
          pass: false,
          blockers: [`feature ${featureId} não encontrada em brainstorm`],
          warnings: [],
          suggestion: "needs_more_info" as const,
        };
      }

      // --- Check 1: dor priorizada (busca o id em asIsSteps de qualquer persona)
      const { data: personas } = await db()
        .from("DesignSessionPersona")
        .select("id, name, \"asIsSteps\"")
        .eq("sessionId", sessionId);
      const painRef = feature.painPointRef;
      let dorOk = false;
      if (painRef) {
        for (const p of personas ?? []) {
          const steps = (p.asIsSteps as AsIsStep[] | null) ?? [];
          if (steps.some((s) => s.id === painRef)) {
            dorOk = true;
            break;
          }
        }
      }
      if (!dorOk) {
        blockers.push(
          painRef
            ? `painPointRef "${painRef}" não bate com nenhuma asIsStep das personas — dor não está priorizada`
            : "feature sem painPointRef — não há dor priorizada documentada",
        );
      }

      // --- Check 2: evidência (research) OU decisão ativa cobrindo
      const { data: research } = await db()
        .from("DesignSessionResearch")
        .select("id, query, summary")
        .eq("projectId", projectId)
        .limit(50);
      const titleTokens = feature.title.toLowerCase().split(/\s+/).filter((t) => t.length > 4);
      const hasResearchEvidence = (research ?? []).some((r) =>
        titleTokens.some(
          (t) =>
            r.query.toLowerCase().includes(t) || r.summary.toLowerCase().includes(t),
        ),
      );
      const { data: decisions } = await db()
        .from("DesignDecision")
        .select("id, statement, tags")
        .eq("projectId", projectId)
        .eq("status", "active");
      const hasDecisionEvidence = (decisions ?? []).some((d) =>
        titleTokens.some((t) => d.statement.toLowerCase().includes(t)),
      );

      if (!hasResearchEvidence && !hasDecisionEvidence) {
        blockers.push(
          "sem evidência: nenhuma pesquisa nem decisão ativa cobre essa feature. Pesquise antes ou marque como assumption.",
        );
      }

      // --- Check 3: contradição com decisão ativa
      const contradictingDecision = (decisions ?? []).find(
        (d) =>
          d.tags?.includes("scope") &&
          titleTokens.some((t) => d.statement.toLowerCase().includes(t)) &&
          d.statement.toLowerCase().match(/\b(fora|nao|não)\b/),
      );
      if (contradictingDecision) {
        blockers.push(
          `decisão ativa pode contradizer: "${contradictingDecision.statement}" (id: ${contradictingDecision.id.slice(0, 8)})`,
        );
      }

      // --- Check 4: runway warning (não bloqueia, só alerta)
      const { data: ctx } = await db()
        .from("ProjectBusinessContext")
        .select("runwayMonths")
        .eq("projectId", projectId)
        .maybeSingle();
      if (ctx?.runwayMonths != null && ctx.runwayMonths < 6) {
        warnings.push(
          `runway curto (${ctx.runwayMonths}m) — toda feature MVP precisa ser absolutamente essencial`,
        );
      }

      const pass = blockers.length === 0;
      const suggestion = pass
        ? ("MVP" as const)
        : blockers.some((b) => b.includes("contradiz"))
          ? ("Out" as const)
          : blockers.some((b) => b.includes("evidência") || b.includes("painPointRef"))
            ? ("needs_more_info" as const)
            : ("Next" as const);

      return { pass, blockers, warnings, suggestion };
    },
  });
}
