import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { suggestFunctionPoints } from "@/lib/function-points";

/**
 * Creates a create_task tool scoped to a specific design session.
 * The tool creates both a DesignSessionItem and a Task in the database,
 * calculates function points automatically, and returns the result.
 */
export function createTaskTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Cria uma task técnica no backlog do projeto. Use para cada task granular que deve ser implementada. A tool calcula Function Points automaticamente.",
    inputSchema: z.object({
      title: z.string().describe("Título curto e acionável da task"),
      description: z
        .string()
        .describe("O que entregar e por quê (contexto de negócio)"),
      acceptanceCriteria: z
        .array(z.string())
        .describe("Lista de critérios de aceite verificáveis"),
      notes: z
        .string()
        .optional()
        .describe(
          "Observações técnicas: snippets, queries, referências. Só se agregar valor."
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

      // Get next reference
      const { data: reference } = await supabase.rpc("next_task_reference");

      // Create DesignSessionItem
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

      // Create Task
      const { data: task, error } = await supabase
        .from("Task")
        .insert({
          id: crypto.randomUUID(),
          title,
          description,
          reference: reference!,
          status: "backlog",
          complexity,
          scope,
          functionPoints,
          projectId,
          designSessionId: sessionId,
          acceptanceCriteria: JSON.stringify(acceptanceCriteria),
          notes: enrichedNotes,
          dependencies: dependsOn?.length
            ? JSON.stringify(dependsOn)
            : null,
          updatedAt: new Date().toISOString(),
        })
        .select("id, reference, title, functionPoints")
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      return {
        success: true,
        reference: task!.reference,
        title: task!.title,
        functionPoints: task!.functionPoints,
      };
    },
  });
}
