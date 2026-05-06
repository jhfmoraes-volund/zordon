import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { logAgentQuality } from "@/lib/agent/quality-log";

const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
] as const;

// ─── Read ────────────────────────────────────────────────────────────────────

export function getProjectCapacityForOpsTool(projectId: string) {
  return tool({
    description:
      "Retorna a capacidade COMPLETA do projeto em uma chamada: members do squad (com fpAllocation, capacity total, committed, remaining cross-project) + sprints (cap, planejado, disponível). Use ANTES de planejar — substitui múltiplas chamadas de get_member_commitments + get_sprint_capacity. IMPORTANTE: members vêm com `noContract: true` quando estão no squad mas com fpAllocation=0 — nesse caso, peça ao PM pra definir contrato antes de planejar.",
    inputSchema: z.object({}),
    execute: async () => {
      const supabase = db();

      const [{ data: members }, { data: sprints }, { data: commitments }] =
        await Promise.all([
          supabase
            .from("ProjectMember")
            .select(
              "fpAllocation, member:Member(id, name, role, position, fpCapacity)",
            )
            .eq("projectId", projectId),
          supabase
            .from("sprint_capacity_overview")
            .select("sprintId, capacity, planned, done, open")
            .in(
              "sprintId",
              (
                await supabase
                  .from("Sprint")
                  .select("id")
                  .eq("projectId", projectId)
                  .neq("status", "done")
              ).data?.map((s) => s.id) ?? [],
            ),
          supabase
            .from("member_commitment_overview")
            .select("id, name, capacity, committed, remaining, project_count"),
        ]);

      // Annotate sprints with name/dates/status (capacity_overview is keys-only)
      const sprintIds = (sprints ?? [])
        .map((s) => s.sprintId)
        .filter((id): id is string => id != null);
      const { data: sprintMeta } =
        sprintIds.length > 0
          ? await supabase
              .from("Sprint")
              .select("id, name, status, startDate, endDate")
              .in("id", sprintIds)
          : { data: [] };
      const metaById = new Map(
        (sprintMeta ?? []).map((s) => [
          s.id,
          {
            name: s.name,
            status: s.status,
            startDate: s.startDate,
            endDate: s.endDate,
          },
        ]),
      );

      // Cross-project remaining for each project member
      const commitById = new Map(
        (commitments ?? []).map((c) => [
          c.id,
          {
            capacityTotal: c.capacity,
            committedTotal: c.committed,
            remainingTotal: c.remaining,
            projectCount: c.project_count,
          },
        ]),
      );

      const memberRows = (members ?? [])
        .map((row) => {
          const m = row.member as unknown as {
            id: string;
            name: string;
            role: string;
            position: string | null;
            fpCapacity: number;
          } | null;
          if (!m) return null;
          const xp = commitById.get(m.id);
          const fpAllocation = row.fpAllocation ?? 0;
          return {
            id: m.id,
            name: m.name,
            role: m.role,
            position: m.position,
            fpCapacity: m.fpCapacity,
            fpAllocation,
            noContract: fpAllocation === 0,
            capacityTotal: xp?.capacityTotal ?? m.fpCapacity,
            committedTotal: xp?.committedTotal ?? 0,
            remainingTotal: xp?.remainingTotal ?? m.fpCapacity,
            projectCount: xp?.projectCount ?? 0,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r != null)
        .sort((a, b) => b.fpAllocation - a.fpAllocation);

      const sprintRows = (sprints ?? [])
        .map((s) => {
          if (s.sprintId == null) return null;
          const meta = metaById.get(s.sprintId);
          if (!meta) return null;
          const capacity = Number(s.capacity) || 0;
          const planned = Number(s.planned) || 0;
          const open = Number(s.open) || 0;
          return {
            sprintId: s.sprintId,
            name: meta.name,
            status: meta.status,
            startDate: meta.startDate,
            endDate: meta.endDate,
            capacity,
            planned,
            done: Number(s.done) || 0,
            open,
            available: capacity - planned,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r != null)
        .sort((a, b) => {
          const ad = a.startDate ?? "";
          const bd = b.startDate ?? "";
          return ad.localeCompare(bd);
        });

      const totals = {
        members: memberRows.length,
        membersWithContract: memberRows.filter((m) => !m.noContract).length,
        membersWithoutContract: memberRows.filter((m) => m.noContract).length,
        capacityPerSprint: memberRows.reduce(
          (acc, m) => acc + (m.fpAllocation ?? 0),
          0,
        ),
        sprintsOpen: sprintRows.filter((s) => s.status !== "done").length,
        availableAcrossSprints: sprintRows.reduce(
          (acc, s) => acc + Math.max(s.available, 0),
          0,
        ),
      };

      return {
        success: true,
        members: memberRows,
        sprints: sprintRows,
        totals,
      };
    },
  });
}

export function listUnplannedTasksForOpsTool(projectId: string) {
  return tool({
    description:
      "Lista tasks no backlog (sem sprint) prontas pra alocar — só inclui tasks com FP definido. Use ANTES de propor distribuição. Filtra opcionalmente por module ou só tasks vinculadas a story.",
    inputSchema: z.object({
      moduleId: z
        .string()
        .uuid()
        .optional()
        .describe("Filtra por módulo específico (via UserStory.moduleId)."),
      onlyWithStory: z
        .boolean()
        .default(false)
        .describe(
          "Se true, retorna só tasks vinculadas a uma UserStory (userStoryId IS NOT NULL).",
        ),
      limit: z.number().int().min(1).max(300).default(200),
    }),
    execute: async ({ moduleId, onlyWithStory, limit }) => {
      const supabase = db();

      let query = supabase
        .from("Task")
        .select(
          "reference, title, type, scope, complexity, functionPoints, priority, userStoryId, userStory:UserStory(reference, title, moduleId, module:Module(name))",
        )
        .eq("projectId", projectId)
        .eq("status", "backlog")
        .is("sprintId", null)
        .not("functionPoints", "is", null)
        .order("priority", { ascending: false })
        .order("createdAt", { ascending: true })
        .limit(limit);

      if (onlyWithStory) {
        query = query.not("userStoryId", "is", null);
      }

      const { data, error } = await query;
      if (error) return { success: false, error: error.message };

      let tasks = (data ?? []).map((t) => {
        const us = t.userStory as unknown as {
          reference: string;
          title: string;
          moduleId: string | null;
          module: { name: string } | null;
        } | null;
        return {
          reference: t.reference,
          title: t.title,
          type: t.type,
          scope: t.scope,
          complexity: t.complexity,
          functionPoints: t.functionPoints,
          priority: t.priority,
          userStory: us
            ? {
                reference: us.reference,
                title: us.title,
                module: us.module?.name ?? null,
              }
            : null,
        };
      });

      if (moduleId) {
        const filteredIds = new Set(
          (
            await supabase
              .from("UserStory")
              .select("id")
              .eq("projectId", projectId)
              .eq("moduleId", moduleId)
          ).data?.map((s) => s.id) ?? [],
        );
        // userStoryId comparison via re-fetch (Supabase client doesn't expose nested filter)
        const { data: filtered } = await supabase
          .from("Task")
          .select("reference")
          .eq("projectId", projectId)
          .eq("status", "backlog")
          .is("sprintId", null)
          .not("functionPoints", "is", null)
          .in("userStoryId", Array.from(filteredIds));
        const refSet = new Set((filtered ?? []).map((t) => t.reference));
        tasks = tasks.filter((t) => refSet.has(t.reference));
      }

      const totalFp = tasks.reduce(
        (acc, t) => acc + (t.functionPoints ?? 0),
        0,
      );
      const byModule: Record<string, number> = {};
      for (const t of tasks) {
        const m = t.userStory?.module ?? "(sem story)";
        byModule[m] = (byModule[m] ?? 0) + 1;
      }

      return {
        success: true,
        count: tasks.length,
        totalFp,
        byModule,
        tasks,
      };
    },
  });
}

// ─── Write ───────────────────────────────────────────────────────────────────

export function bulkUpdateTasksForOpsTool(
  projectId: string,
  actorId: string,
) {
  return tool({
    description:
      "Atualiza N tasks de uma vez (sprint, assignees, status). ATÔMICO — qualquer erro reverte tudo. Use APENAS após PM confirmar plano em texto. Cada update precisa de taskRef; sprintId/assigneeIds/status são opcionais.",
    inputSchema: z.object({
      updates: z
        .array(
          z.object({
            taskRef: z.string().min(3),
            sprintId: z.string().uuid().nullable().optional(),
            assigneeIds: z.array(z.string().uuid()).optional(),
            status: z.enum(TASK_STATUSES).optional(),
          }),
        )
        .min(1)
        .max(200),
      reasoning: z
        .string()
        .min(10)
        .describe("Por que esse plano — referencie a confirmação do PM."),
    }),
    execute: async ({ updates, reasoning }) => {
      const supabase = db();
      const { data, error } = await supabase.rpc("bulk_update_tasks", {
        p_project_id: projectId,
        // RPC signature expects Json — updates is structurally compatible
        p_updates: updates as unknown as import("@/lib/supabase/database.types").Json,
        p_actor_id: actorId,
      });
      if (error) {
        return { success: false, error: error.message };
      }

      void logAgentQuality({
        projectId,
        memberId: actorId,
        category: "plan_executed",
        payload: {
          tasksUpdated: updates.length,
          sprintsAffected: Array.from(
            new Set(updates.map((u) => u.sprintId).filter((s) => s != null)),
          ),
          uniqueAssignees: Array.from(
            new Set(updates.flatMap((u) => u.assigneeIds ?? [])),
          ).length,
          reasoning,
        },
      });

      return {
        success: true,
        result: data,
      };
    },
  });
}
