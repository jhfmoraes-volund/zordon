/**
 * Sprint planner — pure, deterministic.
 *
 * Sequenciamento de tasks em N sprints. Não toca DB. Recebe candidates já
 * filtradas (sprintId IS NULL), dependências do projeto (kind='blocks'),
 * capacidade por sprint e número de sprints a sugerir.
 *
 * Comportamento documentado em `docs/sprint-planner-plan.md`.
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

export function planSprints(input: PlannerInput): PlannerOutput {
  const {
    candidates,
    alreadyAllocated,
    dependencies,
    n,
    capacityPerSprint,
    nextSprintNumber,
  } = input;

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

  // blockersOf: taskId → Set<id que precisa estar alocado antes>
  // dependentsOf: blockerId → Set<id que depende deste blocker>
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

  const dependentsInBacklogCache = new Map<string, number>();
  function dependentsInBacklog(taskId: string): number {
    let n = dependentsInBacklogCache.get(taskId);
    if (n !== undefined) return n;
    const deps = dependentsOf.get(taskId);
    n = 0;
    if (deps) for (const id of deps) if (candidateIds.has(id)) n++;
    dependentsInBacklogCache.set(taskId, n);
    return n;
  }

  function scoreOf(task: PlannerTask): number {
    const layerScore = task.layer ? LAYER_RANK[task.layer] : 0;
    return (
      1000 * dependentsInBacklog(task.id) +
      100 * layerScore +
      10 * task.acCount +
      stableHash(task.id)
    );
  }

  // Pré-ordena candidates por score desc. Hash garante determinismo no empate.
  const sortedByScore = [...candidates].sort((a, b) => scoreOf(b) - scoreOf(a));

  const placed = new Set<string>(alreadyAllocated);
  const taken = new Set<string>();

  function isUnblocked(taskId: string): boolean {
    const blockers = blockersOf.get(taskId);
    if (!blockers || blockers.size === 0) return true;
    for (const b of blockers) if (!placed.has(b)) return false;
    return true;
  }

  const sprints: PlannerSprintOutput[] = [];

  for (let k = 0; k < n; k++) {
    const sprintTasks: PlannerTask[] = [];
    let totalPoints = 0;
    const warnings: PlannerWarning[] = [];

    // Repassa enquanto adicionou algo no último loop — adicionar A pode
    // desbloquear B que aparece antes na ordem mas estava bloqueado.
    let progress = true;
    while (progress) {
      progress = false;
      for (const task of sortedByScore) {
        if (taken.has(task.id)) continue;
        if (!isUnblocked(task.id)) continue;

        const pts = pointsOf(task);
        const isFirst = sprintTasks.length === 0;
        // Permite task gigante ocupar sprint vazia inteira (com warning).
        if (!isFirst && totalPoints + pts > capacityPerSprint) continue;

        sprintTasks.push(task);
        totalPoints += pts;
        taken.add(task.id);
        placed.add(task.id);
        progress = true;

        if (isFirst && pts > capacityPerSprint) {
          warnings.push({
            type: "OVERCAPACITY",
            sprintIndex: k,
            taskId: task.id,
            points: pts,
          });
        }
        if (totalPoints >= capacityPerSprint) break;
      }
      if (totalPoints >= capacityPerSprint) break;
    }

    if (sprintTasks.length === 0) {
      // Nada elegível restou — para de criar sprints.
      break;
    }

    const layers = new Set(
      sprintTasks.map((t) => t.layer).filter((l): l is TaskLayer => !!l),
    );
    if (layers.size <= 1) {
      warnings.push({ type: "LOW_LAYER_DIVERSITY", sprintIndex: k });
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
