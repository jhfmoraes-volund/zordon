"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Pencil, Trash2 } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { showErrorToast } from "@/lib/optimistic/toast";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import {
  buildMentionableMembers,
  type MentionMember,
} from "@/lib/mentions";
import {
  renderActivity,
  type ActivityItem,
  type RendererCtx,
} from "./activity-renderers";
import { CommentComposer } from "./comment-composer";

// ─── Types from /api/tasks/[id]/feed ─────────────────────────────────────────

export type FeedActor = { id: string; name: string | null } | null;

type FeedActivity = {
  kind: "activity";
  id: string;
  taskId: string;
  createdAt: string;
  actor: FeedActor;
  type: string;
  payload: Record<string, unknown>;
};

type FeedComment = {
  kind: "comment";
  id: string;
  taskId: string;
  createdAt: string;
  actor: FeedActor;
  body: string;
  mentionedMemberIds: string[];
  editedAt: string | null;
  deletedAt: string | null;
  canEdit: boolean;
};

type FeedItem = FeedActivity | FeedComment;

type CommentEntity = FeedComment & { id: string };

// ─── Component ──────────────────────────────────────────────────────────────

const RECENT_VISIBLE = 5;

type Props = {
  taskId: string;
  ctx: RendererCtx;
  members: MentionMember[];
};

