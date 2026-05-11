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

// ─── Story-first vertical slicing ───────────────────────────────────────────

run("story-first: tasks da mesma story caem juntas na mesma sprint", () => {
  // Story S1 tem 3 tasks (data+api+ui). Capacity comporta tudo.
  // Sem story-grouping o algoritmo poderia espalhar — com grouping, ficam juntas.
  const out = planSprints(
    baseInput({
      candidates: [
        task("s1-data", {
          userStoryId: "S1",
          layer: "DATA",
          functionPoints: 3,
        }),
        task("s1-api", {
          userStoryId: "S1",
          layer: "API",
          functionPoints: 3,
        }),
        task("s1-ui", {
          userStoryId: "S1",
          layer: "UI",
          functionPoints: 3,
        }),
      ],
      capacityPerSprint: 10,
      n: 1,
    }),
  );
  assert.equal(out.sprints.length, 1);
  assert.equal(out.sprints[0].tasks.length, 3);
  const ids = out.sprints[0].tasks.map((t) => t.id).sort();
  assert.deepEqual(ids, ["s1-api", "s1-data", "s1-ui"]);
});

run(
  "story-first: multi-task story (UI) vence singleton DATA isolada em capacidade restrita",
  () => {
    // Capacity 10. Singleton DATA fp=3 (score: 0 deps + 500 layer = 500).
    // Story S1 (data+api+ui) fp total 9 (best task score = ~500 + cohesion 200 + UI 150 = 850).
    // Cohesion + UI bonus tornam a story preferida, então S1 entra antes da
    // singleton DATA.
    const out = planSprints(
      baseInput({
        candidates: [
          task("solo-data", { layer: "DATA", functionPoints: 3 }),
          task("s1-data", {
            userStoryId: "S1",
            layer: "DATA",
            functionPoints: 3,
          }),
          task("s1-api", {
            userStoryId: "S1",
            layer: "API",
            functionPoints: 3,
          }),
          task("s1-ui", {
            userStoryId: "S1",
            layer: "UI",
            functionPoints: 3,
          }),
        ],
        capacityPerSprint: 10,
        n: 1,
      }),
    );
    // S1 (9pts) cabe; solo-data (3pts) não cabe nos 1pt restantes.
    const ids = out.sprints[0].tasks.map((t) => t.id).sort();
    assert.deepEqual(ids, ["s1-api", "s1-data", "s1-ui"]);
    assert.equal(out.leftover.length, 1);
    assert.equal(out.leftover[0].task.id, "solo-data");
  },
);

run("UI-closure: story grande split mantém UI na sprint (slice demoável)", () => {
  // Story com 4 tasks somando 16pts; capacity 10. UI task fp=3, sua única
  // dep intra-story é s1-data (fp=3). Closure {data+ui} = 6pts → cabe.
  // Resultado: sprint inclui s1-data + s1-ui (vertical slice). s1-api + s1-extra
  // ficam pra próxima sprint.
  const out = planSprints(
    baseInput({
      candidates: [
        task("s1-data", {
          userStoryId: "S1",
          layer: "DATA",
          functionPoints: 3,
        }),
        task("s1-api", {
          userStoryId: "S1",
          layer: "API",
          functionPoints: 5,
        }),
        task("s1-ui", {
          userStoryId: "S1",
          layer: "UI",
          functionPoints: 3,
        }),
        task("s1-extra", {
          userStoryId: "S1",
          layer: "API",
          functionPoints: 5,
        }),
      ],
      // s1-ui só depende de s1-data, NÃO de s1-api.
      dependencies: [{ taskId: "s1-ui", dependsOn: "s1-data" }],
      capacityPerSprint: 10,
      n: 1,
    }),
  );
  assert.equal(out.sprints.length, 1);
  const ids = out.sprints[0].tasks.map((t) => t.id).sort();
  assert.ok(ids.includes("s1-ui"), "split precisa ter UI task pra ser demoável");
  assert.ok(ids.includes("s1-data"), "UI closure puxa sua dep intra-story");
  // s1-extra deve ter sobrado (não cabia + closure já consumiu).
  assert.ok(out.leftover.some((l) => l.task.id === "s1-extra"));
});

