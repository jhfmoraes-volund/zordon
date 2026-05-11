import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectEditTasksApi } from "@/lib/dal";
import {
  planSprints,
  buildBlockedByMap,
  pointsOf,
  type PlannerTask,
  type PlannerDependency,
  type TaskLayer,
} from "@/lib/sprint-planner";

export const dynamic = "force-dynamic";

const TASK_LAYERS: readonly TaskLayer[] = [
  "DATA",
  "API",
  "REALTIME",
  "UI",
  "OPS",
] as const;

const bodySchema = z.object({
  n: z.number().int().min(1).max(3),
  capacityPerSprint: z.number().int().positive().max(10_000).optional(),
  excludeTaskIds: z.array(z.string().uuid()).max(2000).optional(),
  previewSprintCount: z.number().int().min(0).max(50).optional(),
  targetSprintId: z.string().uuid().optional(),
});

const DEFAULT_CAPACITY_FALLBACK = 40;

type TaskTagLite = { id: string; name: string; tone: string };

type TaskRow = {
  id: string;
  reference: string | null;
  title: string;
  description: string | null;
  layer: string | null;
  status: string;
  userStoryId: string | null;
  functionPoints: number | null;
  sprintId: string | null;
  story: {
    moduleId: string | null;
    module: { id: string; name: string } | null;
  } | null;
  acs: Array<{ acceptanceCriterionId: string }>;
  tags: Array<{ tag: TaskTagLite | null }>;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const denied = await requireProjectEditTasksApi(projectId);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues },
      { status: 400 },
    );
  }

  const supabase = db();

  // database.types.ts está desatualizado — coluna `layer` existe no DB
  // (migration 20260509_zelar_v2_tasks_schema.sql). Cast via unknown.
  const tasksRes = await supabase
    .from("Task")
    .select(
      `id, reference, title, description, layer, status, "userStoryId", "functionPoints", "sprintId",
       story:UserStory("moduleId", module:Module(id, name)),
       acs:TaskAcceptanceCriterion("acceptanceCriterionId"),
       tags:TaskTagAssignment(tag:TaskTag(id, name, tone))`,
    )
    .eq("projectId", projectId)
    .neq("status", "draft");

  if (tasksRes.error) {
    return NextResponse.json({ error: tasksRes.error.message }, { status: 500 });
  }

  const allTasks = (tasksRes.data ?? []) as unknown as TaskRow[];
  const allTaskIds = allTasks.map((t) => t.id);

  const [depsRes, sprintsRes] = await Promise.all([
    allTaskIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ taskId: string; dependsOn: string; kind: string }>, error: null })
      : supabase
          .from("TaskDependency")
          .select("taskId, dependsOn, kind")
          .in("taskId", allTaskIds),
    supabase
      .from("Sprint")
      .select("id, name, goal, startDate, endDate, status")
      .eq("projectId", projectId)
      .order("startDate", { ascending: false })
      .limit(50),
  ]);

  if (depsRes.error)
    return NextResponse.json({ error: depsRes.error.message }, { status: 500 });
  if (sprintsRes.error)
    return NextResponse.json({ error: sprintsRes.error.message }, { status: 500 });

  let targetSprint: {
    id: string;
    name: string;
    goal: string | null;
    startDate: string;
    endDate: string;
    status: string;
  } | null = null;
  if (parsed.data.targetSprintId) {
    targetSprint =
      (sprintsRes.data ?? []).find(
        (s) => s.id === parsed.data.targetSprintId,
      ) ?? null;
    if (!targetSprint) {
      return NextResponse.json(
        { error: "Target sprint não pertence a este projeto" },
        { status: 400 },
      );
    }
  }

  const allSprintIds = (sprintsRes.data ?? []).map((s) => s.id);
  const smRes =
    allSprintIds.length === 0
      ? { data: [] as Array<{ sprintId: string; fpAllocation: number }>, error: null }
      : await supabase
          .from("SprintMember")
          .select("sprintId, fpAllocation")
          .in("sprintId", allSprintIds);
  if (smRes.error)
    return NextResponse.json({ error: smRes.error.message }, { status: 500 });

  const excludeSet = new Set(parsed.data.excludeTaskIds ?? []);
  const candidates: PlannerTask[] = [];
  const alreadyAllocated = new Set<string>();
  // Mapeia taskId → sprintId pra construir rationale (de onde vêm os blockers).
  const sprintIdByTaskId = new Map<string, string>();
  // fpBySprint = soma empírica de Task.functionPoints (excluindo status=backlog)
  // — é assim que o /api/sprints calcula `totalFp`, é o sinal real de capacidade.
  const fpBySprint = new Map<string, number>();
  for (const t of allTasks) {
    if (t.sprintId) {
      alreadyAllocated.add(t.id);
      sprintIdByTaskId.set(t.id, t.sprintId);
      if (t.status !== "backlog") {
        fpBySprint.set(
          t.sprintId,
          (fpBySprint.get(t.sprintId) ?? 0) + (t.functionPoints ?? 0),
        );
      }
      continue;
    }
    if (excludeSet.has(t.id)) {
      alreadyAllocated.add(t.id);
      continue;
    }
    const layer =
      t.layer && (TASK_LAYERS as readonly string[]).includes(t.layer)
        ? (t.layer as TaskLayer)
        : null;
    candidates.push({
      id: t.id,
      reference: t.reference,
      title: t.title,
      layer,
      moduleId: t.story?.moduleId ?? null,
      userStoryId: t.userStoryId,
      acCount: t.acs?.length ?? 0,
      functionPoints: t.functionPoints,
    });
  }

  const dependencies: PlannerDependency[] = (depsRes.data ?? [])
    .filter((d) => d.kind?.toLowerCase() === "blocks")
    .map((d) => ({ taskId: d.taskId, dependsOn: d.dependsOn }));

  // Capacidade: primeira escolha = soma empírica de FP das últimas 3 sprints
  // (>0). Fallback = soma de SprintMember.fpAllocation. Fallback final = 40.
  const lastSprintIds = (sprintsRes.data ?? []).slice(0, 3).map((s) => s.id);
  const fpSums = lastSprintIds
    .map((id) => fpBySprint.get(id) ?? 0)
    .filter((v) => v > 0);

  const allocBySprint = new Map<string, number>();
  for (const sm of smRes.data ?? []) {
    allocBySprint.set(
      sm.sprintId,
      (allocBySprint.get(sm.sprintId) ?? 0) + (sm.fpAllocation ?? 0),
    );
  }
  const smSums = lastSprintIds
    .map((id) => allocBySprint.get(id) ?? 0)
    .filter((v) => v > 0);

  let computedDefault: number;
  if (targetSprint) {
    const targetFp = fpBySprint.get(targetSprint.id) ?? 0;
    const targetAlloc = allocBySprint.get(targetSprint.id) ?? 0;
    // Sprint vazia: usa média do projeto. Caso contrário: o que a sprint tem.
    if (targetFp > 0) computedDefault = targetFp;
    else if (targetAlloc > 0) computedDefault = targetAlloc;
    else if (fpSums.length > 0)
      computedDefault = Math.round(
        fpSums.reduce((s, v) => s + v, 0) / fpSums.length,
      );
    else if (smSums.length > 0)
      computedDefault = Math.round(
        smSums.reduce((s, v) => s + v, 0) / smSums.length,
      );
    else computedDefault = DEFAULT_CAPACITY_FALLBACK;
  } else if (fpSums.length > 0) {
    computedDefault = Math.round(
      fpSums.reduce((s, v) => s + v, 0) / fpSums.length,
    );
  } else if (smSums.length > 0) {
    computedDefault = Math.round(
      smSums.reduce((s, v) => s + v, 0) / smSums.length,
    );
  } else {
    computedDefault = DEFAULT_CAPACITY_FALLBACK;
  }
  const capacityPerSprint = parsed.data.capacityPerSprint ?? computedDefault;

  const effectiveN = targetSprint ? 1 : parsed.data.n;

  const existingSprintCount = sprintsRes.data?.length ?? 0;
  const previewSprintCount = parsed.data.previewSprintCount ?? 0;
  const nextSprintNumber = existingSprintCount + previewSprintCount + 1;

  const output = planSprints({
    candidates,
    alreadyAllocated,
    dependencies,
    n: effectiveN,
    capacityPerSprint,
    nextSprintNumber,
  });

  const blockedByMap = buildBlockedByMap(dependencies);
  const refOf = new Map<string, string>();
  const titleOf = new Map<string, string>();
  const moduleByTaskId = new Map<string, { id: string; name: string }>();
  const sprintNameById = new Map<string, string>();
  for (const t of allTasks) {
    refOf.set(t.id, t.reference ?? t.id);
    titleOf.set(t.id, t.title);
    if (t.story?.module) {
      moduleByTaskId.set(t.id, {
        id: t.story.module.id,
        name: t.story.module.name,
      });
    }
  }
  for (const sp of sprintsRes.data ?? []) sprintNameById.set(sp.id, sp.name);

  // dependents map: blockerId → ids que dependem dele
  const dependentsOf = new Map<string, Set<string>>();
  for (const dep of dependencies) {
    let arr = dependentsOf.get(dep.dependsOn);
    if (!arr) dependentsOf.set(dep.dependsOn, (arr = new Set()));
    arr.add(dep.taskId);
  }

  const candidateIdSet = new Set(candidates.map((c) => c.id));
  // refs no plano (todas as sprints) — usado pra detectar deps intra-plano.
  const allPlannedIds = new Set<string>();
  for (const s of output.sprints) for (const t of s.tasks) allPlannedIds.add(t.id);

  function normalizeDescription(text: string | null | undefined): string | null {
    if (!text) return null;
    const trimmed = text.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  function buildTaskReason(t: PlannerTask): {
    unblocks: string[];
    unblocksCount: number;
    layerReason: string | null;
    acCount: number;
  } {
    const dependents = dependentsOf.get(t.id) ?? new Set();
    const unblocksRefs: string[] = [];
    for (const id of dependents) {
      if (candidateIdSet.has(id)) {
        unblocksRefs.push(refOf.get(id) ?? id);
      }
    }
    return {
      unblocks: unblocksRefs.slice(0, 5),
      unblocksCount: unblocksRefs.length,
      layerReason: t.layer,
      acCount: t.acCount,
    };
  }

  // Per-sprint rationale: o porquê PROJETO-específico (linguagem humana).
  type RationaleTaskRef = {
    ref: string;
    title: string;
    module: string | null;
  };
  type DependsOnRef = RationaleTaskRef & {
    fromSprintName: string | null; // sprint anterior do banco OU "Sprint sugerida #N"
  };
  type ModuleEnabled = { id: string; name: string; count: number };
  type SprintRationale = {
    dependsOn: DependsOnRef[];
    enablesCount: number;
    /** Top 3 módulos do backlog que ficam desbloqueados ao terminar essa sprint. */
    enablesByModule: ModuleEnabled[];
    /** Lista de módulos representados nas tasks dessa sprint (top 3). */
    primaryModules: ModuleEnabled[];
    layerDistribution: Record<TaskLayer, number>;
    topTags: Array<{ id: string; name: string; tone: string; count: number }>;
    /** Top 3 tasks que mais desbloqueiam — agora com module. */
    keyHubs: Array<{
      ref: string;
      title: string;
      module: string | null;
      unblocks: number;
    }>;
    summary: "foundation" | "builds-on" | "mixed";
  };

  // Mapa: taskId → tags reais (objetos {id,name,tone}) do projeto.
  const tagsByTaskId = new Map<string, TaskTagLite[]>();
  for (const t of allTasks) {
    const list: TaskTagLite[] = [];
    for (const entry of t.tags ?? []) {
      if (entry?.tag) list.push(entry.tag);
    }
    if (list.length > 0) tagsByTaskId.set(t.id, list);
  }

  // Construir rationale levando em conta sprints anteriores DENTRO do plano + alreadyAllocated.
  const prevPlannedIds = new Set<string>(); // tasks de sprints anteriores no plano (acumulativo)
  const sprintRationales: SprintRationale[] = [];

  for (let k = 0; k < output.sprints.length; k++) {
    const sprint = output.sprints[k];
    const here = new Set(sprint.tasks.map((t) => t.id));

    const dependsOn = new Map<string, DependsOnRef>();
    const layerDist: Record<TaskLayer, number> = {
      DATA: 0, API: 0, REALTIME: 0, UI: 0, OPS: 0,
    };

    for (const t of sprint.tasks) {
      if (t.layer) layerDist[t.layer]++;
    }

    // buildBlockedByMap retorna Map<taskId, dependsOn-ids[]>, então precisamos
    // mapear via refOf. Acessamos via task.id e nos dep IDs originais.
    for (const dep of dependencies) {
      if (!here.has(dep.taskId)) continue;
      const blockerId = dep.dependsOn;
      // Pula blockers que estão na MESMA sprint (intra-sprint dep, não é "depende de uma sprint anterior")
      if (here.has(blockerId)) continue;
      // Só conta blockers que estão alocados antes (em sprint prévia OU já no DB)
      if (
        !alreadyAllocated.has(blockerId) &&
        !prevPlannedIds.has(blockerId)
      )
        continue;
      if (dependsOn.has(blockerId)) continue;
      const fromSprintId = sprintIdByTaskId.get(blockerId) ?? null;
      const fromSprintName = fromSprintId
        ? sprintNameById.get(fromSprintId) ?? null
        : null;
      dependsOn.set(blockerId, {
        ref: refOf.get(blockerId) ?? blockerId,
        title: titleOf.get(blockerId) ?? "",
        module: moduleByTaskId.get(blockerId)?.name ?? null,
        fromSprintName: prevPlannedIds.has(blockerId)
          ? `Sprint sugerida #${
              output.sprints
                .slice(0, k)
                .findIndex((s) => s.tasks.some((tt) => tt.id === blockerId)) +
              1
            }`
          : fromSprintName,
      });
    }

    // enables: tasks no backlog (candidates) que dependem de pelo menos uma task daqui
    // E não estão aqui nem em sprints anteriores do plano
    const enablesSet = new Set<string>();
    for (const t of sprint.tasks) {
      const deps = dependentsOf.get(t.id) ?? new Set();
      for (const id of deps) {
        if (here.has(id)) continue;
        if (prevPlannedIds.has(id)) continue;
        if (allPlannedIds.has(id)) {
          enablesSet.add(id);
        } else if (candidateIdSet.has(id)) {
          enablesSet.add(id);
        }
      }
    }

    // Agrega módulos das tasks que serão desbloqueadas (top 3).
    const enablesModuleCounts = new Map<string, ModuleEnabled>();
    for (const id of enablesSet) {
      const mod = moduleByTaskId.get(id);
      if (!mod) continue;
      const existing = enablesModuleCounts.get(mod.id);
      if (existing) existing.count++;
      else
        enablesModuleCounts.set(mod.id, {
          id: mod.id,
          name: mod.name,
          count: 1,
        });
    }
    const enablesByModule = [...enablesModuleCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Agrega módulos das tasks DENTRO dessa sprint (top 3).
    const primaryModuleCounts = new Map<string, ModuleEnabled>();
    for (const t of sprint.tasks) {
      const mod = moduleByTaskId.get(t.id);
      if (!mod) continue;
      const existing = primaryModuleCounts.get(mod.id);
      if (existing) existing.count++;
      else
        primaryModuleCounts.set(mod.id, {
          id: mod.id,
          name: mod.name,
          count: 1,
        });
    }
    const primaryModules = [...primaryModuleCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // key hubs: tasks dessa sprint com mais dependentes (que serão desbloqueados)
    const hubsCandidates = sprint.tasks.map((t) => {
      const deps = dependentsOf.get(t.id) ?? new Set();
      let count = 0;
      for (const id of deps) {
        if (!here.has(id)) count++;
      }
      return {
        ref: refOf.get(t.id) ?? t.id,
        title: t.title,
        module: moduleByTaskId.get(t.id)?.name ?? null,
        unblocks: count,
      };
    });
    hubsCandidates.sort((a, b) => b.unblocks - a.unblocks);
    const keyHubs = hubsCandidates.filter((h) => h.unblocks > 0).slice(0, 3);

    const summary: SprintRationale["summary"] =
      dependsOn.size > 0 ? "builds-on" : keyHubs.length > 0 ? "foundation" : "mixed";

    // Agrega tags reais do projeto: conta quantas vezes cada tag aparece nas
    // tasks dessa sprint, mantém metadata (tone) da primeira ocorrência.
    const tagCounts = new Map<
      string,
      { id: string; name: string; tone: string; count: number }
    >();
    for (const t of sprint.tasks) {
      const tags = tagsByTaskId.get(t.id) ?? [];
      for (const tag of tags) {
        const existing = tagCounts.get(tag.id);
        if (existing) existing.count++;
        else
          tagCounts.set(tag.id, {
            id: tag.id,
            name: tag.name,
            tone: tag.tone,
            count: 1,
          });
      }
    }
    const topTags = [...tagCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    sprintRationales.push({
      dependsOn: [...dependsOn.values()].slice(0, 6),
      enablesCount: enablesSet.size,
      enablesByModule,
      primaryModules,
      layerDistribution: layerDist,
      topTags,
      keyHubs,
      summary,
    });

    // Acumula pra próxima iteração
    for (const id of here) prevPlannedIds.add(id);
  }

  return NextResponse.json({
    sprints: output.sprints.map((s, idx) => {
      const sprintMeta = targetSprint
        ? {
            suggestedName: targetSprint.name,
            suggestedGoal: targetSprint.goal ?? "",
          }
        : { suggestedName: s.suggestedName, suggestedGoal: s.suggestedGoal };
      return {
        ...sprintMeta,
        capacityPoints: capacityPerSprint,
        totalPoints: s.totalPoints,
        rationale: sprintRationales[idx],
        tasks: s.tasks.map((t) => {
          const taskRow = allTasks.find((tt) => tt.id === t.id);
          return {
            id: t.id,
            reference: t.reference,
            title: t.title,
            description: normalizeDescription(taskRow?.description),
            layer: t.layer,
            moduleId: t.moduleId,
            module: moduleByTaskId.get(t.id) ?? null,
            points: pointsOf(t),
            tags: tagsByTaskId.get(t.id) ?? [],
            blockedBy:
              blockedByMap.get(t.id)?.map((bid) => refOf.get(bid) ?? bid) ?? [],
            reason: buildTaskReason(t),
          };
        }),
        warnings: s.warnings,
      };
    }),
    leftover: output.leftover.map((l) => ({
      id: l.task.id,
      reference: l.task.reference,
      title: l.task.title,
      layer: l.task.layer,
      module: moduleByTaskId.get(l.task.id) ?? null,
      points: pointsOf(l.task),
      tags: tagsByTaskId.get(l.task.id) ?? [],
      reason: l.reason,
    })),
    context: {
      totalBacklog: candidates.length,
      alreadyAllocated: alreadyAllocated.size,
      nextSprintNumber,
      capacityPerSprint,
      capacityDefault: computedDefault,
      capacitySource:
        fpSums.length > 0
          ? "task_function_points_avg"
          : smSums.length > 0
            ? "sprint_member_allocation_avg"
            : "fallback_40",
      mode: targetSprint ? "fill-existing" : "create-new",
      targetSprintId: targetSprint?.id ?? null,
      targetSprintName: targetSprint?.name ?? null,
    },
  });
}
