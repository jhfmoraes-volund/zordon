import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeModuleName } from "@/lib/dal/story-hierarchy";

/**
 * `propose_modules` — bulk-create draft Modules at the start of a briefing.
 *
 * Used in the `module_discovery` sub-phase. Vitor proposes the product's
 * module breakdown in chat, the PM agrees, and Vitor calls this tool ONCE with
 * the full array. Each module is persisted with `approvedAt = null` (draft).
 * Approval happens later via the existing approve-module flow.
 *
 * Idempotency: matches existing rows on `(projectId, normalize(name))`. If a
 * module already exists with the same normalized name, the description is
 * updated and the row is reused — never duplicated.
 *
 * The agent receives natural names ("Autenticação & Onboarding") and we
 * normalize at persistence time to satisfy the `module_name_format` CHECK
 * (`^[A-Z][A-Z0-9_]*$`).
 */
export function proposeModulesTool(projectId: string) {
  return tool({
    description:
      "Cria varios Modules rascunho de uma vez (sub-fase module_discovery do briefing). Cada modulo precisa de nome curto + descricao de 1 linha (escopo: o que entra, o que NAO entra). Idempotente em (projectId, nome normalizado). NAO aprova modulos — aprovacao e responsabilidade do PM via UI.",
    inputSchema: z.object({
      modules: z
        .array(
          z.object({
            name: z
              .string()
              .min(2)
              .describe(
                "Nome curto em PT-BR natural (ex: 'Autenticacao & Onboarding', 'Faturamento'). NAO precisa ser UPPERCASE_SNAKE — a tool normaliza ao persistir.",
              ),
            description: z
              .string()
              .min(8)
              .describe(
                "Descricao MACRO do modulo (1-3 frases, ~250 chars). Formato: '<o que o modulo E no nivel de produto>. <Exemplos representativos das principais funcoes>. NAO inclui <exclusao explicita pra fronteira>.' NAO e lista de funcoes — e proposito + exemplos + fronteira. Ex: 'Operacao do dia a dia da plataforma. Da ao time interno visibilidade de saude do produto e ferramentas pra resolver o que esta travado. Inclui KPIs, fila de KYC, fallback manual, gestao de usuarios. NAO inclui logica de matching nem KYC SDK.'",
              ),
          }),
        )
        .min(1)
        .describe(
          "Lista completa de modulos propostos. Chame UMA vez com todos — nao itere.",
        ),
    }),
    execute: async (input) => {
      const supabase = db();
      const created: Array<{ id: string; name: string; reused: boolean }> = [];

      // Single round-trip per item — Module list is small (typically <15) and
      // each item needs upsert-by-normalized-name semantics that don't map to
      // a plain bulk insert (no DB-level uniqueness on normalized name).
      for (const m of input.modules) {
        const normalized = normalizeModuleName(m.name);

        const { data: existing, error: lookupErr } = await supabase
          .from("Module")
          .select("id, name")
          .eq("projectId", projectId)
          .eq("name", normalized)
          .maybeSingle();
        if (lookupErr) {
          return { success: false, error: lookupErr.message };
        }

        if (existing) {
          const { error: updErr } = await supabase
            .from("Module")
            .update({
              description: m.description,
              updatedAt: new Date().toISOString(),
            })
            .eq("id", existing.id);
          if (updErr) return { success: false, error: updErr.message };
          created.push({ id: existing.id, name: existing.name, reused: true });
          continue;
        }

        const { data: inserted, error: insErr } = await supabase
          .from("Module")
          .insert({
            projectId,
            name: normalized,
            description: m.description,
          })
          .select("id, name")
          .single();
        if (insErr) return { success: false, error: insErr.message };
        created.push({ id: inserted!.id, name: inserted!.name, reused: false });
      }

      return {
        success: true,
        modules: created,
        createdCount: created.filter((c) => !c.reused).length,
        reusedCount: created.filter((c) => c.reused).length,
      };
    },
  });
}
