import "server-only";
import { getActorMemberId } from "@/lib/dal";
import {
  getActivityForTask,
  type TaskActivityWithActor,
} from "@/lib/dal/task-activity";
import {
  getCommentsForTask,
  type TaskCommentWithAuthor,
} from "@/lib/dal/task-comments";

export type FeedActor = { id: string; name: string | null } | null;

export type FeedActivityItem = {
  kind: "activity";
  id: string;
  taskId: string;
  createdAt: string;
  actor: FeedActor;
  type: string;
  payload: Record<string, unknown>;
};

export type FeedCommentItem = {
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

export type FeedItem = FeedActivityItem | FeedCommentItem;

function activityToItem(a: TaskActivityWithActor): FeedActivityItem {
  return {
    kind: "activity",
    id: a.id,
    taskId: a.taskId,
    createdAt: a.createdAt,
    actor: a.actor,
    type: a.type,
    payload: (a.payload ?? {}) as Record<string, unknown>,
  };
}

function commentToItem(
  c: TaskCommentWithAuthor,
  viewerMemberId: string | null,
): FeedCommentItem {
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
    canEdit:
      !!viewerMemberId &&
      c.authorMemberId === viewerMemberId &&
      !c.deletedAt,
  };
}

/**
 * Fetch the next page of feed items (descending by createdAt). Two parallel
 * queries: latest `limit` activities + latest `limit` comments older than
 * `before` (if any), then merge in-memory and slice. View was rejected in V2
 * to avoid `security_invoker` gotchas; cardinality is low enough that this is
 * trivial.
 */
export async function getFeedForTask(
  taskId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<FeedItem[]> {
  const limit = opts.limit ?? 50;
  const [activities, comments, viewerMemberId] = await Promise.all([
    getActivityForTask(taskId, { limit, before: opts.before }),
    getCommentsForTask(taskId, { limit, before: opts.before }),
    getActorMemberId(),
  ]);
  const merged: FeedItem[] = [
    ...activities.map(activityToItem),
    ...comments.map((c) => commentToItem(c, viewerMemberId)),
  ];
  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return merged.slice(0, limit);
}
