"use client";

import type { ReactNode } from "react";
import {
  TASK_STATUS,
  TASK_TYPE,
  type ChipDescriptor,
} from "@/lib/status-chips";

export type ActivityItem = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; name: string | null } | null;
};

export type RendererCtx = {
  members: { id: string; name: string | null }[];
  sprints: { id: string; name: string | null }[];
  stories: { __id?: string | null; title?: string | null; reference?: string }[];
  projectTags: { id: string; name: string }[];
};

type RendererArgs = {
  item: ActivityItem;
  ctx: RendererCtx;
};

type Renderer = (args: RendererArgs) => ReactNode;

// ─── Helpers ────────────────────────────────────────────────────────────────

function nameForMember(ctx: RendererCtx, id: string | null | undefined): string {
  if (!id) return "—";
  return ctx.members.find((m) => m.id === id)?.name ?? "ex-membro";
}

function nameForSprint(ctx: RendererCtx, id: string | null | undefined): string {
  if (!id) return "sem sprint";
  return ctx.sprints.find((s) => s.id === id)?.name ?? "(sprint removido)";
}

function nameForStory(ctx: RendererCtx, id: string | null | undefined): string {
  if (!id) return "sem história";
  const s = ctx.stories.find((x) => x.__id === id);
  return s?.title ?? "(história removida)";
}

function nameForTag(ctx: RendererCtx, id: string | null | undefined): string {
  if (!id) return "—";
  return ctx.projectTags.find((t) => t.id === id)?.name ?? "(tag removida)";
}

function chipLabel(
  registry: Record<string, ChipDescriptor>,
  value: string | null | undefined,
): string {
  if (!value) return "—";
  return registry[value]?.label ?? value;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : v == null ? null : String(v);
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// ─── Renderers ──────────────────────────────────────────────────────────────

const renderers: Record<string, Renderer> = {
  created: ({ item }) => {
    const ref = asString(item.payload.reference);
    const title = asString(item.payload.title);
    return (
      <>
        Criou {ref ? <span className="font-mono">{ref}</span> : null}
        {title ? <> · &ldquo;{title}&rdquo;</> : null}
      </>
    );
  },

  status_changed: ({ item }) => {
    const before = chipLabel(TASK_STATUS, asString(item.payload.before));
    const after = chipLabel(TASK_STATUS, asString(item.payload.after));
    return (
      <>
        Mudou status: <strong>{before}</strong> → <strong>{after}</strong>
      </>
    );
  },

  assignees_changed: ({ item, ctx }) => {
    const added = asArray<string>(item.payload.added).map((id) =>
      nameForMember(ctx, id),
    );
    const removed = asArray<string>(item.payload.removed).map((id) =>
      nameForMember(ctx, id),
    );
    const parts: ReactNode[] = [];
    if (added.length > 0) parts.push(<>+ {added.join(", ")}</>);
    if (removed.length > 0) parts.push(<>− {removed.join(", ")}</>);
    return (
      <>
        Assignees: {parts.map((p, i) => (
          <span key={i}>
            {i > 0 ? "; " : null}
            {p}
          </span>
        ))}
      </>
    );
  },

  sprint_changed: ({ item, ctx }) => {
    const before = nameForSprint(ctx, asString(item.payload.before));
    const after = nameForSprint(ctx, asString(item.payload.after));
    return (
      <>
        Sprint: <strong>{before}</strong> → <strong>{after}</strong>
      </>
    );
  },

  story_changed: ({ item, ctx }) => {
    const before = nameForStory(ctx, asString(item.payload.before));
    const after = nameForStory(ctx, asString(item.payload.after));
    return (
      <>
        História: <strong>{before}</strong> → <strong>{after}</strong>
      </>
    );
  },

  fp_changed: ({ item }) => {
    const before = item.payload.before ?? "—";
    const after = item.payload.after ?? "—";
    return (
      <>
        Function Points: <strong>{String(before)}</strong> →{" "}
        <strong>{String(after)}</strong>
      </>
    );
  },

  scope_changed: ({ item }) => {
    return (
      <>
        Scope: <strong>{asString(item.payload.before) ?? "—"}</strong> →{" "}
        <strong>{asString(item.payload.after) ?? "—"}</strong>
      </>
    );
  },

  complexity_changed: ({ item }) => {
    return (
      <>
        Complexidade:{" "}
        <strong>{asString(item.payload.before) ?? "—"}</strong> →{" "}
        <strong>{asString(item.payload.after) ?? "—"}</strong>
      </>
    );
  },

  type_changed: ({ item }) => {
    const before = chipLabel(TASK_TYPE, asString(item.payload.before));
    const after = chipLabel(TASK_TYPE, asString(item.payload.after));
    return (
      <>
        Tipo: <strong>{before}</strong> → <strong>{after}</strong>
      </>
    );
  },

  title_edited: () => <>Editou o título</>,

  description_edited: () => <>Editou a descrição</>,

  tags_changed: ({ item, ctx }) => {
    const added = asArray<string>(item.payload.added).map((id) =>
      nameForTag(ctx, id),
    );
    const removed = asArray<string>(item.payload.removed).map((id) =>
      nameForTag(ctx, id),
    );
    const parts: string[] = [];
    if (added.length > 0) parts.push(`+ ${added.join(", ")}`);
    if (removed.length > 0) parts.push(`− ${removed.join(", ")}`);
    return <>Tags: {parts.join("; ")}</>;
  },

  ac_bulk_changed: ({ item }) => {
    const added = asArray<{ text?: string }>(item.payload.added);
    const removed = asArray<{ text?: string }>(item.payload.removed);
    const checked = asArray<{ text?: string }>(item.payload.checked);
    const unchecked = asArray<{ text?: string }>(item.payload.unchecked);
    const edited = asArray<{ text?: string }>(item.payload.edited);
    const parts: string[] = [];
    if (added.length > 0) parts.push(`+${added.length} novo`);
    if (removed.length > 0) parts.push(`−${removed.length} removido`);
    if (checked.length > 0) parts.push(`✓${checked.length}`);
    if (unchecked.length > 0) parts.push(`☐${unchecked.length}`);
    if (edited.length > 0) parts.push(`~${edited.length} editado`);
    return <>ACs: {parts.join(" · ")}</>;
  },

  duplicated: ({ item }) => {
    const ref = asString(item.payload.newTaskRef) ?? "—";
    return (
      <>
        Duplicada como <span className="font-mono">{ref}</span>
      </>
    );
  },

  cloned_to: ({ item }) => {
    const ref = asString(item.payload.newTaskRef) ?? "—";
    const proj = asString(item.payload.targetProjectName) ?? "outro projeto";
    return (
      <>
        Clonada para <strong className="text-foreground">{proj}</strong> como{" "}
        <span className="font-mono">{ref}</span>
      </>
    );
  },

  cloned_from: ({ item }) => {
    const ref = asString(item.payload.sourceTaskRef) ?? "—";
    const proj = asString(item.payload.sourceProjectName) ?? "projeto origem";
    return (
      <>
        Clonada de <strong className="text-foreground">{proj}</strong> (
        <span className="font-mono">{ref}</span>)
      </>
    );
  },
};

export function renderActivity(
  item: ActivityItem,
  ctx: RendererCtx,
): ReactNode {
  const r = renderers[item.type];
  if (r) return r({ item, ctx });
  return <>{item.type}</>;
}
