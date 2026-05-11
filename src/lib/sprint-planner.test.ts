/**
 * Tests for planSprints — standalone, no framework.
 * Run: npx tsx src/lib/sprint-planner.test.ts
 */
import assert from "node:assert/strict";
import {
  planSprints,
  pointsOf,
  type PlannerTask,
  type PlannerInput,
  type TaskLayer,
} from "./sprint-planner";

function task(id: string, partial: Partial<PlannerTask> = {}): PlannerTask {
  return {
    id,
    reference: partial.reference ?? id,
    title: partial.title ?? `Task ${id}`,
    layer: partial.layer ?? null,
    moduleId: partial.moduleId ?? null,
    userStoryId: partial.userStoryId ?? null,
    acCount: partial.acCount ?? 0,
    functionPoints: partial.functionPoints ?? null,
  };
}

function baseInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    candidates: [],
    alreadyAllocated: new Set(),
    dependencies: [],
    n: 1,
    capacityPerSprint: 10,
    nextSprintNumber: 1,
    ...overrides,
  };
}

const failures: string[] = [];
function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`  ✗ ${name}`);
    console.error(e instanceof Error ? e.message : e);
  }
}

console.log("planSprints");

run("N=0 retorna sprints vazias e tudo no leftover", () => {
  const out = planSprints(
    baseInput({ n: 0, candidates: [task("a"), task("b")] }),
  );
  assert.equal(out.sprints.length, 0);
  assert.equal(out.leftover.length, 2);
  assert.deepEqual(out.leftover.map((l) => l.reason).sort(), [
    "BLOCKED_BY_BACKLOG",
    "BLOCKED_BY_BACKLOG",
  ]);
});

run("capacityPerSprint=0 dispara erro", () => {
  assert.throws(() => planSprints(baseInput({ capacityPerSprint: 0 })), /capacityPerSprint/);
});

run("caminho feliz: 3 tasks isoladas em 1 sprint", () => {
  const out = planSprints(
    baseInput({
      candidates: [
        task("a", { functionPoints: 3 }),
        task("b", { functionPoints: 3 }),
        task("c", { functionPoints: 3 }),
      ],
      capacityPerSprint: 10,
    }),
  );
  assert.equal(out.sprints.length, 1);
  assert.equal(out.sprints[0].tasks.length, 3);
  assert.equal(out.sprints[0].totalPoints, 9);
  assert.equal(out.leftover.length, 0);
});

run("respeita capacidade, joga excedente pra próximo sprint", () => {
  const out = planSprints(
    baseInput({
      candidates: [
        task("a", { functionPoints: 5 }),
        task("b", { functionPoints: 5 }),
        task("c", { functionPoints: 5 }),
        task("d", { functionPoints: 5 }),
      ],
      capacityPerSprint: 10,
      n: 2,
    }),
  );
  assert.equal(out.sprints.length, 2);
  assert.equal(out.sprints[0].totalPoints, 10);
  assert.equal(out.sprints[1].totalPoints, 10);
  assert.equal(out.leftover.length, 0);
});

run("não couberam → leftover com reason CAPACITY", () => {
  const out = planSprints(
    baseInput({
      candidates: [
        task("a", { functionPoints: 5 }),
        task("b", { functionPoints: 5 }),
        task("c", { functionPoints: 5 }),
      ],
      capacityPerSprint: 10,
      n: 1,
    }),
  );
  assert.equal(out.sprints[0].totalPoints, 10);
  assert.equal(out.leftover.length, 1);
  assert.equal(out.leftover[0].reason, "CAPACITY");
});

