import { tool } from "ai";
import { z } from "zod";
import { listTagsForProject } from "@/lib/dal/task-tags";

/**
 * list_project_tags — read-only inventory of project tags.
 *
 * Vitor calls this BEFORE create_task in task_breakdown so it can reuse
 * existing tags (`Front`, `Back`, `Bug`, plus anything the team added)
 * instead of inventing new ones with slightly different names. Reuse keeps
 * the project's tag taxonomy clean and the chip palette consistent.
 */
export function listProjectTagsTool(projectId: string) {
  return tool({
    description:
      "Lista as tags ja existentes neste projeto, com nome e tone (cor). " +
      "Use SEMPRE antes de criar tasks — prefira reutilizar tag existente " +
      "(case-insensitive match) em vez de criar nome novo. Tags canonicas " +
      "comuns: Front (blue), Back (purple), Bug (red).",
    inputSchema: z.object({}),
    execute: async () => {
      const tags = await listTagsForProject(projectId);
      return {
        success: true,
        count: tags.length,
        tags: tags.map((t) => ({ id: t.id, name: t.name, tone: t.tone })),
      };
    },
  });
}
