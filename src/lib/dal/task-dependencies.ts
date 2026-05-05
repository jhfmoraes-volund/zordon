import "server-only";
import { db } from "@/lib/db";

export type DependencyKind = "blocks" | "relates_to";

export const DEPENDENCY_KINDS: readonly DependencyKind[] = [
  "blocks",
  "relates_to",
] as const;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DependencyInput =
  | string
  | { ref: string; kind?: DependencyKind };

export type ResolvedDependency = {
  dependsOn: string;
  kind: DependencyKind;
  ref: string;
};

export type LinkedTask = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  kind: DependencyKind;
};

/**
 * Resolve a list of dependency inputs (refs `<KEY>-T-NNN` or UUIDs) to UUID
 * dependsOn entries with kind. Inputs that are bare strings default to
 * kind='blocks'. Returns missing refs separately so callers can surface a
 * useful error.
 */
export async function resolveDependencyInputs(
  projectId: string,
  inputs: DependencyInput[],
): Promise<{ resolved: ResolvedDependency[]; missing: string[] }> {
  if (inputs.length === 0) return { resolved: [], missing: [] };

  const normalized = inputs.map((input) =>
    typeof input === "string"
      ? { ref: input, kind: "blocks" as DependencyKind }
      : { ref: input.ref, kind: input.kind ?? ("blocks" as DependencyKind) },
  );

  const refs = Array.from(new Set(normalized.map((d) => d.ref)));
  const uuids = refs.filter((r) => UUID_REGEX.test(r));
  const refStrings = refs.filter((r) => !UUID_REGEX.test(r));

  const refToId = new Map<string, string>();

  if (uuids.length > 0) {
    const { data, error } = await db()
      .from("Task")
      .select("id")
      .eq("projectId", projectId)
      .in("id", uuids);
    if (error) throw error;
    for (const row of data ?? []) refToId.set(row.id, row.id);
  }

  if (refStrings.length > 0) {
    const { data, error } = await db()
      .from("Task")
      .select("id, reference")
      .eq("projectId", projectId)
      .in("reference", refStrings);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.reference) refToId.set(row.reference, row.id);
    }
  }

  const resolved: ResolvedDependency[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const dep of normalized) {
    const id = refToId.get(dep.ref);
    if (!id) {
      missing.push(dep.ref);
      continue;
    }
    const dedupKey = `${id}:${dep.kind}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    resolved.push({ dependsOn: id, kind: dep.kind, ref: dep.ref });
  }

  return { resolved, missing };
}

/**
 * Replace strategy: substitui completamente o conjunto de dependências de uma
 * task. A chave (dependsOn, kind) — mesmo par com kind diferente é entrada
 * separada.
 *
 * Usa diff entre current e desired pra minimizar writes.
 */
export async function setDependenciesForTask(
  taskId: string,
  desired: Array<{ dependsOn: string; kind: DependencyKind }>,
): Promise<void> {
  const filtered = desired.filter((d) => d.dependsOn !== taskId);
  const desiredKeys = new Set(filtered.map((d) => `${d.dependsOn}:${d.kind}`));

  const { data: currentRows, error: readErr } = await db()
    .from("TaskDependency")
    .select("dependsOn, kind")
    .eq("taskId", taskId);
  if (readErr) throw readErr;

  const currentKeys = new Set(
    (currentRows ?? []).map(
      (r) => `${r.dependsOn}:${r.kind as DependencyKind}`,
    ),
  );

  const toAdd = filtered.filter(
    (d) => !currentKeys.has(`${d.dependsOn}:${d.kind}`),
  );
  const toRemove = (currentRows ?? []).filter(
    (r) => !desiredKeys.has(`${r.dependsOn}:${r.kind as DependencyKind}`),
  );

  for (const r of toRemove) {
    const { error } = await db()
      .from("TaskDependency")
      .delete()
      .eq("taskId", taskId)
      .eq("dependsOn", r.dependsOn)
      .eq("kind", r.kind);
    if (error) throw new Error(error.message ?? String(error));
  }

  if (toAdd.length > 0) {
    const { error } = await db()
      .from("TaskDependency")
      .insert(
        toAdd.map((d) => ({
          taskId,
          dependsOn: d.dependsOn,
          kind: d.kind,
        })),
      );
    if (error) throw new Error(error.message ?? String(error));
  }
}

/**
 * Add a single dependency (idempotent). Used by REST endpoints that toggle a
 * single edge.
 */
export async function addDependency(
  taskId: string,
  dependsOn: string,
  kind: DependencyKind = "blocks",
): Promise<void> {
  if (taskId === dependsOn) {
    throw new Error("Task cannot depend on itself");
  }
  const { error } = await db()
    .from("TaskDependency")
    .insert({ taskId, dependsOn, kind });
  if (error && error.code !== "23505") {
    throw new Error(error.message ?? String(error));
  }
}

export async function removeDependency(
  taskId: string,
  dependsOn: string,
  kind: DependencyKind,
): Promise<void> {
  const { error } = await db()
    .from("TaskDependency")
    .delete()
    .eq("taskId", taskId)
    .eq("dependsOn", dependsOn)
    .eq("kind", kind);
  if (error) throw error;
}

/**
 * Tasks that THIS task depends on (outgoing edges).
 * Returns target tasks resolved with reference + title + status.
 */
export async function listDependenciesForTask(
  taskId: string,
): Promise<LinkedTask[]> {
  const { data, error } = await db()
    .from("TaskDependency")
    .select(
      `dependsOn, kind, target:Task!TaskDependency_dependsOn_fkey(id, reference, title, status)`,
    )
    .eq("taskId", taskId);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    dependsOn: string;
    kind: DependencyKind;
    target: {
      id: string;
      reference: string | null;
      title: string;
      status: string;
    } | null;
  }>;
  return rows
    .filter((r) => r.target !== null)
    .map((r) => ({
      id: r.target!.id,
      reference: r.target!.reference,
      title: r.target!.title,
      status: r.target!.status,
      kind: r.kind,
    }));
}

/**
 * Tasks that depend on THIS task (incoming edges, indexed via dependsOn).
 */
export async function listDependentsOfTask(
  taskId: string,
): Promise<LinkedTask[]> {
  const { data, error } = await db()
    .from("TaskDependency")
    .select(
      `taskId, kind, source:Task!TaskDependency_taskId_fkey(id, reference, title, status)`,
    )
    .eq("dependsOn", taskId);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    taskId: string;
    kind: DependencyKind;
    source: {
      id: string;
      reference: string | null;
      title: string;
      status: string;
    } | null;
  }>;
  return rows
    .filter((r) => r.source !== null)
    .map((r) => ({
      id: r.source!.id,
      reference: r.source!.reference,
      title: r.source!.title,
      status: r.source!.status,
      kind: r.kind,
    }));
}
