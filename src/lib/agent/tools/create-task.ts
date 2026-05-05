import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { suggestFunctionPoints } from "@/lib/function-points";
import { upsertAndAssignTagsByName } from "@/lib/dal/task-tags";
import {
  resolveDependencyInputs,
  setDependenciesForTask,
  DEPENDENCY_KINDS,
} from "@/lib/dal/task-dependencies";
import type { ChipTone } from "@/lib/status-chips";

// Heurística de tone pra tags novas. Aplicada SO quando a tag ainda nao existe
// no projeto — tags existentes mantem o tone que ja tem. Match case-insensitive
// por substring, na ordem (primeiro hit vence).
const TONE_HEURISTICS: Array<[RegExp, ChipTone]> = [
  [/(bug|fix|hotfix|regression)/i, "red"],
  [/(front|ui|tela|component|render|page)/i, "blue"],
  [/(realtime|stream|websocket|sse)/i, "cyan"],
  [/(supabase|db|database|sql|postgres|migration|table)/i, "teal"],
  [/(infra|auth|deploy|ci|cron|edge)/i, "amber"],
  [/(back|api|server|webhook|endpoint)/i, "purple"],
];

function pickToneFor(name: string): ChipTone {
  for (const [pattern, tone] of TONE_HEURISTICS) {
    if (pattern.test(name)) return tone;
  }
  return "muted";
}

/**
 * Creates a `create_task` tool scoped to a session+project.
 *
 * Hierarchy contract (see vitor-hierarchy-calibration-plan.md):
 *   - userStoryId is REQUIRED — every task lives under a User Story
 *   - acceptanceCriteria is TECHNICAL AC (lint/typecheck/regression in PR)
 *   - product AC lives on UserStory (createUserStoryTool); never duplicate
 *   - "module" comes from userStory.moduleId — do NOT pass module as text
 *
 * Idempotency: lookups (designSessionId, userStoryId, title) with status='draft'.
 * Reruns merge: update description/AC/scope instead of creating a duplicate.
 */
