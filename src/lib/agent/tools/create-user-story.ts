import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";

type UserStoryUpdate = Database["public"]["Tables"]["UserStory"]["Update"];

/**
 * Creates a `create_user_story` tool scoped to a session+project.
 *
 * The tool wraps the existing story-hierarchy DAL conventions:
 *   - `reference` (US-NNN) is generated atomically by RPC `next_user_story_reference`
 *   - `proposedModuleName` and `moduleId` are XOR (mirrors REST validation)
 *   - acceptanceCriteriaProduct (string[]) is persisted as rows in
 *     `AcceptanceCriterion` linked via `userStoryId` (NOT in markdown)
 *   - idempotent on (projectId, title) when refinementStatus is not 'committed':
 *     reruns merge AC and update want/soThat instead of duplicating.
 *
 * AC duality (see vitor-hierarchy-calibration-plan.md §2.2):
 *   - Story AC = product-level (verifiable by PM/user without reading code)
 *   - Task AC  = technical (verifiable in PR: lint, typecheck, regression)
 * The two never duplicate.
 */
export function createUserStoryTool(
  sessionId: string,
  projectId: string,
  createdById?: string,
) {
  return tool({
    description: `Cria (ou atualiza idempotentemente) uma User Story na hierarquia Module → UserStory → Task. AC aqui e DE PRODUTO (verificavel pelo PM/usuario, sem ler codigo).

CONTRATO POR refinementStatus:
- "refined" (caminho padrao em story_tree): EXIGE personaId + acceptanceCriteriaProduct (3-5 itens) + (moduleId OU proposedModuleName). Story nasce pronta pra revisao.
- "committed": so apos task_breakdown ter gerado as tasks. Use set_story_refinement em vez disso.
- "draft": fallback legado. So quando o PM explicitamente pediu story incompleta.

EXEMPLO de chamada bem-formada em story_tree (copie e adapte):
{
  title: "Aprovar invoices em massa",
  want: "aprovar varias invoices de uma vez",
  soThat: "fechar o mes mais rapido",
  moduleId: "<COPIE o uuid de id=\`...\` da Hierarquia atual > Modules>",
  personaId: "<COPIE o uuid de id=\`...\` da Hierarquia atual > Personas>",
  acceptanceCriteriaProduct: [
    "Checkbox aparece em cada linha da lista de invoices",
    "Botao 'Aprovar selecionadas' fica habilitado quando ha >=1 selecionada",
    "Apos aprovar, status das invoices muda pra 'approved' e elas somem da lista pendente",
    "Aprovacao individual continua funcionando apos a mudanca"
  ],
  refinementStatus: "refined"
}

REGRAS DURAS:
- moduleId XOR proposedModuleName: passe SEMPRE moduleId quando o modulo ja existe na Hierarquia atual (rascunho ou aprovado). proposedModuleName e fallback so quando voce esta propondo modulo novo.
- Em story_tree, NUNCA omita personaId nem acceptanceCriteriaProduct. O executor rejeita.
- Em story_tree, refinementStatus DEVE ser "refined". Default "draft" e proibido nesta fase.`,
    inputSchema: z
      .object({
        title: z
          .string()
          .min(3)
          .describe(
            "Titulo curto e acionavel da story (ex: 'Aprovar invoice em massa').",
          ),
        want: z
          .string()
          .min(3)
          .describe(
            "APENAS o complemento da acao (ex: 'aprovar varias invoices de uma vez'). NAO inclua 'Como X, quero ...' — a UI ja prefixa 'Como {persona}, quero ' automaticamente. Comece pelo verbo no infinitivo.",
          ),
        soThat: z
          .string()
          .optional()
          .describe(
            "APENAS o complemento do beneficio (ex: 'fechar o mes mais rapido'). NAO inclua 'para que ' nem 'pra que ' — a UI ja prefixa ', para que '. Opcional mas recomendado.",
          ),
        moduleId: z
          .string()
          .optional()
          .describe(
            "UUID de Module ja existente. COPIE LITERAL de `id=\\`<uuid>\\`` da 'Hierarquia atual > Modules' (rascunho OU aprovado — ambos valem). XOR com proposedModuleName. Sempre prefira moduleId quando o modulo aparece na Hierarquia.",
          ),
        proposedModuleName: z
          .string()
          .optional()
          .describe(
            "Nome de modulo NOVO que voce esta propondo agora (nao existe na Hierarquia atual). Ex: 'Faturamento'. XOR com moduleId. NAO use isso se o modulo ja aparece na Hierarquia — use moduleId.",
          ),
        personaId: z
          .string()
          .describe(
            "UUID de ProjectPersona. COPIE LITERAL de `id=\\`<uuid>\\`` da 'Hierarquia atual > Personas'. OBRIGATORIO quando refinementStatus='refined'. Escolha a persona dominante da story (se serve duas, escolha a principal).",
          ),
        acceptanceCriteriaProduct: z
          .array(z.string())
          .min(3)
          .max(7)
          .describe(
            "AC DE PRODUTO: 3-5 strings, cada uma verificavel sim/nao pelo PM/usuario sem ler codigo. Inclua pelo menos 1 regression check ('Comportamento X continua funcionando apos a mudanca'). Evite 'funciona bem', 'otimizado', 'boa UX'. OBRIGATORIO quando refinementStatus='refined'.",
          ),
        refinementStatus: z
          .enum(["draft", "refined", "committed"])
          .describe(
            "Estado de refinamento. Em story_tree SEMPRE 'refined' (story nasce completa). 'committed' so apos tasks geradas (use set_story_refinement). 'draft' apenas em casos legados/explicitos.",
          ),
      })
      .refine(
        (d) => !(d.moduleId && d.proposedModuleName),
        { message: "moduleId XOR proposedModuleName — passe apenas um." },
      )
      .refine(
        (d) => !!(d.moduleId || d.proposedModuleName),
        { message: "passe moduleId (preferido) OU proposedModuleName." },
      ),
    execute: async (input) => {
      const supabase = db();

      const trimmedAc = (input.acceptanceCriteriaProduct ?? [])
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      if (input.refinementStatus === "refined") {
        if (!input.personaId) {
          return {
            success: false,
            error:
              "refinementStatus='refined' exige personaId. Copie o uuid de `id=\\`...\\`` da 'Hierarquia atual > Personas' e tente de novo.",
          };
        }
        if (trimmedAc.length < 3) {
          return {
            success: false,
            error: `refinementStatus='refined' exige acceptanceCriteriaProduct com 3-5 itens. Voce passou ${trimmedAc.length}. Reescreva com criterios verificaveis pelo PM sem ler codigo (inclua 1 regression check).`,
          };
        }
      }

      const existingLookup = await supabase
        .from("UserStory")
        .select("id, reference, refinementStatus")
        .eq("projectId", projectId)
        .eq("title", input.title)
        .neq("refinementStatus", "committed")
        .maybeSingle();
      if (existingLookup.error) {
        return { success: false, error: existingLookup.error.message };
      }

      // ── UPDATE path: story exists, merge ──────────────────────────────────
      if (existingLookup.data) {
        const id = existingLookup.data.id;
        const patch: UserStoryUpdate = {
          want: input.want,
          updatedAt: new Date().toISOString(),
        };
        if (input.soThat !== undefined) patch.soThat = input.soThat;
        if (input.moduleId !== undefined) {
          patch.moduleId = input.moduleId;
          patch.proposedModuleName = null;
        } else if (input.proposedModuleName !== undefined) {
          patch.proposedModuleName = input.proposedModuleName;
          patch.moduleId = null;
        }
        if (input.personaId !== undefined) patch.personaId = input.personaId;
        if (input.refinementStatus) {
          patch.refinementStatus = input.refinementStatus;
        }

        const { error: updErr } = await supabase
          .from("UserStory")
          .update(patch)
          .eq("id", id);
        if (updErr) return { success: false, error: updErr.message };

        // Replace AC set when caller provided one. Empty array = no-op (don't wipe).
        if (trimmedAc.length > 0) {
          const { error: delErr } = await supabase
            .from("AcceptanceCriterion")
            .delete()
            .eq("userStoryId", id);
          if (delErr) return { success: false, error: delErr.message };

          const acRows = trimmedAc.map((text, i) => ({
            userStoryId: id,
            text,
            order: i,
          }));
          const { error: acErr } = await supabase
            .from("AcceptanceCriterion")
            .insert(acRows);
          if (acErr) return { success: false, error: acErr.message };
        }

        return {
          success: true,
          id,
          reference: existingLookup.data.reference,
          refinementStatus:
            (patch.refinementStatus as string | undefined) ??
            existingLookup.data.refinementStatus,
          criteriaCount: trimmedAc.length,
          alreadyExisted: true,
        };
      }

      // ── INSERT path: new story ────────────────────────────────────────────
      const refRpc = await supabase.rpc("next_user_story_reference", {
        p_project_id: projectId,
      });
      if (refRpc.error) return { success: false, error: refRpc.error.message };
      const reference = refRpc.data as unknown as string;

      const { data: story, error: insErr } = await supabase
        .from("UserStory")
        .insert({
          projectId,
          designSessionId: sessionId,
          reference,
          title: input.title,
          want: input.want,
          soThat: input.soThat ?? null,
          moduleId: input.moduleId ?? null,
          proposedModuleName: input.proposedModuleName ?? null,
          personaId: input.personaId ?? null,
          refinementStatus: input.refinementStatus,
          createdById: createdById ?? null,
          createdByAgent: true,
        })
        .select("id, reference, refinementStatus")
        .single();
      if (insErr) return { success: false, error: insErr.message };

      if (trimmedAc.length > 0) {
        const acRows = trimmedAc.map((text, i) => ({
          userStoryId: story!.id,
          text,
          order: i,
        }));
        const { error: acErr } = await supabase
          .from("AcceptanceCriterion")
          .insert(acRows);
        if (acErr) return { success: false, error: acErr.message };
      }

      return {
        success: true,
        id: story!.id,
        reference: story!.reference,
        refinementStatus: story!.refinementStatus,
        criteriaCount: trimmedAc.length,
        alreadyExisted: false,
      };
    },
  });
}