run("UI-closure: nenhuma fits → story espera próxima sprint", () => {
  // Story tem UI gigante (15pts) cuja closure não cabe em capacity 10.
  // Tem singleton DATA isolada que cabe — algoritmo deve pular a story
  // (esperando ela caber depois ou ir pra próxima sprint) e pegar a singleton.
  const out = planSprints(
    baseInput({
      candidates: [
        task("s1-data", {
          userStoryId: "S1",
          layer: "DATA",
          functionPoints: 5,
        }),
        task("s1-ui", {
          userStoryId: "S1",
          layer: "UI",
          functionPoints: 15,
        }),
        task("solo", { layer: "DATA", functionPoints: 3 }),
      ],
      dependencies: [{ taskId: "s1-ui", dependsOn: "s1-data" }],
      capacityPerSprint: 10,
      n: 2,
    }),
  );
  // Sprint 0: deve incluir solo (não a story, porque UI closure não cabe).
  assert.ok(
    out.sprints[0].tasks.some((t) => t.id === "solo"),
    "Sprint 0 deve incluir a singleton (não tem story que caiba com UI)",
  );
});

run("backend-only story split livre quando não cabe inteira", () => {
  // Story sem UI tasks — split livre por score, sem regra de closure.
  const out = planSprints(
    baseInput({
      candidates: [
        task("s1-data", {
          userStoryId: "S1",
          layer: "DATA",
          functionPoints: 6,
        }),
        task("s1-api", {
          userStoryId: "S1",
          layer: "API",
          functionPoints: 6,
        }),
        task("s1-ops", {
          userStoryId: "S1",
          layer: "OPS",
          functionPoints: 6,
        }),
      ],
      capacityPerSprint: 10,
      n: 2,
    }),
  );
  // Sprint 0: pega 1 task (6pts) já que duas somam 12 > 10. Greedy por score:
  // DATA tem layer score maior, então s1-data primeiro.
  assert.equal(out.sprints.length, 2);
  assert.equal(out.sprints[0].totalPoints, 6);
  assert.equal(out.sprints[0].tasks[0].id, "s1-data");
});

// ─── Novos warnings ─────────────────────────────────────────────────────────

run("NO_UI_TASK: sprint sem UI dispara warning quando projeto TEM UI", () => {
  // Projeto tem UI tasks no backlog (s2-ui), mas a sprint atual só pega
  // tasks de back (s1) — deve avisar.
  const out = planSprints(
    baseInput({
      candidates: [
        task("s1-data", {
          userStoryId: "S1",
          layer: "DATA",
          functionPoints: 4,
        }),
        task("s1-api", {
          userStoryId: "S1",
          layer: "API",
          functionPoints: 4,
        }),
        // UI task em outra story que vai ficar bloqueada (depende de algo fora).
        task("s2-ui", {
          userStoryId: "S2",
          layer: "UI",
          functionPoints: 4,
        }),
      ],
      dependencies: [{ taskId: "s2-ui", dependsOn: "external-blocker" }],
      capacityPerSprint: 10,
      n: 1,
    }),
  );
  const w = out.sprints[0].warnings.find((x) => x.type === "NO_UI_TASK");
  assert.ok(w, "NO_UI_TASK esperado pois projeto tem UI mas sprint não");
});

run("NO_UI_TASK: NÃO dispara quando projeto inteiro é backend", () => {
  // Sem UI em lugar nenhum — não tem sentido avisar.
  const out = planSprints(
    baseInput({
      candidates: [
        task("a", { layer: "DATA", functionPoints: 3 }),
        task("b", { layer: "API", functionPoints: 3 }),
      ],
      capacityPerSprint: 10,
      n: 1,
    }),
  );
  const w = out.sprints[0].warnings.find((x) => x.type === "NO_UI_TASK");
  assert.equal(w, undefined);
});

