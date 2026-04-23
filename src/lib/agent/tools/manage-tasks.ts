import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { suggestFunctionPoints } from "@/lib/function-points";
import type { Database } from "@/lib/supabase/database.types";

type TaskUpdate = Database["public"]["Tables"]["Task"]["Update"];

const complexityEnum = z.enum(["trivial", "low", "medium", "high"]);
const scopeEnum = z.enum(["micro", "small", "medium", "large"]);
const categoryEnum = z.enum(["frontend", "backend", "infra", "integration", "design"]);

/**
 * Lists tasks of the current session. Use ALWAYS before proposing any
 * update/delete, so the agent knows the real current state.
 */
export function listSessionTasksTool(sessionId: string) {
  return tool({
    description:
      "Lista todas as tasks desta design session (reference, title, status, complexity, scope, functionPoints, notes). Use SEMPRE antes de propor update/delete ou para entender o estado atual.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data, error } = await db()
        .from("Task")
        .select(
          "id, reference, title, description, status, complexity, scope, functionPoints, notes, dependencies"
        )
        .eq("designSessionId", sessionId)
        .order("reference", { ascending: true });

      if (error) return { success: false, error: error.message };
      return { success: true, tasks: data ?? [] };
    },
  });
}

/**
 * Lists tasks from OTHER sessions of the same project (read-only).
 * Purpose: avoid generating duplicate tasks across sessions.
 */
export function listProjectTasksTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Lista tasks de OUTRAS sessions do mesmo projeto (read-only). Use antes de criar novas tasks para evitar duplicatas — se algo parecido ja existe, mencione ao usuario antes de criar.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data, error } = await db()
        .from("Task")
        .select(
          "reference, title, status, designSessionId, designSession:DesignSession(title)"
        )
        .eq("projectId", projectId)
        .neq("designSessionId", sessionId);

      if (error) return { success: false, error: error.message };
      const tasks = (data ?? []).map((t) => {
        const ds = t.designSession as unknown as { title?: string } | null;
        return {
          reference: t.reference,
          title: t.title,
          status: t.status,
          sessionTitle: ds?.title ?? null,
        };
      });
      return { success: true, tasks };
    },
  });
}

/**
 * Updates a task — scoped to the current session. Refuses silently if the
 * task belongs to another session (defensive double-guard).
 */
export function updateTaskTool(sessionId: string) {
  return tool({
    description:
      "Atualiza campos de uma task existente desta session. Use APENAS apos confirmar a mudanca com o usuario. Recalcula functionPoints automaticamente se scope/complexity mudarem. Rejeita tasks que nao pertencem a esta session.",
    inputSchema: z.object({
      taskId: z.string().describe("ID da task (uuid)"),
      updates: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        acceptanceCriteria: z.array(z.string()).optional(),
        notes: z.string().optional().nullable(),
        complexity: complexityEnum.optional(),
        scope: scopeEnum.optional(),
        dependsOn: z.array(z.string()).optional(),
        category: categoryEnum.optional(),
        module: z.string().optional(),
      }),
    }),
    execute: async ({ taskId, updates }) => {
      const supabase = db();

      const { data: existing, error: fetchErr } = await supabase
        .from("Task")
        .select("id, designSessionId, complexity, scope, notes")
        .eq("id", taskId)
        .maybeSingle();

      if (fetchErr) return { success: false, error: fetchErr.message };
      if (!existing)
        return { success: false, error: `Task ${taskId} nao encontrada` };
      if (existing.designSessionId !== sessionId)
        return {
          success: false,
          error:
            "Task pertence a outra session — nao pode ser editada daqui. Peca ao usuario para abrir a session de origem.",
        };

      const payload: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (updates.title !== undefined) payload.title = updates.title;
      if (updates.description !== undefined)
        payload.description = updates.description;
      if (updates.acceptanceCriteria !== undefined)
        payload.acceptanceCriteria = JSON.stringify(updates.acceptanceCriteria);
      if (updates.dependsOn !== undefined)
        payload.dependencies = updates.dependsOn.length
          ? JSON.stringify(updates.dependsOn)
          : null;

      if (updates.complexity !== undefined) payload.complexity = updates.complexity;
      if (updates.scope !== undefined) payload.scope = updates.scope;

      // Recalculate FP if either changed
      if (updates.complexity !== undefined || updates.scope !== undefined) {
        const newComplexity = updates.complexity ?? existing.complexity;
        const newScope = updates.scope ?? existing.scope;
        payload.functionPoints = suggestFunctionPoints(newScope, newComplexity);
      }

      // notes: merge category/module prefix if supplied, preserving prior text
      if (
        updates.notes !== undefined ||
        updates.category !== undefined ||
        updates.module !== undefined
      ) {
        const prior = (existing.notes as string | null) ?? "";
        const priorText = prior.replace(/^\[[^\]]+\](?:\s*\|\s*\[[^\]]+\])?\s*(?:—\s*)?/, "");
        const baseText =
          updates.notes !== undefined ? updates.notes ?? "" : priorText;
        const metaParts = [
          updates.category ? `[Categoria: ${updates.category}]` : null,
          updates.module ? `[Modulo: ${updates.module}]` : null,
        ].filter(Boolean);
        payload.notes = metaParts.length
          ? `${metaParts.join(" | ")}${baseText ? ` — ${baseText}` : ""}`
          : baseText || null;
      }

      const { data: updated, error: updateErr } = await supabase
        .from("Task")
        .update(payload as TaskUpdate)
        .eq("id", taskId)
        .eq("designSessionId", sessionId)
        .select("id, reference, title, functionPoints")
        .single();

      if (updateErr) return { success: false, error: updateErr.message };

      return {
        success: true,
        reference: updated!.reference,
        title: updated!.title,
        functionPoints: updated!.functionPoints,
      };
    },
  });
}

/**
 * Deletes a task — scoped to the current session. Also removes the linked
 * DesignSessionItem (if AI-generated) to keep backlog clean.
 */
export function deleteTaskTool(sessionId: string) {
  return tool({
    description:
      "Remove uma task desta session. Use APENAS apos confirmar com o usuario. Rejeita tasks que nao pertencem a esta session.",
    inputSchema: z.object({
      taskId: z.string().describe("ID da task (uuid)"),
    }),
    execute: async ({ taskId }) => {
      const supabase = db();

      const { data: existing, error: fetchErr } = await supabase
        .from("Task")
        .select("id, reference, title, designSessionId")
        .eq("id", taskId)
        .maybeSingle();

      if (fetchErr) return { success: false, error: fetchErr.message };
      if (!existing)
        return { success: false, error: `Task ${taskId} nao encontrada` };
      if (existing.designSessionId !== sessionId)
        return {
          success: false,
          error:
            "Task pertence a outra session — nao pode ser removida daqui.",
        };

      const { error: delErr } = await supabase
        .from("Task")
        .delete()
        .eq("id", taskId)
        .eq("designSessionId", sessionId);

      if (delErr) return { success: false, error: delErr.message };

      // Best-effort: remove orphaned AI-generated DesignSessionItem with same title
      await supabase
        .from("DesignSessionItem")
        .delete()
        .eq("sessionId", sessionId)
        .eq("aiGenerated", true)
        .eq("title", existing.title);

      return {
        success: true,
        reference: existing.reference,
        title: existing.title,
      };
    },
  });
}
