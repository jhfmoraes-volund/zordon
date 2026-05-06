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
      "Retorna a capacidade COMPLETA do projeto em uma chamada: members do squad (com fpAllocation, capacity total, committed, remaining cross-project) + sprints (cap, planejado, disponível). Use ANTES de planejar. IMPORTANTE: members vêm com `noContract: true` quando estão no squad mas com fpAllocation=0 — nesse caso, peça ao PM pra definir contrato antes de planejar.",
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

// ─── Verify (read, calcula totais server-side) ───────────────────────────────

/**
 * Recebe a distribuição planejada e devolve totais agregados por sprint e
 * assignee, calculados via SQL — sem confiar na aritmética do modelo.
 * Mata o bug "alucina soma" descoberto no audit 2026-05-06.
 *
 * Use ANTES de mostrar tabela resumo ao PM em planos com >20 tasks. Os
 * números retornados aqui são canonical — qualquer divergência da tabela
 * é alucinação do modelo.
 */
export function verifySprintDistributionForOpsTool(projectId: string) {
  return tool({
    description:
      "Calcula totais reais por sprint e assignee a partir de uma distribuição planejada. Retorna FP somado server-side via SQL — NUNCA confie em soma manual em planos com mais de 20 tasks. Use ANTES de mostrar tabela resumo ao PM. Resolve o bug histórico de alucinar totais.",
    inputSchema: z.object({
      updates: z
        .array(
          z.object({
            taskRef: z.string().min(3),
            sprintId: z.string().uuid().nullable().optional(),
            assigneeIds: z.array(z.string().uuid()).optional(),
          }),
        )
        .min(1)
        .max(300),
    }),
    execute: async ({ updates }) => {
      const supabase = db();

      const taskRefs = updates.map((u) => u.taskRef);
      const { data: tasks, error } = await supabase
        .from("Task")
        .select("reference, functionPoints")
        .eq("projectId", projectId)
        .in("reference", taskRefs);

      if (error) return { success: false, error: error.message };

      const fpByRef = new Map(
        (tasks ?? []).map((t) => [t.reference, t.functionPoints ?? 0]),
      );
      const missingRefs = taskRefs.filter((r) => !fpByRef.has(r));

      const sprintIds = Array.from(
        new Set(
          updates
            .map((u) => u.sprintId)
            .filter((s): s is string => s != null && s !== ""),
        ),
      );
      const memberIds = Array.from(
        new Set(updates.flatMap((u) => u.assigneeIds ?? [])),
      );

      const [{ data: sprints }, { data: members }] = await Promise.all([
        sprintIds.length > 0
          ? supabase
              .from("Sprint")
              .select("id, name, projectId")
              .in("id", sprintIds)
          : Promise.resolve({ data: [] as { id: string; name: string; projectId: string }[] }),
        memberIds.length > 0
          ? supabase.from("Member").select("id, name").in("id", memberIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);

      const sprintById = new Map(
        (sprints ?? []).map((s) => [s.id, s]),
      );
      const memberById = new Map((members ?? []).map((m) => [m.id, m.name]));

      const wrongSprintRefs = updates
        .filter((u) => u.sprintId && sprintById.get(u.sprintId)?.projectId !== projectId)
        .map((u) => ({ taskRef: u.taskRef, sprintId: u.sprintId }));

      type SprintAgg = {
        sprintId: string | null;
        sprintName: string;
        totalFp: number;
        taskCount: number;
        byAssignee: Record<string, { name: string; fp: number; tasks: number }>;
        unassignedFp: number;
        unassignedTasks: number;
      };

      const bySprint = new Map<string, SprintAgg>();
      const ensure = (sprintId: string | null): SprintAgg => {
        const key = sprintId ?? "__backlog__";
        let agg = bySprint.get(key);
        if (!agg) {
          agg = {
            sprintId,
            sprintName: sprintId
              ? sprintById.get(sprintId)?.name ?? "(sprint inválido)"
              : "(backlog)",
            totalFp: 0,
            taskCount: 0,
            byAssignee: {},
            unassignedFp: 0,
            unassignedTasks: 0,
          };
          bySprint.set(key, agg);
        }
        return agg;
      };

      for (const u of updates) {
        const fp = fpByRef.get(u.taskRef) ?? 0;
        const agg = ensure(u.sprintId ?? null);
        agg.totalFp += fp;
        agg.taskCount += 1;
        const assignees = u.assigneeIds ?? [];
        if (assignees.length === 0) {
          agg.unassignedFp += fp;
          agg.unassignedTasks += 1;
        } else {
          for (const memberId of assignees) {
            const name = memberById.get(memberId) ?? "(member desconhecido)";
            const row = agg.byAssignee[memberId] ?? {
              name,
              fp: 0,
              tasks: 0,
            };
            row.fp += fp;
            row.tasks += 1;
            agg.byAssignee[memberId] = row;
          }
        }
      }

      const sprintRows = Array.from(bySprint.values()).sort((a, b) =>
        a.sprintName.localeCompare(b.sprintName),
      );

      const grandTotalFp = sprintRows.reduce((acc, s) => acc + s.totalFp, 0);
      const grandTotalTasks = updates.length;

      return {
        success: true,
        sprints: sprintRows,
        grandTotalFp,
        grandTotalTasks,
        warnings: {
          tasksNotFound: missingRefs,
          sprintsNotInProject: wrongSprintRefs,
        },
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