export function createTaskTool(
  sessionId: string,
  projectId: string,
  createdById?: string,
) {
  return tool({
    description:
      "Cria uma task tecnica vinculada a uma User Story. Cada task deve ser um BRIEF AUTOSSUFICIENTE: um LLM em sessao futura, sem acesso a esta design session, deve conseguir ler a task e executar sozinho. AC aqui e TECNICO (verificavel no PR — lint, typecheck, regression de comportamento). NAO duplique AC de produto da story. A tool calcula Function Points automaticamente.",
    inputSchema: z.object({
      userStoryId: z
        .string()
        .describe(
          "ID da UserStory pai (obrigatorio). Toda task vive sob uma story. Use create_user_story antes se a story ainda nao existe.",
        ),
      title: z
        .string()
        .describe(
          "Padrao: <verbo no infinitivo> <objeto concreto> <qualificador opcional com/via/para>. 6-12 palavras. NAO prefixe com camada (Frontend:/Backend:/Integracao:/Migration:) — categoria vai no campo `category`. NAO termine em tags soltas com '+' (ex: '+ LGPD'). Auto-teste: alguem lendo so o titulo consegue dizer o que fica diferente no produto/sistema? Exemplos OK: 'Renderizar formulario de perfil com consentimento LGPD', 'Criar tabela client_profiles com FKs e indices de busca', 'Persistir perfil do cliente e registrar consentimento LGPD'. Exemplos RUIM: 'Frontend: tela de Perfil basico + LGPD', 'Migration: tabela client_profiles', 'Backend: upsert de perfil + consent LGPD'.",
        ),
      description: z
        .string()
        .describe(
          "Markdown rico com secoes: ## Objetivo, ## Contexto, ## Estado atual, ## O que criar (com caminhos de arquivo sugeridos + pseudocodigo/JSX/schema quando util), ## Constraints / NAO fazer, ## Convencoes. NAO inclua secao de AC aqui — AC vai no campo acceptanceCriteria como array.",
        ),
      acceptanceCriteria: z
        .array(z.string())
        .describe(
          "AC TECNICO: cada item verificavel no PR (sim/nao), em uma frase. Inclua pelo menos um regression check ('X continua funcionando apos a mudanca'). Inclua check de lint/typecheck quando aplicavel. NAO duplique AC de produto da Story pai.",
        ),
      notes: z
        .string()
        .optional()
        .describe(
          "Markdown estruturado com campos quando aplicaveis: **Dependencias:** (refs de tasks anteriores), **Habilita:** (o que fica viavel depois), **Risco:** (baixo/medio/alto + razao), **Estrategia de validacao:** (QA manual passo a passo), **Ref:** (spec/mapa), **Tempo estimado:** (Xh-Yh).",
        ),
      complexity: z
        .enum(["trivial", "low", "medium", "high"])
        .describe(
          "Esforco de direcao: trivial=obvio, low=simples, medium=requer pensamento, high=complexo",
        ),
      scope: z
        .enum(["micro", "small", "medium", "large"])
        .describe(
          "Tamanho da entrega: micro=<1h, small=1-4h, medium=4-8h, large=1-2 dias",
        ),
      dependsOn: z
        .array(
          z.union([
            z.string().min(1),
            z.object({
              ref: z.string().min(1),
              kind: z.enum(DEPENDENCY_KINDS).optional(),
            }),
          ]),
        )
        .optional()
        .describe(
          "Dependencias desta task. Formato preferido: refs '<KEY>-T-NNN' (ex: 'EVZL-T-001') retornadas em chamadas anteriores. " +
          "Shorthand: array de strings ['EVZL-T-001'] = todas kind='blocks' (default). " +
          "Pra outros tipos, objeto: { ref: 'EVZL-T-005', kind: 'relates_to' }. " +
          "Kinds: 'blocks' (precisa estar pronto antes — default), 'relates_to' (so contexto, sem ordem). " +
          "Toda ref DEVE existir no MESMO projeto desta task. Em duvida, use 'blocks'.",
        ),
      tags: z
        .array(z.string().min(1).max(32))
        .max(3)
        .optional()
        .describe(
          "Ate 3 tags curtas pra classificar a task (ex: 'Front', 'Back', 'Bug', 'Realtime'). " +
          "ANTES de cravar tags novas, chame `list_project_tags` e prefira reutilizar nomes ja existentes (match case-insensitive). " +
          "So crie tag nova quando nenhuma das existentes serve. Use o minimo necessario — se 1 tag descreve bem, NAO adicione mais. " +
          "Tags canonicas comuns: Front (blue), Back (purple), Bug (red).",
        ),
    }),
    execute: async ({
      userStoryId,
      title,
      description,
      acceptanceCriteria,
      notes,
      complexity,
      scope,
      dependsOn,
      tags,
    }) => {
      const supabase = db();
      const functionPoints = suggestFunctionPoints(scope, complexity);

      // Validate userStoryId belongs to the same project (defensive).
      const storyCheck = await supabase
        .from("UserStory")
        .select("id, projectId")
        .eq("id", userStoryId)
        .maybeSingle();
      if (storyCheck.error) {
        return { success: false, error: storyCheck.error.message };
      }
      if (!storyCheck.data) {
        return { success: false, error: `UserStory ${userStoryId} not found` };
      }
      if (storyCheck.data.projectId !== projectId) {
        return {
          success: false,
          error: `UserStory ${userStoryId} belongs to a different project`,
        };
      }

      const trimmedAc = acceptanceCriteria
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const requestedTags = (tags ?? [])
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .map((name) => ({ name, tone: pickToneFor(name) }));

      // Idempotency lookup: same session + story + title, draft status.
      const existing = await supabase
        .from("Task")
        .select("id")
        .eq("designSessionId", sessionId)
        .eq("userStoryId", userStoryId)
        .eq("title", title)
        .eq("status", "draft")
        .maybeSingle();
      if (existing.error) {
        return { success: false, error: existing.error.message };
      }

      // Resolve dependencies upfront — falha cedo se ref invalida.
      let resolvedDeps: Array<{ dependsOn: string; kind: "blocks" | "relates_to" }> = [];
      let depRefsEcho: string[] = [];
      if (dependsOn && dependsOn.length > 0) {
        const { resolved, missing } = await resolveDependencyInputs(
          projectId,
          dependsOn,
        );
        if (missing.length > 0) {
          return {
            success: false,
            error: `Refs de dependsOn nao encontradas neste projeto: ${missing.join(", ")}. Verifique que as tasks foram criadas e use a 'reference' retornada por create_task.`,
          };
        }
        resolvedDeps = resolved.map((r) => ({
          dependsOn: r.dependsOn,
          kind: r.kind,
        }));
        depRefsEcho = resolved.map((r) =>
          r.kind === "blocks" ? r.ref : `${r.ref} (${r.kind})`,
        );
      }

      // ── UPDATE path ───────────────────────────────────────────────────────
      if (existing.data) {
        const id = existing.data.id;
        const { error: updErr } = await supabase
          .from("Task")
          .update({
            description,
            complexity,
            scope,
            functionPoints,
            notes: notes ?? null,
            updatedAt: new Date().toISOString(),
          })
          .eq("id", id);
        if (updErr) return { success: false, error: updErr.message };

        // Replace AC set
        const { error: delErr } = await supabase
          .from("AcceptanceCriterion")
          .delete()
          .eq("taskId", id);
        if (delErr) return { success: false, error: delErr.message };

        if (trimmedAc.length > 0) {
          const acRows = trimmedAc.map((text, i) => ({
            taskId: id,
            text,
            order: i,
          }));
          const { error: acErr } = await supabase
            .from("AcceptanceCriterion")
            .insert(acRows);
          if (acErr) return { success: false, error: acErr.message };
        }

        try {
          await setDependenciesForTask(id, resolvedDeps);
        } catch (e) {
          return {
            success: false,
            error: `Falha ao atualizar dependencias: ${e instanceof Error ? e.message : String(e)}`,
          };
        }

        const tagResult = requestedTags.length > 0
          ? await upsertAndAssignTagsByName({
              projectId,
              taskId: id,
              tags: requestedTags,
            })
          : { assigned: [], created: [], reused: [] };

        // Recupera a reference atual da task (pra retornar pro agent).
        const { data: refRow } = await supabase
          .from("Task")
          .select("reference")
          .eq("id", id)
          .maybeSingle();

        return {
          success: true,
          id,
          reference: refRow?.reference ?? null,
          title,
          functionPoints,
          acCount: trimmedAc.length,
          tags: {
            assigned: tagResult.assigned.map((t) => t.name),
            reused: tagResult.reused.map((t) => t.name),
            created: tagResult.created.map((t) => t.name),
          },
          dependsOn: depRefsEcho,
          alreadyExisted: true,
        };
      }

      // ── INSERT path ───────────────────────────────────────────────────────
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

      // Gera reference DRAFT (<KEY>-D-NNN). Sera substituida por <KEY>-T-NNN
      // na promocao draft->backlog. Tem retry por seguranca contra race em
      // sequencia.
      let reference: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: ref, error: refErr } = await supabase.rpc(
          "next_draft_task_reference",
          { p_project_id: projectId },
        );
        if (refErr || !ref) {
          return {
            success: false,
            error: refErr?.message ?? "Falha ao gerar reference da task",
          };
        }
        reference = ref;
        break;
      }

      const newTaskId = crypto.randomUUID();
      const { data: task, error } = await supabase
        .from("Task")
        .insert({
          id: newTaskId,
          title,
          description,
          reference,
          status: "draft",
          complexity,
          scope,
          functionPoints,
          projectId,
          designSessionId: sessionId,
          userStoryId,
          notes: notes ?? null,
          createdById: createdById ?? null,
          createdByAgent: true,
          updatedAt: new Date().toISOString(),
        })
        .select("id, title, functionPoints, reference")
        .single();

      if (error) return { success: false, error: error.message };

      if (trimmedAc.length > 0) {
        const acRows = trimmedAc.map((text, i) => ({
          taskId: task!.id,
          text,
          order: i,
        }));
        const { error: acErr } = await supabase
          .from("AcceptanceCriterion")
          .insert(acRows);
        if (acErr) return { success: false, error: acErr.message };
      }

      if (resolvedDeps.length > 0) {
        try {
          await setDependenciesForTask(task!.id, resolvedDeps);
        } catch (e) {
          return {
            success: false,
            error: `Task criada (${task!.reference}), mas falhou ao gravar dependencias: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      }

      const tagResult = requestedTags.length > 0
        ? await upsertAndAssignTagsByName({
            projectId,
            taskId: task!.id,
            tags: requestedTags,
          })
        : { assigned: [], created: [], reused: [] };

      return {
        success: true,
        id: task!.id,
        reference: task!.reference,
        title: task!.title,
        functionPoints: task!.functionPoints,
        acCount: trimmedAc.length,
        tags: {
          assigned: tagResult.assigned.map((t) => t.name),
          reused: tagResult.reused.map((t) => t.name),
          created: tagResult.created.map((t) => t.name),
        },
        dependsOn: depRefsEcho,
        alreadyExisted: false,
      };
    },
  });
}
