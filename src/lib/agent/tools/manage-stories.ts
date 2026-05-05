import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Lists User Stories of the current session and the project, with refinement
 * status and counts of AC + tasks. Use BEFORE proposing changes — mirrors
 * the role of list_tasks for the Story layer.
 */
export function listStoriesTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Lista User Stories desta session + outras stories do projeto (com refinementStatus e counts de AC/tasks). Use SEMPRE antes de criar/atualizar story para entender o estado e evitar duplicar.",
    inputSchema: z.object({
      scope: z
        .enum(["session", "project"])
        .optional()
        .describe(
          "session = so desta session (default); project = todas do projeto (read-only).",
        ),
    }),
    execute: async ({ scope }) => {
      const supabase = db();
      const useSession = (scope ?? "session") === "session";

      const query = supabase
        .from("UserStory")
        .select(
          `id, reference, title, want, soThat, refinementStatus,
           moduleId, proposedModuleName, personaId, designSessionId,
           module:Module(id, name),
           persona:ProjectPersona(id, name),
           acceptanceCriteria:AcceptanceCriterion!AcceptanceCriterion_userStoryId_fkey(id)`,
        )
        .eq("projectId", projectId);

      const { data, error } = await (useSession
        ? query.eq("designSessionId", sessionId)
        : query
      ).order("createdAt", { ascending: false });

      if (error) return { success: false, error: error.message };

      const storyIds = (data ?? []).map((s) => s.id);
      let taskCounts = new Map<string, number>();
      if (storyIds.length > 0) {
        const { data: tasks } = await supabase
          .from("Task")
          .select("userStoryId")
          .in("userStoryId", storyIds);
        for (const t of tasks ?? []) {
          if (!t.userStoryId) continue;
          taskCounts.set(t.userStoryId, (taskCounts.get(t.userStoryId) ?? 0) + 1);
        }
      }

      const stories = (data ?? []).map((s) => {
        const mod = s.module as unknown as { id: string; name: string } | null;
        const persona = s.persona as unknown as
          | { id: string; name: string }
          | null;
        const ac = s.acceptanceCriteria as unknown as { id: string }[] | null;
        return {
          id: s.id,
          reference: s.reference,
          title: s.title,
          want: s.want,
          soThat: s.soThat,
          refinementStatus: s.refinementStatus,
          module: mod ? { id: mod.id, name: mod.name } : null,
          proposedModuleName: s.proposedModuleName,
          persona: persona ? { id: persona.id, name: persona.name } : null,
          acCount: ac?.length ?? 0,
          taskCount: taskCounts.get(s.id) ?? 0,
          isCurrentSession: s.designSessionId === sessionId,
        };
      });

      return { success: true, scope: scope ?? "session", stories };
    },
  });
}

/**
 * Promotes a `proposedModuleName` to a real Module across ALL stories of the
 * project that share that proposed name. If a Module with the same name
 * already exists in the project, reuses it.
 *
 * Use ONLY after confirming with the user. The tool is idempotent: re-running
 * is safe; stories already linked to the Module are skipped.
 */