run("blocker no backlog adia dependente pra próximo round", () => {
  // a (blocker) ← b (depende de a)
  // c (sem dep) também elegível
  const out = planSprints(
    baseInput({
      candidates: [
        task("a", { functionPoints: 5 }),
        task("b", { functionPoints: 5 }),
        task("c", { functionPoints: 5 }),
      ],
      dependencies: [{ taskId: "b", dependsOn: "a" }],
      capacityPerSprint: 5,
      n: 3,
    }),
  );
  assert.equal(out.sprints.length, 3);
  // Sprint 1: deve incluir 'a' (tem dependente → score 1000+)
  assert.equal(out.sprints[0].tasks[0].id, "a");
  // Sprint 2 ou 3 conterá 'b' depois de 'a' alocado
  const allTaskIds = out.sprints.flatMap((s) => s.tasks.map((t) => t.id));
  assert.deepEqual(allTaskIds.sort(), ["a", "b", "c"]);
});

run("blocker em alreadyAllocated libera dependente", () => {
  const out = planSprints(
    baseInput({
      candidates: [task("b", { functionPoints: 5 })],
      alreadyAllocated: new Set(["a"]),
      dependencies: [{ taskId: "b", dependsOn: "a" }],
      capacityPerSprint: 10,
      n: 1,
    }),
  );
  assert.equal(out.sprints.length, 1);
  assert.equal(out.sprints[0].tasks[0].id, "b");
});

run("blocker FORA do candidates e FORA do alreadyAllocated → leftover BLOCKED_BY_BACKLOG", () => {
  const out = planSprints(
    baseInput({
      candidates: [task("b", { functionPoints: 5 })],
      dependencies: [{ taskId: "b", dependsOn: "x-fora" }],
      capacityPerSprint: 10,
      n: 1,
    }),
  );
  assert.equal(out.sprints.length, 0);
  assert.equal(out.leftover.length, 1);
  assert.equal(out.leftover[0].reason, "BLOCKED_BY_BACKLOG");
});

run("ciclo nas deps → todas as cycled tasks ficam em leftover BLOCKED_BY_BACKLOG", () => {
  // a → b → a (ciclo). c é livre.
  const out = planSprints(
    baseInput({
      candidates: [
        task("a", { functionPoints: 3 }),
        task("b", { functionPoints: 3 }),
        task("c", { functionPoints: 3 }),
      ],
      dependencies: [
        { taskId: "a", dependsOn: "b" },
        { taskId: "b", dependsOn: "a" },
      ],
      capacityPerSprint: 10,
      n: 2,
    }),
  );
  // c entra; a e b ficam fora pra sempre
  const scheduled = out.sprints.flatMap((s) => s.tasks.map((t) => t.id));
  assert.deepEqual(scheduled, ["c"]);
  const leftoverIds = out.leftover.map((l) => l.task.id).sort();
  const leftoverReasons = Object.fromEntries(
    out.leftover.map((l) => [l.task.id, l.reason]),
  );
  assert.deepEqual(leftoverIds, ["a", "b"]);
  assert.equal(leftoverReasons["a"], "BLOCKED_BY_BACKLOG");
  assert.equal(leftoverReasons["b"], "BLOCKED_BY_BACKLOG");
});

run("task gigante (>capacity) ocupa sprint sozinha + warning OVERCAPACITY", () => {
  const out = planSprints(
    baseInput({
      candidates: [
        task("big", { functionPoints: 20 }),
        task("small", { functionPoints: 3 }),
      ],
      capacityPerSprint: 10,
      n: 2,
    }),
  );
  // A ordem entre big/small empata em score base — depende do hash. O que
  // importa é: big termina sozinha em alguma sprint com warning OVERCAPACITY.
  assert.equal(out.sprints.length, 2);
  const bigSprintIdx = out.sprints.findIndex((s) =>
    s.tasks.some((t) => t.id === "big"),
  );
  assert.notEqual(bigSprintIdx, -1, "big deve aparecer em alguma sprint");
  assert.equal(out.sprints[bigSprintIdx].tasks.length, 1);
  const ovr = out.sprints[bigSprintIdx].warnings.find(
    (w) => w.type === "OVERCAPACITY",
  );
  assert.ok(ovr, "OVERCAPACITY warning esperado");
});