run("STORY_SPLIT_ACROSS_SPRINTS: warning quando story spans 2 sprints", () => {
  // Story grande precisa ser splittada em 2 sprints.
  const out = planSprints(
    baseInput({
      candidates: [
        task("s1-data", {
          userStoryId: "S1",
          layer: "DATA",
          functionPoints: 6,
        }),
        task("s1-ui", {
          userStoryId: "S1",
          layer: "UI",
          functionPoints: 6,
        }),
      ],
      dependencies: [{ taskId: "s1-ui", dependsOn: "s1-data" }],
      capacityPerSprint: 10,
      n: 2,
    }),
  );
  // Sprint 0: s1-data (6pts) + s1-ui closure (depende de s1-data) wouldn't fit
  // since closure = data+ui = 12 > 10. So UI closure can't form. Free split
  // gets stuck (story has UI). Falls through to greedy with UI rule... actually
  // since closure points 12 > 10, no closure fits. Skip this round.
  // Then fallback: empty sprint → grab first eligible task. s1-data has no
  // blockers → taken alone with OVERCAPACITY? No, 6 ≤ 10. Placed normally.
  // Sprint 1: s1-data is placed, s1-ui unblocked. Closure = {s1-ui} = 6pts.
  // Fits. Taken.
  // Both sprints contain s1 tasks → STORY_SPLIT warning on both.
  const w0 = out.sprints[0].warnings.find(
    (x) => x.type === "STORY_SPLIT_ACROSS_SPRINTS",
  );
  const w1 = out.sprints[1].warnings.find(
    (x) => x.type === "STORY_SPLIT_ACROSS_SPRINTS",
  );
  assert.ok(w0, "STORY_SPLIT esperado na sprint 0");
  assert.ok(w1, "STORY_SPLIT esperado na sprint 1");
});

// ─── Continuidade entre sprints (in-progress stories/modules) ───────────────

run(
  "continuidade: story in-progress vence story fresh com mesmo score (tier 1 < tier 3)",
  () => {
    // Duas stories, ambas com 1 task fresh idêntica em peso/AC.
    // S1-OLD tem 1 task em alreadyAllocated → tier 1 (continuação).
    // S2-NEW está fresh → tier 3.
    // Sem continuidade, a ordem dependia só de hash. Com continuidade, S1
    // vem primeiro.
    const out = planSprints(
      baseInput({
        candidates: [
          task("s1-rest", {
            userStoryId: "S1-OLD",
            layer: "API",
            functionPoints: 3,
          }),
          task("s2-rest", {
            userStoryId: "S2-NEW",
            layer: "API",
            functionPoints: 3,
          }),
        ],
        alreadyAllocated: new Set(["s1-done"]),
        inProgressStoryIds: new Set(["S1-OLD"]),
        capacityPerSprint: 3,
        n: 1,
      }),
    );
    assert.equal(out.sprints[0].tasks.length, 1);
    assert.equal(out.sprints[0].tasks[0].id, "s1-rest");
    assert.equal(out.leftover.length, 1);
    assert.equal(out.leftover[0].task.id, "s2-rest");
  },
);

run(
  "continuidade: story em módulo in-progress (tier 2) bate fresh tier 3",
  () => {
    // S1 (módulo M1) tem tasks em alreadyAllocated → M1 está em andamento.
    // S2 é nova mas pertence ao M1 → tier 2.
    // S3 está num módulo M2 totalmente fresh → tier 3.
    // Sprint pega S2 antes de S3.
    const out = planSprints(
      baseInput({
        candidates: [
          // Tasks restantes de S1 não cabem mais aqui (suponha já estão fechadas
          // — ou não existem). S2 e S3 são as duas opções.
          task("s2-task", {
            userStoryId: "S2",
            moduleId: "M1",
            layer: "API",
            functionPoints: 3,
          }),
          task("s3-task", {
            userStoryId: "S3",
            moduleId: "M2",
            layer: "API",
            functionPoints: 3,
          }),
        ],
        alreadyAllocated: new Set(["m1-old-task"]),
        // M1 tem tasks em andamento, mas S2 ainda é fresh (S2 não tem tasks
        // em alreadyAllocated).
        inProgressStoryIds: new Set<string>(),
        inProgressModuleIds: new Set(["M1"]),
        capacityPerSprint: 3,
        n: 1,
      }),
    );
    assert.equal(out.sprints[0].tasks.length, 1);
    assert.equal(out.sprints[0].tasks[0].id, "s2-task");
  },
);