export function approveModuleTool(projectId: string) {
  return tool({
    description:
      "Promove um proposedModuleName em Module real, atualizando TODAS as stories do projeto que tem esse proposedModuleName. Reusa Module existente se ja houver um com o mesmo nome. CHAME APENAS apos confirmacao explicita do usuario no chat.",
    inputSchema: z.object({
      proposedName: z
        .string()
        .min(1)
        .describe(
          "Nome do modulo proposto a aprovar (case-sensitive, igual ao que esta nas stories).",
        ),
      finalName: z
        .string()
        .optional()
        .describe(
          "Nome final do Module (se quiser renomear durante a aprovacao). Default = proposedName.",
        ),
    }),
    execute: async ({ proposedName, finalName }) => {
      const supabase = db();
      const moduleName = finalName ?? proposedName;

      // 1. Find or create the Module by (projectId, name).
      //    NEW: sets approvedAt = now() so the module + its stories/tasks
      //    immediately appear in /projects/[id]. Vitor only calls this tool
      //    after explicit user confirmation (Regra 0). The module is also
      //    visible in the briefing tree before approval (no harm done if the
      //    user later rejects via DELETE /api/modules/[id]/approve).
      const existingMod = await supabase
        .from("Module")
        .select("id, name, approvedAt")
        .eq("projectId", projectId)
        .eq("name", moduleName)
        .maybeSingle();
      if (existingMod.error) {
        return { success: false, error: existingMod.error.message };
      }

      let moduleId: string;
      let moduleAlreadyExisted = false;
      const nowIso = new Date().toISOString();
      if (existingMod.data) {
        moduleId = existingMod.data.id;
        moduleAlreadyExisted = true;
        // Mark approved if it wasn't already.
        if (!existingMod.data.approvedAt) {
          const { error: approveErr } = await supabase
            .from("Module")
            .update({ approvedAt: nowIso, updatedAt: nowIso })
            .eq("id", moduleId);
          if (approveErr) return { success: false, error: approveErr.message };
        }
      } else {
        const { data: created, error: createErr } = await supabase
          .from("Module")
          .insert({ projectId, name: moduleName, approvedAt: nowIso })
          .select("id")
          .single();
        if (createErr) return { success: false, error: createErr.message };
        moduleId = created!.id;
      }

      // 2. Find candidate stories
      const candidates = await supabase
        .from("UserStory")
        .select("id")
        .eq("projectId", projectId)
        .eq("proposedModuleName", proposedName);
      if (candidates.error) {
        return { success: false, error: candidates.error.message };
      }
      const storyIds = (candidates.data ?? []).map((s) => s.id);

      if (storyIds.length === 0) {
        return {
          success: true,
          moduleId,
          moduleName,
          moduleAlreadyExisted,
          storiesPromoted: 0,
          note: "Nenhuma story com esse proposedModuleName foi encontrada.",
        };
      }

      const { error: updErr } = await supabase
        .from("UserStory")
        .update({
          moduleId,
          proposedModuleName: null,
          updatedAt: new Date().toISOString(),
        })
        .in("id", storyIds);
      if (updErr) return { success: false, error: updErr.message };

      return {
        success: true,
        moduleId,
        moduleName,
        moduleAlreadyExisted,
        storiesPromoted: storyIds.length,
      };
    },
  });
}

/**
 * Transitions a Story's refinementStatus. Used by the agent to mark phase
 * boundaries: 'draft' → 'refined' (after AC + persona detail) → 'committed'
 * (after tasks generated).
 */
export function setStoryRefinementTool(projectId: string) {
  return tool({
    description:
      "Atualiza o refinementStatus de uma User Story. Use 'refined' apos detalhar (AC + persona); 'committed' apos gerar todas as tasks tecnicas. NAO use 'draft' — uma vez refinada nao volta atras pela tool.",
    inputSchema: z.object({
      storyId: z.string().describe("ID da UserStory"),
      status: z
        .enum(["refined", "committed"])
        .describe("Novo status. 'draft' nao e aceito aqui."),
    }),
    execute: async ({ storyId, status }) => {
      const supabase = db();
      const check = await supabase
        .from("UserStory")
        .select("id, projectId, refinementStatus")
        .eq("id", storyId)
        .maybeSingle();
      if (check.error) return { success: false, error: check.error.message };
      if (!check.data) {
        return { success: false, error: `UserStory ${storyId} not found` };
      }
      if (check.data.projectId !== projectId) {
        return {
          success: false,
          error: `UserStory ${storyId} belongs to a different project`,
        };
      }

      const { error } = await supabase
        .from("UserStory")
        .update({
          refinementStatus: status,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", storyId);
      if (error) return { success: false, error: error.message };

      return {
        success: true,
        storyId,
        previousStatus: check.data.refinementStatus,
        status,
      };
    },
  });
}
