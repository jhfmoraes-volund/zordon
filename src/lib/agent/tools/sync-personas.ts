import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";

/**
 * `sync_project_personas` — reconcile product personas into `ProjectPersona`.
 *
 * Used in the `module_discovery` sub-phase. Vitor reads `personas_journeys`
 * (where personas live as draft entries inside step data) and promotes them
 * to first-class `ProjectPersona` rows. Stories created later in `story_tree`
 * link to these via `personaId`.
 *
 * Idempotency: matches existing rows on `(projectId, name)` (case-sensitive,
 * to mirror the unique index). Existing rows have their description updated.
 *
 * Safety: never deletes personas that already have stories attached. The PM
 * can prune stale personas via the settings UI. Personas with zero stories
 * AND not present in the new list are removed (cleans up Builder/PM/Cliente
 * leftovers from the old seed without ever touching real product personas).
 */
export function syncProjectPersonasTool(projectId: string) {
  return tool({
    description:
      "Sincroniza as personas do produto (de personas_journeys) com a tabela ProjectPersona, pra que stories possam linkar via personaId. Idempotente em (projectId, name). Remove personas antigas SEM stories que nao estejam na nova lista. NAO toca personas que ja tem stories atribuidas. Use UMA vez na sub-fase module_discovery, depois de propor os modulos.",
    inputSchema: z.object({
      personas: z
        .array(
          z.object({
            name: z
              .string()
              .min(2)
              .describe(
                "Nome curto da persona como aparece em personas_journeys (ex: 'Lucas', 'Carlos'). Mantenha exatamente como o PM escreveu.",
              ),
            description: z
              .string()
              .min(8)
              .describe(
                "1-2 frases: papel + contexto resumido. Combine 'role' + trecho relevante de 'context' do step. Ex: 'Cliente residencial. 32 anos, Aguas Claras, valoriza praticidade e confianca.'",
              ),
          }),
        )
        .min(1)
        .describe(
          "Lista canonica de personas do produto. Chame UMA vez com TODAS as personas que ficarao no projeto.",
        ),
    }),
    execute: async (input) => {
      const supabase = db();

      // Snapshot current state.
      const { data: current, error: curErr } = await supabase
        .from("ProjectPersona")
        .select("id, name")
        .eq("projectId", projectId);
      if (curErr) return { success: false, error: curErr.message };

      const incomingNames = new Set(input.personas.map((p) => p.name));
      const currentByName = new Map(
        (current ?? []).map((p) => [p.name, p.id] as const),
      );

      // 1) Upsert: insert new, update existing.
      const upserted: Array<{ id: string; name: string; created: boolean }> = [];
      for (const p of input.personas) {
        const existingId = currentByName.get(p.name);
        if (existingId) {
          const { error } = await supabase
            .from("ProjectPersona")
            .update({
              description: p.description,
              updatedAt: new Date().toISOString(),
            })
            .eq("id", existingId);
          if (error) return { success: false, error: error.message };
          upserted.push({ id: existingId, name: p.name, created: false });
        } else {
          const { data: ins, error } = await supabase
            .from("ProjectPersona")
            .insert({
              projectId,
              name: p.name,
              description: p.description,
            })
            .select("id, name")
            .single();
          if (error) return { success: false, error: error.message };
          upserted.push({ id: ins!.id, name: ins!.name, created: true });
        }
      }

      // 2) Prune: stale personas (not in incoming) WITHOUT any stories.
      const stale = (current ?? []).filter((p) => !incomingNames.has(p.name));
      const pruned: Array<{ id: string; name: string }> = [];
      const skippedDueToStories: Array<{ id: string; name: string }> = [];

      for (const s of stale) {
        const { count, error } = await supabase
          .from("UserStory")
          .select("id", { count: "exact", head: true })
          .eq("personaId", s.id);
        if (error) return { success: false, error: error.message };

        if ((count ?? 0) > 0) {
          skippedDueToStories.push({ id: s.id, name: s.name });
          continue;
        }

        const { error: delErr } = await supabase
          .from("ProjectPersona")
          .delete()
          .eq("id", s.id);
        if (delErr) return { success: false, error: delErr.message };
        pruned.push({ id: s.id, name: s.name });
      }

      return {
        success: true,
        upserted,
        createdCount: upserted.filter((u) => u.created).length,
        updatedCount: upserted.filter((u) => !u.created).length,
        prunedCount: pruned.length,
        pruned,
        skippedDueToStories,
      };
    },
  });
}
