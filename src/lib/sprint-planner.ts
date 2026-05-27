/**
 * Sprint planner — pure, deterministic.
 *
 * Story-first vertical slicing. Tasks são agrupadas por `userStoryId` e cada
 * story é a unidade primária do planejamento. Stories são scoradas e visitadas
 * em ordem de score por sprint. Quando uma story cabe inteira, todas as suas
 * tasks elegíveis vão pra mesma sprint. Quando não cabe:
 *
 * - Story COM tasks de UI → o split precisa incluir uma "UI closure" (uma
 *   task UI + suas dependências intra-story que ainda não foram alocadas),
 *   garantindo que a sprint produza saída demoável.
 * - Story SEM UI (puro backend) → split livre, greedy por score.
 *
 * Tasks sem `userStoryId` viram buckets singleton (preserva semântica antiga
 * pra tasks soltas / projetos sem story hierarchy).
 *
 * Documentação completa em `docs/features/sprints/sprint-planner-plan.md`.
 */

export type TaskLayer = "DATA" | "API" | "REALTIME" | "UI" | "OPS";

const LAYER_RANK: Record<TaskLayer, number> = {
  DATA: 5,
  API: 4,
  REALTIME: 3,
  UI: 2,
  OPS: 1,
};

export type PlannerTask = {
  id: string;
  reference: string | null;
  title: string;
  layer: TaskLayer | null;
  moduleId: string | null;
  userStoryId: string | null;
  /** TaskAcceptanceCriterion count — proxy de valor. */
  acCount: number;
  /** Estimate. null/<=0 vira 1 ponto. */
  functionPoints: number | null;
};

export type PlannerDependency = {
  taskId: string;
  dependsOn: string;
};

export type PlannerWarning =
  | { type: "LOW_LAYER_DIVERSITY"; sprintIndex: number }
  | {
      type: "OVERCAPACITY";
      sprintIndex: number;
      taskId: string;
      points: number;
    }
  | { type: "NO_UI_TASK"; sprintIndex: number }
  | {
      type: "STORY_SPLIT_ACROSS_SPRINTS";
      sprintIndex: number;
      storyId: string;
    };

export type PlannerLeftoverReason = "CAPACITY" | "BLOCKED_BY_BACKLOG";

export type PlannerInput = {
  candidates: PlannerTask[];
  /** taskIds já alocados em qualquer sprint (sprintId IS NOT NULL). */
  alreadyAllocated: Set<string>;
  /** TaskDependency do projeto pré-filtrado por kind='blocks'. */
  dependencies: PlannerDependency[];
  n: number;
  capacityPerSprint: number;
  /** Próximo número humano. PM cria "Sprint 4" se 3 já existem. */
  nextSprintNumber: number;
  /**
   * userStoryIds que têm ≥1 task em alreadyAllocated. Tasks restantes dessas
   * stories ganham continuity bonus pra serem concluídas antes de abrir
   * stories novas. Opcional (default: empty).
   */
  inProgressStoryIds?: Set<string>;
  /**
   * moduleIds que têm ≥1 task em alreadyAllocated. Stories novas em módulos
   * em andamento ganham bonus menor que story-level. Opcional.
   */
  inProgressModuleIds?: Set<string>;
};

export type PlannerSprintOutput = {
  suggestedName: string;
  suggestedGoal: string;
  tasks: PlannerTask[];
  totalPoints: number;
  warnings: PlannerWarning[];
};

export type PlannerLeftoverEntry = {
  task: PlannerTask;
  reason: PlannerLeftoverReason;
};

export type PlannerOutput = {
  sprints: PlannerSprintOutput[];
  leftover: PlannerLeftoverEntry[];
};

export function pointsOf(task: PlannerTask): number {
  const fp = task.functionPoints;
  return fp == null || fp <= 0 ? 1 : fp;
}

function stableHash(id: string): number {
  // FNV-1a 32-bit. Determinístico, suficiente como tiebreaker.
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0xffffffff;
}

/** Bonus pra stories reais (>1 task, userStoryId não-null) sobre singletons. */
const STORY_COHESION_BONUS = 200;
/** Bonus pra stories que entregam saída demoável (≥1 task UI). */
const STORY_HAS_UI_BONUS = 150;