run(
  "continuidade: in-progress story (tier 1) vence in-progress-module (tier 2)",
  () => {
    // S1 (tier 1, story em andamento) vs S2 (tier 2, módulo em andamento mas
    // story fresh). Story em andamento ganha — finish what's started.
    const out = planSprints(
      baseInput({
        candidates: [
          task("s1-rest", {
            userStoryId: "S1",
            moduleId: "M1",
            layer: "API",
            functionPoints: 3,
          }),
          task("s2-task", {
            userStoryId: "S2",
            moduleId: "M2",
            layer: "API",
            functionPoints: 3,
          }),
        ],
        alreadyAllocated: new Set(["s1-old", "m2-old"]),
        inProgressStoryIds: new Set(["S1"]),
        inProgressModuleIds: new Set(["M1", "M2"]),
        capacityPerSprint: 3,
        n: 1,
      }),
    );
    assert.equal(out.sprints[0].tasks[0].id, "s1-rest");
  },
);

run(
  "continuidade: UI closure pode ser pequena quando intra-deps já placed",
  () => {
    // Story tem DATA + API placed em sprint anterior, e só a UI no backlog.
    // Sem precisar incluir DATA/API (já placed), UI closure = {UI} = 3pts.
    // Cabe em capacity 5.
    const out = planSprints(
      baseInput({
        candidates: [
          task("s1-ui", {
            userStoryId: "S1",
            layer: "UI",
            functionPoints: 3,
          }),
        ],
        // s1-data + s1-api já em sprint anterior.
        alreadyAllocated: new Set(["s1-data", "s1-api"]),
        inProgressStoryIds: new Set(["S1"]),
        dependencies: [
          { taskId: "s1-ui", dependsOn: "s1-api" },
          { taskId: "s1-api", dependsOn: "s1-data" },
        ],
        capacityPerSprint: 5,
        n: 1,
      }),
    );
    assert.equal(out.sprints[0].tasks.length, 1);
    assert.equal(out.sprints[0].tasks[0].id, "s1-ui");
  },
);

run(
  "STORY_SPLIT_ACROSS_SPRINTS: warning quando parte da story sobra no leftover",
  () => {
    // Story com 3 tasks; só 2 cabem; 1 vai pro leftover.
    const out = planSprints(
      baseInput({
        candidates: [
          task("s1-data", {
            userStoryId: "S1",
            layer: "DATA",
            functionPoints: 4,
          }),
          task("s1-ui", {
            userStoryId: "S1",
            layer: "UI",
            functionPoints: 4,
          }),
          task("s1-extra", {
            userStoryId: "S1",
            layer: "API",
            functionPoints: 5,
          }),
        ],
        capacityPerSprint: 9,
        n: 1,
      }),
    );
    // Algoritmo deve preferir UI closure {data+ui}=8 → cabe; top-off não
    // cabe (extra 5pts > 1pt restante). s1-extra fica em leftover.
    assert.ok(out.leftover.some((l) => l.task.id === "s1-extra"));
    const w = out.sprints[0].warnings.find(
      (x) => x.type === "STORY_SPLIT_ACROSS_SPRINTS",
    );
    assert.ok(w, "STORY_SPLIT esperado pois story tem leftover");
  },
);

console.log("");
if (failures.length > 0) {
  console.error(`✗ ${failures.length} falha(s):`, failures.join(", "));
  process.exit(1);
} else {
  console.log("✓ Todos os testes passaram");
}