run("sprint com 1 só layer → warning LOW_LAYER_DIVERSITY", () => {
  const layer: TaskLayer = "DATA";
  const out = planSprints(
    baseInput({
      candidates: [
        task("a", { layer, functionPoints: 3 }),
        task("b", { layer, functionPoints: 3 }),
      ],
      capacityPerSprint: 10,
    }),
  );
  const w = out.sprints[0].warnings.find(
    (x) => x.type === "LOW_LAYER_DIVERSITY",
  );
  assert.ok(w, "LOW_LAYER_DIVERSITY esperado");
});

run("sprint com 2+ layers → sem warning de diversity", () => {
  const out = planSprints(
    baseInput({
      candidates: [
        task("a", { layer: "DATA", functionPoints: 3 }),
        task("b", { layer: "UI", functionPoints: 3 }),
      ],
      capacityPerSprint: 10,
    }),
  );
  const w = out.sprints[0].warnings.find(
    (x) => x.type === "LOW_LAYER_DIVERSITY",
  );
  assert.equal(w, undefined);
});

run("score: DATA prioritizado sobre UI quando empata em deps/AC", () => {
  const out = planSprints(
    baseInput({
      candidates: [
        task("ui", { layer: "UI", functionPoints: 3 }),
        task("data", { layer: "DATA", functionPoints: 3 }),
      ],
      capacityPerSprint: 3, // só 1 cabe
      n: 1,
    }),
  );
  assert.equal(out.sprints[0].tasks[0].id, "data");
});

run("score: task com dependente bate score puramente por layer", () => {
  // ui-com-dep tem 1 dependente no backlog → 1000 pontos.
  // data-isolada tem layer DATA (100*5=500) mas 0 dependentes.
  const out = planSprints(
    baseInput({
      candidates: [
        task("ui-com-dep", { layer: "UI", functionPoints: 3 }),
        task("ui-dep", { layer: "UI", functionPoints: 3 }),
        task("data-isolada", { layer: "DATA", functionPoints: 3 }),
      ],
      dependencies: [{ taskId: "ui-dep", dependsOn: "ui-com-dep" }],
      capacityPerSprint: 3,
      n: 1,
    }),
  );
  assert.equal(out.sprints[0].tasks[0].id, "ui-com-dep");
});

run("empate determinístico — mesma input duas vezes produz mesma saída", () => {
  const input = (): PlannerInput =>
    baseInput({
      candidates: [
        task("z"),
        task("m"),
        task("a"),
        task("y"),
      ].map((t) => ({ ...t, functionPoints: 3 })),
      capacityPerSprint: 100,
      n: 1,
    });
  const a = planSprints(input());
  const b = planSprints(input());
  assert.deepEqual(
    a.sprints[0].tasks.map((t) => t.id),
    b.sprints[0].tasks.map((t) => t.id),
  );
});

run("pointsOf: null/0/negativo → 1", () => {
  assert.equal(pointsOf(task("a", { functionPoints: null })), 1);
  assert.equal(pointsOf(task("a", { functionPoints: 0 })), 1);
  assert.equal(pointsOf(task("a", { functionPoints: -5 })), 1);
  assert.equal(pointsOf(task("a", { functionPoints: 7 })), 7);
});

run("nextSprintNumber controla suggestedName", () => {
  const out = planSprints(
    baseInput({
      candidates: [task("a", { functionPoints: 3 })],
      nextSprintNumber: 7,
    }),
  );
  assert.equal(out.sprints[0].suggestedName, "Sprint 7");
});

run("todas candidates bloqueadas → sprints[]=[] e tudo leftover", () => {
  const out = planSprints(
    baseInput({
      candidates: [task("a"), task("b")],
      dependencies: [
        { taskId: "a", dependsOn: "x" },
        { taskId: "b", dependsOn: "x" },
      ],
      n: 2,
    }),
  );
  assert.equal(out.sprints.length, 0);
  assert.equal(out.leftover.length, 2);
  assert.ok(out.leftover.every((l) => l.reason === "BLOCKED_BY_BACKLOG"));
});

console.log("");
if (failures.length > 0) {
  console.error(`✗ ${failures.length} falha(s):`, failures.join(", "));
  process.exit(1);
} else {
  console.log("✓ Todos os testes passaram");
}