export function TaskFeed({ taskId, ctx, members }: Props) {
  const [activities, setActivities] = useState<FeedActivity[] | null>(null);
  const [initialComments, setInitialComments] = useState<CommentEntity[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const optimistic = useOptimisticCollection<CommentEntity>(
    initialComments ?? [],
  );

  // Sync committed when initial load completes (or pagination grows it).
  useEffect(() => {
    if (initialComments) optimistic.setCommitted(initialComments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialComments]);

  const loadInitial = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/feed?limit=50`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { items: FeedItem[] };
      const items = data.items ?? [];
      setActivities(items.filter((i): i is FeedActivity => i.kind === "activity"));
      setInitialComments(
        items.filter((i): i is FeedComment => i.kind === "comment"),
      );
      setHasMore(items.length === 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar feed");
      setActivities([]);
      setInitialComments([]);
    }
  }, [taskId]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  async function loadOlder() {
    if (loadingMore) return;
    const oldest = mergedAsc[0];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/tasks/${taskId}/feed?limit=50&before=${encodeURIComponent(oldest.createdAt)}`,
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { items: FeedItem[] };
      const newActivities = (data.items ?? []).filter(
        (i): i is FeedActivity => i.kind === "activity",
      );
      const newComments = (data.items ?? []).filter(
        (i): i is FeedComment => i.kind === "comment",
      );
      setActivities((prev) => [...newActivities, ...(prev ?? [])]);
      optimistic.setCommitted((prev) => [...newComments, ...prev]);
      setHasMore(data.items.length === 50);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao carregar mais" });
    } finally {
      setLoadingMore(false);
    }
  }

  // Sort each group ASC independently — logs and comments are rendered as
  // separate sections rather than a single mixed timeline.
  const activitiesAsc: FeedActivity[] = useMemo(() => {
    return [...(activities ?? [])].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1,
    );
  }, [activities]);

  const commentsAsc: CommentEntity[] = useMemo(() => {
    return [...optimistic.items].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1,
    );
  }, [optimistic.items]);

  // Used by `loadOlder` to know the oldest cursor across both groups.
  const mergedAsc: FeedItem[] = useMemo(() => {
    const merged: FeedItem[] = [...activitiesAsc, ...commentsAsc];
    merged.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    return merged;
  }, [activitiesAsc, commentsAsc]);

  async function submitNewComment(body: string) {
    const tempId = `tmp-${Date.now()}`;
    const optimisticEntity: CommentEntity = {
      kind: "comment",
      id: tempId,
      taskId,
      createdAt: new Date().toISOString(),
      actor: null,
      body,
      mentionedMemberIds: [],
      editedAt: null,
      deletedAt: null,
      canEdit: false,
    };

    await optimistic.mutate(
      { type: "create", entity: optimisticEntity },
      async () => {
        const res = await fetch(`/api/tasks/${taskId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao postar comentário");
        }
        const data = (await res.json()) as { comment: CommentApi };
        return data.comment;
      },
      {
        errorLabel: "Falha ao postar comentário",
        retry: false,
        reconcile: (prev, result) => {
          const real = commentApiToEntity(result);
          // Replace temp by real id; if temp not found, append.
          const filtered = prev.filter((c) => c.id !== tempId);
          return [...filtered, real];
        },
      },
    );
    // Refresh activity tail in case the new comment race-mixed with new events.
    void loadInitial();
  }

  async function handleEdit(commentId: string, newBody: string) {
    await optimistic.mutate(
      {
        type: "patch",
        id: commentId,
        patch: { body: newBody, editedAt: new Date().toISOString() },
      },
      async () => {
        const res = await fetch(
          `/api/tasks/${taskId}/comments/${commentId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: newBody }),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao editar");
        }
        const data = (await res.json()) as { comment: CommentApi };
        return data.comment;
      },
      {
        errorLabel: "Falha ao editar comentário",
        retry: false,
        reconcile: (prev, result) => {
          const real = commentApiToEntity(result);
          return prev.map((c) => (c.id === commentId ? real : c));
        },
      },
    );
  }

  async function handleDelete(commentId: string) {
    await optimistic.mutate(
      {
        type: "patch",
        id: commentId,
        patch: { deletedAt: new Date().toISOString() },
      },
      async () => {
        const res = await fetch(
          `/api/tasks/${taskId}/comments/${commentId}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao apagar");
        }
        return true;
      },
      {
        errorLabel: "Falha ao apagar comentário",
        retry: false,
      },
    );
  }

  if (initialComments === null || activities === null) {
    return (
      <SectionShell>
        <p className="text-[11px] text-muted-foreground">Carregando…</p>
      </SectionShell>
    );
  }

  if (error && mergedAsc.length === 0) {
    return (
      <SectionShell>
        <p className="text-[11px] text-destructive">{error}</p>
      </SectionShell>
    );
  }

  const hiddenLogsCount = expanded
    ? 0
    : Math.max(0, activitiesAsc.length - RECENT_VISIBLE);
  const visibleLogs = expanded
    ? activitiesAsc
    : activitiesAsc.slice(-RECENT_VISIBLE);

  return (
    <SectionShell>
      <TooltipProvider delay={200}>
        {/* ── Logs (eventos automáticos) ── */}
        {activitiesAsc.length > 0 ? (
          <section>
            <GroupLabel>Logs</GroupLabel>

            {expanded && hasMore ? (
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingMore}
                className="mb-1.5 w-full rounded-md border border-dashed border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/30 disabled:opacity-50"
              >
                {loadingMore ? "Carregando…" : "Carregar mais antigos"}
              </button>
            ) : null}

            {hiddenLogsCount > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="mb-1.5 w-full rounded-md px-2 py-0.5 text-left text-[10px] text-muted-foreground hover:bg-accent/30"
              >
                Ver histórico completo · +{hiddenLogsCount}{" "}
                {hiddenLogsCount === 1 ? "evento" : "eventos"} mais antigos
              </button>
            ) : expanded && activitiesAsc.length > RECENT_VISIBLE ? (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="mb-1.5 w-full rounded-md px-2 py-0.5 text-left text-[10px] text-muted-foreground hover:bg-accent/30"
              >
                Recolher histórico
              </button>
            ) : null}

            <ul className="space-y-1">
              {visibleLogs.map((it) => (
                <ActivityRow key={`a:${it.id}`} item={it} ctx={ctx} />
              ))}
            </ul>
          </section>
        ) : null}

        {/* ── Comentários ── */}
        {commentsAsc.length > 0 ? (
          <section
            className={
              activitiesAsc.length > 0
                ? "mt-3 border-t border-border/40 pt-3"
                : ""
            }
          >
            <GroupLabel>Comentários</GroupLabel>
            <ul className="space-y-2">
              {commentsAsc.map((it) => (
                <CommentRow
                  key={`c:${it.id}`}
                  item={it}
                  members={members}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {/* ── Empty state ── */}
        {activitiesAsc.length === 0 && commentsAsc.length === 0 ? (
          <p className="text-[11px] italic text-muted-foreground">
            Sem atividade ainda. Seja o primeiro a comentar.
          </p>
        ) : null}

        {/* ── Composer ── */}
        <div
          className={
            activitiesAsc.length > 0 || commentsAsc.length > 0
              ? "mt-3 border-t border-border/40 pt-3"
              : "mt-3"
          }
        >
          <CommentComposer members={members} onSubmit={submitNewComment} />
        </div>
      </TooltipProvider>
    </SectionShell>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
      {children}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function SectionShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/20 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Activity className="size-3" />
        Atividade
      </div>
      {children}
    </div>
  );
}

function ActivityRow({
  item,
  ctx,
}: {
  item: FeedActivity;
  ctx: RendererCtx;
}) {
  const activity: ActivityItem = {
    id: item.id,
    type: item.type,
    payload: item.payload,
    createdAt: item.createdAt,
    actor: item.actor,
  };
  return (
    <li className="text-[11px] text-muted-foreground">
      {renderActivity(activity, ctx)}
      {item.actor?.name ? <> por {item.actor.name}</> : null}
      {" · "}
      <RelativeTime iso={item.createdAt} />
    </li>
  );
}

function CommentRow({
  item,
  members,
  onEdit,
  onDelete,
}: {
  item: FeedComment;
  members: MentionMember[];
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const isDeleted = !!item.deletedAt;
  const author = item.actor?.name ?? "ex-membro";
  const initial = (author[0] ?? "?").toUpperCase();

  if (isDeleted) {
    return (
      <li className="flex items-start gap-2 text-[11px] italic text-muted-foreground">
        <Trash2 className="mt-0.5 size-3 shrink-0" />
        <span>
          Comentário removido por {author} · <RelativeTime iso={item.deletedAt!} />
        </span>
      </li>
    );
  }

  if (editing) {
    return (
      <li
        data-comment-id={item.id}
        className="rounded-md border border-border bg-background/50 p-2"
      >
        <CommentComposer
          members={members}
          initialValue={item.body}
          submitLabel="Salvar"
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={async (next) => {
            await onEdit(item.id, next);
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li
      data-comment-id={item.id}
      className="group flex items-start gap-2 rounded-md hover:bg-accent/20"
    >
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{author}</span>
          <span>·</span>
          <RelativeTime iso={item.createdAt} />
          {item.editedAt ? (
            <Tooltip>
              <TooltipTrigger
                render={(props) => (
                  <span {...props} className="cursor-help">
                    (editado)
                  </span>
                )}
              />
              <TooltipContent>
                Editado em {new Date(item.editedAt).toLocaleString("pt-BR")}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {item.canEdit && !item.id.startsWith("tmp-") ? (
            <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded p-0.5 hover:bg-accent"
                aria-label="Editar comentário"
              >
                <Pencil className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => void onDelete(item.id)}
                className="rounded p-0.5 hover:bg-destructive/10 hover:text-destructive"
                aria-label="Apagar comentário"
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-sm text-foreground">
          <Markdown>{renderBodyWithMentions(item.body, members)}</Markdown>
        </div>
      </div>
    </li>
  );
}

function RelativeTime({ iso }: { iso: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span {...props} className="cursor-help">
            {formatRelative(iso)}
          </span>
        )}
      />
      <TooltipContent>{new Date(iso).toLocaleString("pt-BR")}</TooltipContent>
    </Tooltip>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type CommentApi = {
  id: string;
  taskId: string;
  body: string;
  mentionedMemberIds: string[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  author: { id: string; name: string | null } | null;
  canEdit: boolean;
};

function commentApiToEntity(c: CommentApi): CommentEntity {
  return {
    kind: "comment",
    id: c.id,
    taskId: c.taskId,
    createdAt: c.createdAt,
    actor: c.author,
    body: c.body,
    mentionedMemberIds: c.mentionedMemberIds,
    editedAt: c.editedAt,
    deletedAt: c.deletedAt,
    canEdit: c.canEdit,
  };
}

/**
 * Render `@<slug>` as bold for known members. Unknown slugs stay as plain text.
 * Uses markdown bold (`**@slug**`) so existing markdown processor styles it.
 */
function renderBodyWithMentions(
  body: string,
  members: MentionMember[],
): string {
  const mentionable = buildMentionableMembers(members);
  const slugSet = new Set(mentionable.map((m) => m.slug));
  return body.replace(/(^|\s)@([a-z0-9-]+)/g, (full, lead, slug) =>
    slugSet.has(slug) ? `${lead}**@${slug}**` : full,
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 30) return `${d}d atrás`;
  return new Date(iso).toLocaleDateString("pt-BR");
}