export function planSprints(input: PlannerInput): PlannerOutput {
  const {
    candidates,
    alreadyAllocated,
    dependencies,
    n,
    capacityPerSprint,
    nextSprintNumber,
  } = input;
  const inProgressStoryIds = input.inProgressStoryIds ?? new Set<string>();
  const inProgressModuleIds = input.inProgressModuleIds ?? new Set<string>();

  if (capacityPerSprint <= 0) {
    throw new Error("planSprints: capacityPerSprint must be > 0");
  }
  if (n < 0) {
    throw new Error("planSprints: n must be >= 0");
  }

  if (n === 0) {
    return {
      sprints: [],
      leftover: candidates.map((task) => ({
        task,
        reason: "BLOCKED_BY_BACKLOG" as const,
      })),
    };
  }

  // Grafo de dependências.
  const blockersOf = new Map<string, Set<string>>();
  const dependentsOf = new Map<string, Set<string>>();
  for (const dep of dependencies) {
    if (dep.taskId === dep.dependsOn) continue;
    let b = blockersOf.get(dep.taskId);
    if (!b) blockersOf.set(dep.taskId, (b = new Set()));
    b.add(dep.dependsOn);
    let d = dependentsOf.get(dep.dependsOn);
    if (!d) dependentsOf.set(dep.dependsOn, (d = new Set()));
    d.add(dep.taskId);
  }

  const candidateIds = new Set(candidates.map((t) => t.id));
  const taskById = new Map<string, PlannerTask>(
    candidates.map((t) => [t.id, t]),
  );

  const dependentsInBacklogCache = new Map<string, number>();
  function dependentsInBacklog(taskId: string): number {
    let v = dependentsInBacklogCache.get(taskId);
    if (v !== undefined) return v;
    const deps = dependentsOf.get(taskId);
    v = 0;
    if (deps) for (const id of deps) if (candidateIds.has(id)) v++;
    dependentsInBacklogCache.set(taskId, v);
    return v;
  }

  function taskScore(task: PlannerTask): number {
    const layerScore = task.layer ? LAYER_RANK[task.layer] : 0;
    return (
      1000 * dependentsInBacklog(task.id) +
      100 * layerScore +
      10 * task.acCount
    );
  }

  // ─── Story buckets ─────────────────────────────────────────────────────
  // Cada userStoryId vira um bucket. Tasks sem story viram singletons
  // (bucketId = `__solo__<taskId>`, realStoryId = null).
  // `tier` reflete continuidade com sprints anteriores:
  //   1 = story já tem tasks em alreadyAllocated → finish what's started
  //   2 = story fresh mas seu módulo tem tasks em alreadyAllocated → in-flight area
  //   3 = nem story nem módulo iniciados → fresh
  type StoryBucket = {
    bucketId: string;
    realStoryId: string | null;
    tasks: PlannerTask[];
    totalPoints: number;
    hasUI: boolean;
    bestTaskScore: number;
    hashTiebreak: number;
    tier: 1 | 2 | 3;
  };

  const byBucket = new Map<string, StoryBucket>();
  for (const task of candidates) {
    const bucketId = task.userStoryId ?? `__solo__${task.id}`;
    let bucket = byBucket.get(bucketId);
    if (!bucket) {
      bucket = {
        bucketId,
        realStoryId: task.userStoryId,
        tasks: [],
        totalPoints: 0,
        hasUI: false,
        bestTaskScore: -Infinity,
        hashTiebreak: stableHash(bucketId),
        tier: 3,
      };
      byBucket.set(bucketId, bucket);
    }
    bucket.tasks.push(task);
    bucket.totalPoints += pointsOf(task);
    if (task.layer === "UI") bucket.hasUI = true;
    const ts = taskScore(task);
    if (ts > bucket.bestTaskScore) bucket.bestTaskScore = ts;
  }

  // Determina tier por bucket.
  for (const bucket of byBucket.values()) {
    if (
      bucket.realStoryId !== null &&
      inProgressStoryIds.has(bucket.realStoryId)
    ) {
      bucket.tier = 1;
      continue;
    }
    if (
      bucket.tasks.some(
        (t) => t.moduleId != null && inProgressModuleIds.has(t.moduleId),
      )
    ) {
      bucket.tier = 2;
      continue;
    }
    bucket.tier = 3;
  }

  function bucketScore(bucket: StoryBucket): number {
    const isVerticalSlice =
      bucket.tasks.length > 1 && bucket.realStoryId !== null;
    return (
      bucket.bestTaskScore +
      (isVerticalSlice ? STORY_COHESION_BONUS : 0) +
      (isVerticalSlice && bucket.hasUI ? STORY_HAS_UI_BONUS : 0)
    );
  }

  // Sort lexicográfico: tier asc (1 → 3), depois score desc, depois hash.
  const sortedBuckets = [...byBucket.values()].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const diff = bucketScore(b) - bucketScore(a);
    if (diff !== 0) return diff;
    return a.hashTiebreak - b.hashTiebreak;
  });

  const placed = new Set<string>(alreadyAllocated);
  const taken = new Set<string>();

  function isUnblocked(taskId: string, plus?: Set<string>): boolean {
    const blockers = blockersOf.get(taskId);
    if (!blockers || blockers.size === 0) return true;
    for (const b of blockers) {
      if (placed.has(b)) continue;
      if (plus && plus.has(b)) continue;
      return false;
    }
    return true;
  }

  /**
   * UI closure: menor conjunto de tasks da mesma story necessárias pra
   * entregar uma task UI. Inclui a UI + suas deps intra-bucket transitivas
   * que ainda não foram alocadas. Retorna null se algum blocker cross-story
   * não foi placed (closure não-satisfazível ainda).
   */
  function uiClosure(
    bucket: StoryBucket,
    uiTaskId: string,
  ): { tasks: PlannerTask[]; points: number } | null {
    const bucketTaskIds = new Set(bucket.tasks.map((t) => t.id));
    const closure = new Set<string>();
    const stack = [uiTaskId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (placed.has(id) || taken.has(id)) continue;
      if (closure.has(id)) continue;
      closure.add(id);
      const blockers = blockersOf.get(id);
      if (!blockers) continue;
      for (const b of blockers) {
        if (placed.has(b)) continue;
        if (bucketTaskIds.has(b)) {
          stack.push(b);
        } else {
          return null;
        }
      }
    }
    const tasks: PlannerTask[] = [];
    let points = 0;
    for (const id of closure) {
      const t = taskById.get(id);
      if (!t) continue;
      tasks.push(t);
      points += pointsOf(t);
    }
    return { tasks, points };
  }

  /**
   * Greedy take dentro de 1 bucket, respeitando deps intra-bucket e
   * cross-story (via `placed`). Determinístico via taskScore + hash.
   */
  function greedyTakeFromBucket(
    bucket: StoryBucket,
    capacity: number,
  ): PlannerTask[] {
    const tasksByScore = [...bucket.tasks].sort((a, b) => {
      const diff = taskScore(b) - taskScore(a);
      if (diff !== 0) return diff;
      return stableHash(a.id) - stableHash(b.id);
    });
    const intraTaken = new Set<string>();
    const localTaken: PlannerTask[] = [];
    let used = 0;
    let progress = true;
    while (progress) {
      progress = false;
      for (const task of tasksByScore) {
        if (taken.has(task.id) || placed.has(task.id)) continue;
        if (intraTaken.has(task.id)) continue;
        if (!isUnblocked(task.id, intraTaken)) continue;
        const pts = pointsOf(task);
        if (used + pts > capacity) continue;
        intraTaken.add(task.id);
        localTaken.push(task);
        used += pts;
        progress = true;
      }
    }
    return localTaken;
  }

  const sprints: PlannerSprintOutput[] = [];

  for (let k = 0; k < n; k++) {
    const sprintTasks: PlannerTask[] = [];
    let totalPoints = 0;
    const warnings: PlannerWarning[] = [];

    function commitTasks(tasks: PlannerTask[]): void {
      for (const t of tasks) {
        sprintTasks.push(t);
        taken.add(t.id);
        placed.add(t.id);
        totalPoints += pointsOf(t);
      }
    }

    // Loop principal: percorre buckets em ordem de score. Re-percorre
    // sempre que houve progresso (placing pode desbloquear outros buckets).
    let progressGlobal = true;
    while (progressGlobal) {
      progressGlobal = false;
      for (const bucket of sortedBuckets) {
        const remaining = bucket.tasks.filter(
          (t) => !taken.has(t.id) && !placed.has(t.id),
        );
        if (remaining.length === 0) continue;

        const remainingPoints = remaining.reduce(
          (s, t) => s + pointsOf(t),
          0,
        );
        const remainingCapacity = capacityPerSprint - totalPoints;
        if (remainingCapacity <= 0) continue;

        // Caso 1: cabe inteiro → leva tudo dessa story de uma vez.
        if (remainingPoints <= remainingCapacity) {
          const all = greedyTakeFromBucket(bucket, remainingCapacity);
          if (all.length > 0) {
            commitTasks(all);
            progressGlobal = true;
            continue;
          }
        }

        // Caso 2: story tem UI E não cabe inteira → exige UI-closure no split.
        if (bucket.hasUI && bucket.realStoryId !== null) {
          const closureCandidates = bucket.tasks
            .filter(
              (t) =>
                t.layer === "UI" &&
                !taken.has(t.id) &&
                !placed.has(t.id),
            )
            .map((t) => ({ task: t, closure: uiClosure(bucket, t.id) }))
            .filter(
              (
                x,
              ): x is {
                task: PlannerTask;
                closure: { tasks: PlannerTask[]; points: number };
              } => x.closure !== null,
            )
            .filter((x) => x.closure.points <= remainingCapacity);

          if (closureCandidates.length > 0) {
            closureCandidates.sort((a, b) => {
              const diff = a.closure.points - b.closure.points;
              if (diff !== 0) return diff;
              return stableHash(a.task.id) - stableHash(b.task.id);
            });
            const picked = closureCandidates[0];
            commitTasks(picked.closure.tasks);
            // Top-off: se sobrou espaço, leva mais tasks da mesma story.
            const top = greedyTakeFromBucket(
              bucket,
              capacityPerSprint - totalPoints,
            );
            if (top.length > 0) commitTasks(top);
            progressGlobal = true;
            continue;
          }
          // Nenhuma UI-closure cabe → essa story fica pra próxima sprint.
          continue;
        }

        // Caso 3: story sem UI (backend-only) ou singleton → split livre.
        const taken1 = greedyTakeFromBucket(bucket, remainingCapacity);
        if (taken1.length > 0) {
          commitTasks(taken1);
          progressGlobal = true;
          continue;
        }
      }
    }

    // Caso 4 (fallback): sprint vazia depois do loop principal — pega a
    // primeira task elegível mesmo que oversize. Match com semântica antiga
    // ("task gigante ocupa sprint sozinha com warning").
    if (sprintTasks.length === 0) {
      for (const bucket of sortedBuckets) {
        const sortedTasks = [...bucket.tasks].sort((a, b) => {
          const diff = taskScore(b) - taskScore(a);
          if (diff !== 0) return diff;
          return stableHash(a.id) - stableHash(b.id);
        });
        let placedFallback = false;
        for (const task of sortedTasks) {
          if (taken.has(task.id) || placed.has(task.id)) continue;
          if (!isUnblocked(task.id)) continue;
          commitTasks([task]);
          if (pointsOf(task) > capacityPerSprint) {
            warnings.push({
              type: "OVERCAPACITY",
              sprintIndex: k,
              taskId: task.id,
              points: pointsOf(task),
            });
          }
          placedFallback = true;
          break;
        }
        if (placedFallback) break;
      }
    }

    if (sprintTasks.length === 0) {
      break;
    }

    const layers = new Set(
      sprintTasks.map((t) => t.layer).filter((l): l is TaskLayer => !!l),
    );
    if (layers.size <= 1) {
      warnings.push({ type: "LOW_LAYER_DIVERSITY", sprintIndex: k });
    }

    // NO_UI_TASK só dispara se o projeto TEM tasks de UI em algum lugar do
    // backlog (senão é projeto puro de back e o warning seria ruído).
    const projectHasUI = candidates.some((c) => c.layer === "UI");
    if (projectHasUI && !sprintTasks.some((t) => t.layer === "UI")) {
      warnings.push({ type: "NO_UI_TASK", sprintIndex: k });
    }

    sprints.push({
      suggestedName: `Sprint ${nextSprintNumber + k}`,
      suggestedGoal: "",
      tasks: sprintTasks,
      totalPoints,
      warnings,
    });
  }

  const leftover: PlannerLeftoverEntry[] = [];
  for (const task of candidates) {
    if (taken.has(task.id)) continue;
    const reason: PlannerLeftoverReason = isUnblocked(task.id)
      ? "CAPACITY"
      : "BLOCKED_BY_BACKLOG";
    leftover.push({ task, reason });
  }

  // Post-pass: STORY_SPLIT_ACROSS_SPRINTS. Story conta como "split" se suas
  // tasks aparecem em >1 sprint OU se sobra task da story em leftover.
  const sprintsByStory = new Map<string, Set<number>>();
  for (let k = 0; k < sprints.length; k++) {
    for (const task of sprints[k].tasks) {
      if (task.userStoryId == null) continue;
      let s = sprintsByStory.get(task.userStoryId);
      if (!s) sprintsByStory.set(task.userStoryId, (s = new Set()));
      s.add(k);
    }
  }
  const storiesWithLeftover = new Set<string>();
  for (const l of leftover) {
    if (l.task.userStoryId != null)
      storiesWithLeftover.add(l.task.userStoryId);
  }
  for (const [storyId, sprintIndices] of sprintsByStory) {
    const isSplit =
      sprintIndices.size > 1 || storiesWithLeftover.has(storyId);
    if (!isSplit) continue;
    for (const idx of sprintIndices) {
      sprints[idx].warnings.push({
        type: "STORY_SPLIT_ACROSS_SPRINTS",
        sprintIndex: idx,
        storyId,
      });
    }
  }

  return { sprints, leftover };
}

/** Helper pra API: tasks bloqueadoras de cada task no output. */
export function buildBlockedByMap(
  dependencies: PlannerDependency[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const dep of dependencies) {
    let arr = map.get(dep.taskId);
    if (!arr) map.set(dep.taskId, (arr = []));
    arr.push(dep.dependsOn);
  }
  return map;
}
