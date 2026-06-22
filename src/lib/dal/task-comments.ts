import "server-only";
import { db } from "@/lib/db";
import { getActorMemberId } from "@/lib/dal";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];
export type TaskCommentRow = Tables["TaskComment"]["Row"];

export type TaskCommentWithAuthor = TaskCommentRow & {
  author: { id: string; name: string | null } | null;
};

export type TaskCommentForViewer = TaskCommentWithAuthor & {
  canEdit: boolean;
};

export function decorateForViewer(
  comment: TaskCommentWithAuthor,
  viewerMemberId: string | null,
): TaskCommentForViewer {
  return {
    ...comment,
    canEdit:
      !!viewerMemberId &&
      comment.authorMemberId === viewerMemberId &&
      !comment.deletedAt,
  };
}

const COMMENT_SELECT =
  "*, author:Member!TaskComment_authorMemberId_fkey(id, name)";

/**
 * Insert a comment with an EXPLICIT author. Used by callers that resolve the
 * author outside the auth session (e.g. the agent tool router / daemon, where
 * `getActorMemberId()` has no request context). UI routes should use
 * `createComment`, which resolves the author from the auth session.
 */
export async function createCommentAs(input: {
  taskId: string;
  body: string;
  mentionedMemberIds: string[];
  authorMemberId: string | null;
}): Promise<TaskCommentWithAuthor> {
  const { data, error } = await db()
    .from("TaskComment")
    .insert({
      taskId: input.taskId,
      body: input.body,
      mentionedMemberIds: input.mentionedMemberIds,
      authorMemberId: input.authorMemberId,
    })
    .select(COMMENT_SELECT)
    .single();
  if (error) throw error;
  return data as unknown as TaskCommentWithAuthor;
}

/**
 * Insert a comment. Author resolved internally via `getActorMemberId()` —
 * never accept it from caller (consistent with task-activity-recorder).
 */
export async function createComment(input: {
  taskId: string;
  body: string;
  mentionedMemberIds: string[];
}): Promise<TaskCommentWithAuthor> {
  const authorMemberId = await getActorMemberId();
  return createCommentAs({ ...input, authorMemberId: authorMemberId ?? null });
}

/**
 * Edit a comment's body and re-derived mentions. Authorization (only author
 * can edit) lives in the route — this DAL just persists.
 */
export async function editComment(
  id: string,
  body: string,
  mentionedMemberIds: string[],
): Promise<TaskCommentWithAuthor> {
  const { data, error } = await db()
    .from("TaskComment")
    .update({
      body,
      mentionedMemberIds,
      editedAt: new Date().toISOString(),
    })
    .eq("id", id)
    .select(COMMENT_SELECT)
    .single();
  if (error) throw error;
  return data as unknown as TaskCommentWithAuthor;
}

/** Soft delete: sets `deletedAt` but preserves body for audit. */
export async function deleteComment(id: string): Promise<void> {
  const { error } = await db()
    .from("TaskComment")
    .update({ deletedAt: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function getCommentById(
  id: string,
): Promise<TaskCommentWithAuthor | null> {
  const { data, error } = await db()
    .from("TaskComment")
    .select(COMMENT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as TaskCommentWithAuthor | null;
}

/**
 * Page of comments for a task, oldest-first within the page so the timeline
 * can render ascending. `before` is an ISO `createdAt` cursor (exclusive);
 * fetch returns up to `limit` rows older than the cursor.
 */
export async function getCommentsForTask(
  taskId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<TaskCommentWithAuthor[]> {
  const limit = opts.limit ?? 50;
  let q = db()
    .from("TaskComment")
    .select(COMMENT_SELECT)
    .eq("taskId", taskId)
    .order("createdAt", { ascending: false })
    .limit(limit);
  if (opts.before) q = q.lt("createdAt", opts.before);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as TaskCommentWithAuthor[];
}
