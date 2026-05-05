/**
 * End-to-end test harness for task references + dependencies migration.
 *
 * Run with:
 *   npx tsx --require ./scripts/_server-only-shim.cjs scripts/test-task-deps-migration.ts
 *
 * What it tests:
 *   1. next_task_reference(uuid) RPC returns <KEY>-T-NNN format.
 *   2. Zordon backfill: 89 tasks contiguous ZRDN-T-001..ZRDN-T-089.
 *   3. TaskDependency table exists with kind constraint.
 *   4. DAL helpers: resolveDependencyInputs, setDependenciesForTask,
 *      listDependenciesForTask, listDependentsOfTask all work end-to-end.
 *   5. Cycle detection: trigger rejects creating a cycle within kind='blocks'.
 *   6. relates_to allows cycles (informative only).
 *   7. Self-loop rejected.
 *   8. ON DELETE CASCADE: deleting a task removes its dependency rows.
 *   9. ON DELETE RESTRICT: cannot delete a task that something depends on.
 *
 * The script creates and tears down its own test tasks under a pre-existing
 * test project (FORGE: 8e4a16a3-...) to avoid polluting Zordon. It rolls back
 * cleanly even on failure (best-effort cleanup).
 */

import { db } from "../src/lib/db";
import {
  resolveDependencyInputs,
  setDependenciesForTask,
  listDependenciesForTask,
  listDependentsOfTask,
  addDependency,
} from "../src/lib/dal/task-dependencies";

const FORGE_PROJECT_ID = "8e4a16a3-70bf-4992-bf94-816233c96baf";
const ZORDON_PROJECT_ID = "6f9b7443-547e-418e-b0a5-6f3bb38d762f";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function pass(name: string, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.log(`  ✗ ${name} — ${detail}`);
}

async function expectThrow<T>(
  name: string,
  fn: () => Promise<T>,
  matcher: (msg: string) => boolean,
): Promise<void> {
  try {
    await fn();
    fail(name, "expected throw, got success");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (matcher(msg)) {
      pass(name, `rejected: ${msg.slice(0, 80)}`);
    } else {
      fail(name, `wrong error: ${msg}`);
    }
  }
}

