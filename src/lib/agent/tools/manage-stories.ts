import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  deleteStory,
  getStoryByReference,
  promoteTasksForModule,
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
 * Approves a Module end-to-end:
 *   1. Find-or-create the Module (set approvedAt + approvedBy)
 *   2. Link any pending stories that referenced it via proposedModuleName
 *   3. PROMOTE draft tasks under the module's stories to status='backlog'
 *   4. Insert ModuleActivity row for audit trail
 *
 * Mirrors POST /api/modules/[id]/approve (the UI's "Approve" button) — same
 * cascade in a single tool call, so the agent can finish a module without
 * leaving tasks stuck in 'draft'.
 *
 * Idempotent: re-running on an already-approved module is safe (promoted=0,
 * ModuleActivity records the no-op).
 */
export function approveModuleTool(
  projectId: string,
  approverId?: string,
) {
  const safeApproverId = approverId ?? null;
  return tool({
    description:
      "Aprova um módulo de ponta a ponta: marca approvedAt+approvedBy, vincula stories que tinham proposedModuleName, promove tasks 'draft'→'backlog' em cascata e registra ModuleActivity. CHAME APENAS após confirmação explícita do PM. Idempotente.",
    inputSchema: z.object({
      proposedName: z
        .string()
        .min(1)
        .describe(
          "Nome do módulo (proposedModuleName das stories OU nome do Module já existente).",
        ),
      finalName: z
        .string()
        .optional()
        .describe(
          "Nome final do Module se quiser renomear durante a aprovação. Default = proposedName.",
        ),
    }),
    execute: async ({ proposedName, finalName }) => {
      const supabase = db();
      const moduleName = finalName ?? proposedName;
      const nowIso = new Date().toISOString();

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
      let wasAlreadyApproved = false;

      if (existingMod.data) {
        moduleId = existingMod.data.id;
        moduleAlreadyExisted = true;
        wasAlreadyApproved = !!existingMod.data.approvedAt;
        if (!wasAlreadyApproved) {
          const { error: approveErr } = await supabase
            .from("Module")
            .update({
              approvedAt: nowIso,
              approvedBy: safeApproverId,
              updatedAt: nowIso,
            })
            .eq("id", moduleId);
          if (approveErr) return { success: false, error: approveErr.message };
        }
      } else {
        const { data: created, error: createErr } = await supabase
          .from("Module")
          .insert({
            projectId,
            name: moduleName,
            approvedAt: nowIso,
            approvedBy: safeApproverId,
          })
          .select("id")
          .single();
        if (createErr) return { success: false, error: createErr.message };
        moduleId = created!.id;
      }

      const candidates = await supabase
        .from("UserStory")
        .select("id")
        .eq("projectId", projectId)
        .eq("proposedModuleName", proposedName);
      if (candidates.error) {
        return { success: false, error: candidates.error.message };
      }
      const storyIds = (candidates.data ?? []).map((s) => s.id);

      if (storyIds.length > 0) {
        const { error: updErr } = await supabase
          .from("UserStory")
          .update({
            moduleId,
            proposedModuleName: null,
            updatedAt: nowIso,
          })
          .in("id", storyIds);
        if (updErr) return { success: false, error: updErr.message };
      }

      let promoted = 0;
      let totalFp = 0;
      try {
        const result = await promoteTasksForModule(moduleId);
        promoted = result.promoted;
        totalFp = result.totalFp;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: `Promoção de tasks falhou: ${msg}` };
      }

      await supabase.from("ModuleActivity").insert({
        moduleId,
        type: "approved",
        payload: {
          promoted,
          totalFp,
          storiesLinked: storyIds.length,
          wasAlreadyApproved,
          viaTool: "approve_module",
        },
        actorMemberId: safeApproverId,
      });

      return {
        success: true,
        moduleId,
        moduleName,
        moduleAlreadyExisted,
        wasAlreadyApproved,
        storiesPromoted: storyIds.length,
        tasksPromoted: promoted,
        totalFp,
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
