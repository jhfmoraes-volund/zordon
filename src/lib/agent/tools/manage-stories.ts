import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  deleteStory,
  getStoryByReference,
} from "@/lib/dal/story-hierarchy";

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
      const taskCounts = new Map<string, number>();
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

// `approveModuleTool` removida — aprovação granular durante a Design Session
// foi descontinuada. PM aprova a sessão inteira via POST /api/design-sessions/
// [id]/complete (modelo "tudo ou nada"). A tool Alpha `approveModuleForOpsTool`
// continua existindo pra fluxos manuais fora de DS (criação ad-hoc no projeto).

/**
 * Transitions a Story's refinementStatus. Used by the agent to mark phase
 * boundaries: 'draft' (em construção) → 'committed' (after tasks generated).
 */
export function setStoryRefinementTool(projectId: string) {
  return tool({
    description:
      "Atualiza o refinementStatus de uma User Story. Use 'committed' apos gerar todas as tasks tecnicas (trava como deliverable); 'draft' reabre para edicao.",
    inputSchema: z.object({
      storyId: z.string().describe("ID da UserStory"),
      status: z
        .enum(["draft", "committed"])
        .describe("Novo status: 'committed' trava, 'draft' reabre."),
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

/**
 * Deletes a UserStory and its draft tasks in cascade. Refuses if any task
 * is past 'draft' (todo/in_progress/review/done) — caller must move/delete
 * those first to avoid losing committed sprint work.
 *
 * Why a separate cascade (not relying on FK ON DELETE):
 *   Task.userStoryId has ON DELETE SET NULL — deleting the story would
 *   orphan the tasks. We delete drafts explicitly so they don't linger as
 *   orphans, and block when non-draft tasks exist.
 */
export function deleteUserStoryTool(projectId: string) {
  return tool({
    description:
      "Deleta uma UserStory e suas tasks 'draft' em cascata. APENAS após confirmação explícita do PM (Regra 0). Bloqueia se houver tasks fora de 'draft' — nesses casos mova/delete tasks antes via update_task/delete_task.",
    inputSchema: z.object({
      reference: z
        .string()
        .min(3)
        .describe("Reference da story (ex: EVZL-US-049)"),
      reasoning: z
        .string()
        .min(10)
        .describe("Motivo da deleção (auditoria)"),
    }),
    execute: async ({ reference }) => {
      const story = await getStoryByReference(reference);
      if (!story) {
        return {
          success: false,
          notFound: true,
          message: `Story ${reference} não encontrada.`,
        };
      }
      if (story.projectId !== projectId) {
        return {
          success: false,
          message: "Story pertence a outro projeto.",
        };
      }

      const supabase = db();

      const { data: nonDraftTasks, error: scanErr } = await supabase
        .from("Task")
        .select("reference, status")
        .eq("userStoryId", story.id)
        .neq("status", "draft");
      if (scanErr) return { success: false, error: scanErr.message };

      if (nonDraftTasks && nonDraftTasks.length > 0) {
        return {
          success: false,
          blocked: true,
          message: `Story tem ${nonDraftTasks.length} task(s) fora de 'draft'. Mova ou delete antes de remover a story.`,
          blocking: nonDraftTasks,
        };
      }

      const { data: draftTasks } = await supabase
        .from("Task")
        .select("id, reference")
        .eq("userStoryId", story.id);

      if (draftTasks && draftTasks.length > 0) {
        const { error: delTasksErr } = await supabase
          .from("Task")
          .delete()
          .in(
            "id",
            draftTasks.map((t) => t.id),
          );
        if (delTasksErr) return { success: false, error: delTasksErr.message };
      }

      await deleteStory(story.id);

      return {
        success: true,
        deletedStoryReference: reference,
        deletedTasksCount: draftTasks?.length ?? 0,
        deletedTaskRefs: draftTasks?.map((t) => t.reference) ?? [],
      };
    },
  });
}