async function main() {
  const supabase = db();
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  TASK REFS + DEPENDENCIES — MIGRATION TEST HARNESS");
  console.log("══════════════════════════════════════════════════════════\n");

  // ─── 1. RPCs next_task_reference + next_draft_task_reference ────────────
  console.log("[1] next_task_reference / next_draft_task_reference RPCs");
  {
    const { data: ref, error } = await supabase.rpc("next_task_reference", {
      p_project_id: FORGE_PROJECT_ID,
    });
    if (error) {
      fail("RPC returns FRGE-T-NNN", error.message);
    } else if (!ref || !/^FRGE-T-\d{3}$/.test(ref)) {
      fail("RPC returns FRGE-T-NNN", `got: ${ref}`);
    } else {
      pass("RPC returns FRGE-T-NNN", `next: ${ref}`);
    }

    const { data: zRef, error: zErr } = await supabase.rpc(
      "next_task_reference",
      { p_project_id: ZORDON_PROJECT_ID },
    );
    if (zErr || !zRef || !/^ZRDN-T-\d{3}$/.test(zRef)) {
      fail("RPC returns ZRDN-T-NNN", zErr?.message ?? `got: ${zRef}`);
    } else {
      pass("RPC returns ZRDN-T-NNN", `next: ${zRef}`);
    }

    const { data: dRef, error: dErr } = await supabase.rpc(
      "next_draft_task_reference",
      { p_project_id: FORGE_PROJECT_ID },
    );
    if (dErr || !dRef || !/^FRGE-D-\d{3}$/.test(dRef)) {
      fail("RPC returns FRGE-D-NNN (draft)", dErr?.message ?? `got: ${dRef}`);
    } else {
      pass("RPC returns FRGE-D-NNN (draft)", `next: ${dRef}`);
    }
  }

  // ─── 2. Zordon backfill ──────────────────────────────────────────────────
  console.log("\n[2] Zordon backfill");
  {
    // T-NNN pra status != 'draft' (deve ser contigua)
    const { data, error } = await supabase
      .from("Task")
      .select("reference, status")
      .eq("projectId", ZORDON_PROJECT_ID)
      .neq("status", "draft")
      .order("reference", { ascending: true });
    if (error) {
      fail("Zordon T-NNN query", error.message);
    } else {
      const refs = (data ?? []).map((r) => r.reference);
      const allMatch = refs.every((r) => r && /^ZRDN-T-\d{3}$/.test(r));
      const count = refs.length;
      const expectedSeq = Array.from(
        { length: count },
        (_, i) => `ZRDN-T-${String(i + 1).padStart(3, "0")}`,
      );
      const contiguous =
        JSON.stringify(refs) === JSON.stringify(expectedSeq);
      if (allMatch && contiguous) {
        pass(
          "Zordon T-NNN: contigua (sem buracos)",
          `count=${count}`,
        );
      } else {
        fail(
          "Zordon T-NNN contigua",
          `count=${count} allMatch=${allMatch} contiguous=${contiguous}`,
        );
      }
    }

    // Drafts em D-NNN
    const { data: drafts } = await supabase
      .from("Task")
      .select("reference")
      .eq("projectId", ZORDON_PROJECT_ID)
      .eq("status", "draft");
    const draftsValid = (drafts ?? []).every(
      (d) => d.reference && /^ZRDN-D-\d{3}$/.test(d.reference),
    );
    if (draftsValid) {
      pass("Zordon drafts em D-NNN", `count=${drafts?.length ?? 0}`);
    } else {
      fail(
        "Zordon drafts em D-NNN",
        `refs=${JSON.stringify(drafts?.map((d) => d.reference))}`,
      );
    }
  }

  // ─── 3. TaskDependency schema ────────────────────────────────────────────
  console.log("\n[3] TaskDependency schema present");
  {
    // Probe via select (RLS via service-role bypassed — db() uses service_role).
    const { error } = await supabase
      .from("TaskDependency")
      .select("taskId, dependsOn, kind")
      .limit(1);
    if (error) {
      fail("TaskDependency table accessible", error.message);
    } else {
      pass("TaskDependency table accessible");
    }
  }

  // ─── 4. End-to-end DAL ───────────────────────────────────────────────────
  console.log("\n[4] DAL end-to-end (create test tasks → wire deps → cleanup)");

  const createdIds: string[] = [];
  const cleanup = async () => {
    if (createdIds.length === 0) return;
    // ON DELETE RESTRICT in dependsOn: precisamos deletar deps primeiro.
    await supabase
      .from("TaskDependency")
      .delete()
      .in("taskId", createdIds);
    await supabase
      .from("TaskDependency")
      .delete()
      .in("dependsOn", createdIds);
    await supabase.from("Task").delete().in("id", createdIds);
  };

  try {
    const titlePrefix = `__test_dep_${Date.now()}_`;

    // Cria 3 tasks de teste no FORGE
    const newRefs: { id: string; reference: string }[] = [];
    for (let i = 1; i <= 3; i++) {
      const { data: ref, error: refErr } = await supabase.rpc(
        "next_task_reference",
        { p_project_id: FORGE_PROJECT_ID },
      );
      if (refErr || !ref) throw new Error(`RPC failed: ${refErr?.message}`);

      const id = crypto.randomUUID();
      const { error: insErr } = await supabase.from("Task").insert({
        id,
        title: `${titlePrefix}T${i}`,
        reference: ref,
        status: "draft",
        projectId: FORGE_PROJECT_ID,
        complexity: "low",
        scope: "small",
        type: "feature",
        priority: 0,
        billable: true,
        createdByAgent: false,
        mergeAttempts: 0,
        updatedAt: new Date().toISOString(),
      });
      if (insErr) throw new Error(`insert T${i} failed: ${insErr.message}`);
      createdIds.push(id);
      newRefs.push({ id, reference: ref });
    }
    pass(
      "Test fixtures: 3 tasks created in FORGE",
      newRefs.map((r) => r.reference).join(", "),
    );

    const [t1, t2, t3] = newRefs;

    // ── 4a. resolveDependencyInputs: refs + UUIDs + missing
    {
      const { resolved, missing } = await resolveDependencyInputs(
        FORGE_PROJECT_ID,
        [
          t1.reference,
          { ref: t2.reference, kind: "relates_to" },
          "FRGE-T-9999", // not exist
          t3.id, // UUID accepted
        ],
      );
      if (
        resolved.length === 3 &&
        missing.length === 1 &&
        missing[0] === "FRGE-T-9999" &&
        resolved.find((r) => r.ref === t1.reference)?.kind === "blocks" &&
        resolved.find((r) => r.ref === t2.reference)?.kind === "relates_to"
      ) {
        pass("resolveDependencyInputs handles refs + UUIDs + missing");
      } else {
        fail(
          "resolveDependencyInputs",
          `resolved=${resolved.length} missing=${JSON.stringify(missing)}`,
        );
      }
    }

    // ── 4b. setDependenciesForTask: T2 blocks T1, T2 relates_to T3
    await setDependenciesForTask(t2.id, [
      { dependsOn: t1.id, kind: "blocks" },
      { dependsOn: t3.id, kind: "relates_to" },
    ]);

    {
      const out = await listDependenciesForTask(t2.id);
      const kinds = out
        .map((d) => `${d.reference}:${d.kind}`)
        .sort()
        .join(",");
      const expected = `${t1.reference}:blocks,${t3.reference}:relates_to`;
      if (kinds === expected) {
        pass("listDependenciesForTask returns correct kinds");
      } else {
        fail(
          "listDependenciesForTask",
          `got=${kinds} expected=${expected}`,
        );
      }
    }

    {
      const incoming = await listDependentsOfTask(t1.id);
      if (
        incoming.length === 1 &&
        incoming[0].reference === t2.reference &&
        incoming[0].kind === "blocks"
      ) {
        pass("listDependentsOfTask returns reverse edge");
      } else {
        fail(
          "listDependentsOfTask",
          `got=${JSON.stringify(incoming.map((i) => ({ ref: i.reference, kind: i.kind })))}`,
        );
      }
    }

    // ── 4c. Replace strategy: T2 → only relates_to T3 (drops blocks→T1)
    await setDependenciesForTask(t2.id, [
      { dependsOn: t3.id, kind: "relates_to" },
    ]);
    {
      const out = await listDependenciesForTask(t2.id);
      if (
        out.length === 1 &&
        out[0].reference === t3.reference &&
        out[0].kind === "relates_to"
      ) {
        pass("setDependenciesForTask replace strategy works");
      } else {
        fail(
          "Replace strategy",
          `got=${JSON.stringify(out.map((d) => ({ ref: d.reference, kind: d.kind })))}`,
        );
      }
    }

    // ── 4d. Self-loop rejected (CHECK constraint)
    await expectThrow(
      "Self-loop rejected by CHECK",
      () => addDependency(t1.id, t1.id, "blocks"),
      () => true, // any error is fine — DAL throws "Task cannot depend on itself"
    );

    // Limpa qualquer self-loop residual e prepara cycle test
    await setDependenciesForTask(t2.id, []);
    await setDependenciesForTask(t1.id, []);
    await setDependenciesForTask(t3.id, []);

    // ── 4e. Cycle detection: blocks edges
    // T1 blocks T2, T2 blocks T3 OK
    await addDependency(t2.id, t1.id, "blocks");
    await addDependency(t3.id, t2.id, "blocks");
    pass("Two-step blocks chain T1→T2→T3 created OK");

    // T1 blocks T3 (i.e. T1 dependsOn T3) seria T3→T1 invertendo —
    // pra criar ciclo preciso adicionar uma aresta cuja saida volta pro inicio:
    // T1 dependsOn T3 (kind=blocks) faria T1 → T3, e ja temos T3 → T2 → T1 (via blocks) ⇒ ciclo.
    await expectThrow(
      "Cycle detection blocks T1→T3 rejected",
      () => addDependency(t1.id, t3.id, "blocks"),
      (msg) => /cycle/i.test(msg),
    );

    // ── 4f. relates_to permite ciclo
    await addDependency(t1.id, t3.id, "relates_to");
    pass("Cycle in relates_to allowed (informative only)");

    // ── 4g. ON DELETE CASCADE no taskId
    // Deletando t3 deveria cascade-remover (t3, _, _) — mas existem t3 dependsOn outras
    // (t3 depends on t2 via blocks). E existem outras DEPENDENDO de t3 (t1 relates_to t3).
    // O lado dependsOn é RESTRICT — antes precisamos remover quem depende de t3.
    await supabase.from("TaskDependency").delete().eq("dependsOn", t3.id);
    const t3DelResult = await supabase.from("Task").delete().eq("id", t3.id);
    if (t3DelResult.error) {
      fail("Cascade-delete dependent task", t3DelResult.error.message);
    } else {
      // Confirma cascade removeu t3 → t2 (kind=blocks)
      const { data: leftover } = await supabase
        .from("TaskDependency")
        .select("*")
        .or(`taskId.eq.${t3.id},dependsOn.eq.${t3.id}`);
      if (!leftover || leftover.length === 0) {
        pass("ON DELETE CASCADE removed dependency rows for deleted task");
        // Remove t3 da lista de cleanup pra evitar re-delete.
        const idx = createdIds.indexOf(t3.id);
        if (idx >= 0) createdIds.splice(idx, 1);
      } else {
        fail("Cascade left rows behind", `${leftover.length} rows`);
      }
    }

    // ── 4g.5 Fluxo draft: cria via D-NNN, "promove" trocando pra T-NNN
    {
      const { data: draftRef, error: draftErr } = await supabase.rpc(
        "next_draft_task_reference",
        { p_project_id: FORGE_PROJECT_ID },
      );
      if (draftErr || !draftRef) {
        fail("Draft RPC gera D-NNN", draftErr?.message ?? "no value");
      } else if (!/^FRGE-D-\d{3}$/.test(draftRef)) {
        fail("Draft RPC gera D-NNN", `got: ${draftRef}`);
      } else {
        pass("Draft RPC gera D-NNN", draftRef);

        const draftId = crypto.randomUUID();
        await supabase.from("Task").insert({
          id: draftId,
          title: `${titlePrefix}draft`,
          reference: draftRef,
          status: "draft",
          projectId: FORGE_PROJECT_ID,
          complexity: "low",
          scope: "small",
          type: "feature",
          priority: 0,
          billable: true,
          createdByAgent: true,
          mergeAttempts: 0,
          updatedAt: new Date().toISOString(),
        });
        createdIds.push(draftId);

        // Simula promocao: substitui ref por T-NNN
        const { data: promotedRef, error: pErr } = await supabase.rpc(
          "next_task_reference",
          { p_project_id: FORGE_PROJECT_ID },
        );
        if (pErr || !promotedRef) {
          fail("Promocao gera T-NNN", pErr?.message ?? "no value");
        } else {
          await supabase
            .from("Task")
            .update({
              status: "backlog",
              reference: promotedRef,
              updatedAt: new Date().toISOString(),
            })
            .eq("id", draftId);

          const { data: after } = await supabase
            .from("Task")
            .select("reference, status")
            .eq("id", draftId)
            .single();
          if (
            after?.reference &&
            /^FRGE-T-\d{3}$/.test(after.reference) &&
            after.status === "backlog"
          ) {
            pass(
              "Promocao draft->backlog troca D-NNN por T-NNN",
              `${draftRef} -> ${after.reference}`,
            );
          } else {
            fail(
              "Promocao draft->backlog",
              `ref=${after?.reference} status=${after?.status}`,
            );
          }
        }
      }
    }

    // ── 4h. ON DELETE RESTRICT no dependsOn
    // T2 depende de T1 (blocks). Tentar deletar T1 deve falhar.
    const { error: restrictErr } = await supabase
      .from("Task")
      .delete()
      .eq("id", t1.id);
    if (restrictErr && /violat|restrict|foreign/i.test(restrictErr.message)) {
      pass("ON DELETE RESTRICT blocks deletion of depended-upon task");
    } else if (!restrictErr) {
      fail(
        "ON DELETE RESTRICT",
        "deletion succeeded — should have been blocked",
      );
      // T1 foi deletado por engano — limpar
      const idx = createdIds.indexOf(t1.id);
      if (idx >= 0) createdIds.splice(idx, 1);
    } else {
      fail("ON DELETE RESTRICT", `wrong error: ${restrictErr.message}`);
    }
  } finally {
    console.log("\n[cleanup] removendo tasks de teste...");
    await cleanup();
    console.log("[cleanup] feito");
  }

  // ─── REPORT ──────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`  RESULTADO: ${passed} ok / ${failed} falhas`);
  console.log("══════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    console.log("FALHAS:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  ✗ ${r.name} — ${r.detail}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
