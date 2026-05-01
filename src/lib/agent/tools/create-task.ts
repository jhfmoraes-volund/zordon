import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { suggestFunctionPoints } from "@/lib/function-points";

/**
 * Creates a create_task tool scoped to a specific design session.
 * The tool creates both a DesignSessionItem and a Task in the database,
 * calculates function points automatically, and returns the result.
 */
export function createTaskTool(sessionId: string, projectId: string, createdById?: string) {
  return tool({
    description:
      "Cria uma task técnica no backlog do projeto. Cada task deve ser um BRIEF AUTOSSUFICIENTE: um LLM em sessão futura, sem acesso a esta design session, deve conseguir ler a task e executar sozinho. Use markdown rico em description e notes (ver PASSO 3 do system prompt). A tool calcula Function Points automaticamente.",
    inputSchema: z.object({
      title: z
        .string()
        .describe(
          "Título curto e acionável. Prefixe com [MÓDULO] quando agrupar (ex: '[FINANCEIRO] Endpoint POST /api/invoices')."
        ),
      description: z
        .string()
        .describe(
          "Markdown rico com seções: ## Objetivo, ## Contexto, ## Estado atual, ## O que criar (com caminhos de arquivo sugeridos + pseudocódigo/JSX/schema quando útil), ## Constraints / NÃO fazer, ## Convenções. Veja PASSO 3 do system prompt pro template completo. Brief denso > task fragmentada."
        ),
      acceptanceCriteria: z
        .array(z.string())
        .describe(
          "Cada item: verificável objetivamente (sim/não), em uma frase. Inclua pelo menos um regression check ('X continua funcionando após a mudança'). Evite 'funciona bem', 'otimizado', 'boa UX'."
        ),
      notes: z
        .string()
        .optional()
        .describe(
          "Markdown estruturado com campos quando aplicáveis: **Dependências:** (refs de tasks anteriores), **Habilita:** (o que fica viável depois), **Risco:** (baixo/médio/alto + razão), **Estratégia de validação:** (QA manual passo a passo), **Ref:** (spec/mapa), **Tempo estimado:** (Xh-Yh)."
        ),
      complexity: z
        .enum(["trivial", "low", "medium", "high"])
        .describe(
          "Esforço de direção: trivial=óbvio, low=simples, medium=requer pensamento, high=complexo"
        ),
      scope: z
        .enum(["micro", "small", "medium", "large"])
        .describe(
          "Tamanho da entrega: micro=<1h, small=1-4h, medium=4-8h, large=1-2 dias"
        ),
      dependsOn: z
        .array(z.string())
        .optional()
        .describe("Referências (ex: VLD-042) de tasks que precisam estar prontas antes"),
      category: z
        .enum(["frontend", "backend", "infra", "integration", "design"])
        .optional()
        .describe("Categoria: frontend (telas/componentes), backend (API/logica), infra (deploy/CI/DB), integration (APIs externas), design (UI/UX)"),
      module: z
        .string()
        .optional()
        .describe("Agrupamento funcional (ex: 'Modulo Financeiro', 'Onboarding', 'Gestao de Prestadores')"),
    }),
    execute: async ({
      title,
      description,
      acceptanceCriteria,
      notes,
      complexity,
      scope,
      dependsOn,
      category,
      module,
    }) => {
      const supabase = db();
      const functionPoints = suggestFunctionPoints(scope, complexity);

      // Encode category/module as structured prefix in notes
      const metaParts = [
        category ? `[Categoria: ${category}]` : null,
        module ? `[Modulo: ${module}]` : null,
      ].filter(Boolean);
      const enrichedNotes = metaParts.length
        ? `${metaParts.join(" | ")}${notes ? ` — ${notes}` : ""}`
        : notes || null;

      await supabase.from("DesignSessionItem").insert({
        id: crypto.randomUUID(),
        sessionId,
        title,
        description,
        type: "feature",
        priority: "must",
        sourceStep: "briefing",
        aiGenerated: true,
      });

      // Session-scoped drafts: no reference, status='draft'. Both are populated
      // when the session is exported via POST /api/design-sessions/[id]/export.
      const { data: task, error } = await supabase
        .from("Task")
        .insert({
          id: crypto.randomUUID(),
          title,
          description,
          reference: null,
          status: "draft",
          complexity,
          scope,
          functionPoints,
          projectId,
          designSessionId: sessionId,
          notes: enrichedNotes,
          dependencies: dependsOn?.length
            ? JSON.stringify(dependsOn)
            : null,
          createdById: createdById ?? null,
          createdByAgent: true,
          updatedAt: new Date().toISOString(),
        })
        .select("id, title, functionPoints")
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      return {
        success: true,
        title: task!.title,
        functionPoints: task!.functionPoints,
      };
    },
  });
}
