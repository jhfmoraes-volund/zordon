import "server-only";
import { db } from "@/lib/db";
import type { Database, Json } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];
export type NotificationRow = Tables["Notification"]["Row"];

export type NotificationKind =
  | "mention"
  | "assigned"
  | "status_changed"
  | "sprint_started"
  | "sprint_ended"
  | "agent_task_change";

export type NotificationEntityType = "task" | "sprint" | "comment";

/**
 * Payload shape per kind. Stored as jsonb; UI reads `title` + `snippet` for
 * the row, `count` + `entityIds` when batched, optional `projectId` for nav.
 */
export type NotificationPayload = {
  title: string;
  snippet?: string;
  projectId?: string;
  fromStatus?: string;
  toStatus?: string;
  count?: number;
  entityIds?: string[];
};

export type NotifyInput = {
  recipientMemberId: string;
  kind: NotificationKind;
  entityType: NotificationEntityType;
  entityId: string;
  actorMemberId?: string | null;
  batchId?: string | null;
  payload: NotificationPayload;
};

export type NotificationWithActor = NotificationRow & {
  actor: { id: string; name: string | null } | null;
};

const NOTIFICATION_SELECT =
  "*, actor:Member!Notification_actorMemberId_fkey(id, name)";

const COALESCE_WINDOW_MS = 60_000;
const COALESCABLE_KINDS: ReadonlySet<NotificationKind> = new Set([
  "mention",
  "status_changed",
  "agent_task_change",
]);

/**
 * Core dispatch. Returns the notification (new or updated) or null when the
 * action self-suppressed (actor === recipient).
 *
 * Three-stage flow:
 *   1. Self-suppress
 *   2. Batch merge — when batchId is set, find existing row for
 *      (batchId, recipientMemberId, kind) and bump count + append entityId.
 *   3. Coalescing window — for kinds in COALESCABLE_KINDS, find an unread
 *      row for (recipient, kind, entityId) within the last 60s and refresh it.
 *   4. Otherwise, insert.
 */
export async function notifyMember(
  input: NotifyInput,
): Promise<NotificationRow | null> {
  if (
    input.actorMemberId &&
    input.actorMemberId === input.recipientMemberId
  ) {
    return null;
  }

  const supabase = db();

  // (2) Batch merge
  if (input.batchId) {
    const { data: existing } = await supabase
      .from("Notification")
      .select("*")
      .eq("batchId", input.batchId)
      .eq("recipientMemberId", input.recipientMemberId)
      .eq("kind", input.kind)
      .is("readAt", null)
      .maybeSingle();

    if (existing) {
      const prevPayload = (existing.payload ?? {}) as NotificationPayload;
      const prevIds = prevPayload.entityIds ?? [existing.entityId];
      const nextIds = prevIds.includes(input.entityId)
        ? prevIds
        : [...prevIds, input.entityId];
      const nextPayload: NotificationPayload = {
        ...prevPayload,
        ...input.payload,
        count: nextIds.length,
        entityIds: nextIds,
      };
      const { data, error } = await supabase
        .from("Notification")
        .update({
          payload: nextPayload as unknown as Json,
          createdAt: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  }

  // (3) Coalescing window
  if (COALESCABLE_KINDS.has(input.kind) && !input.batchId) {
    const cutoff = new Date(Date.now() - COALESCE_WINDOW_MS).toISOString();
    const { data: recent } = await supabase
      .from("Notification")
      .select("*")
      .eq("recipientMemberId", input.recipientMemberId)
      .eq("kind", input.kind)
      .eq("entityId", input.entityId)
      .is("readAt", null)
      .gte("createdAt", cutoff)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent) {
      const prevPayload = (recent.payload ?? {}) as NotificationPayload;
      const prevCount = prevPayload.count ?? 1;
      const nextPayload: NotificationPayload = {
        ...prevPayload,
        ...input.payload,
        count: prevCount + 1,
      };
      const { data, error } = await supabase
        .from("Notification")
        .update({
          payload: nextPayload as unknown as Json,
          actorMemberId: input.actorMemberId ?? recent.actorMemberId,
          createdAt: new Date().toISOString(),
        })
        .eq("id", recent.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  }

  // (4) Insert
  const { data, error } = await supabase
    .from("Notification")
    .insert({
      recipientMemberId: input.recipientMemberId,
      kind: input.kind,
      entityType: input.entityType,
      entityId: input.entityId,
      actorMemberId: input.actorMemberId ?? null,
      batchId: input.batchId ?? null,
      payload: input.payload as unknown as Json,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Fanout helper: dispatch the same payload to multiple recipients with
 * self-suppress applied per recipient. Used by mention/status/agent triggers
 * that target N members at once.
 */
export async function notifyMembers(
  recipientIds: string[],
  base: Omit<NotifyInput, "recipientMemberId">,
): Promise<void> {
  const unique = Array.from(new Set(recipientIds));
  await Promise.all(
    unique.map((recipientMemberId) =>
      notifyMember({ ...base, recipientMemberId }).catch((e) => {
        console.error("[notifications] notifyMember failed", {
          recipientMemberId,
          kind: base.kind,
          entityId: base.entityId,
          error: e instanceof Error ? e.message : String(e),
        });
      }),
    ),
  );
}

export async function listNotifications(
  memberId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<NotificationWithActor[]> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  let q = db()
    .from("Notification")
    .select(NOTIFICATION_SELECT)
    .eq("recipientMemberId", memberId)
    .order("createdAt", { ascending: false })
    .limit(limit);
  if (opts.before) q = q.lt("createdAt", opts.before);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as NotificationWithActor[];
}

export async function unreadCount(memberId: string): Promise<number> {
  const { count, error } = await db()
    .from("Notification")
    .select("id", { count: "exact", head: true })
    .eq("recipientMemberId", memberId)
    .is("readAt", null);
  if (error) throw error;
  return count ?? 0;
}

export async function markRead(
  id: string,
  memberId: string,
): Promise<void> {
  const { error } = await db()
    .from("Notification")
    .update({ readAt: new Date().toISOString() })
    .eq("id", id)
    .eq("recipientMemberId", memberId)
    .is("readAt", null);
  if (error) throw error;
}

export async function markAllRead(memberId: string): Promise<void> {
  const { error } = await db()
    .from("Notification")
    .update({ readAt: new Date().toISOString() })
    .eq("recipientMemberId", memberId)
    .is("readAt", null);
  if (error) throw error;
}

/**
 * Fan-out a sprint lifecycle event (started/ended) to every ProjectMember of
 * the sprint's project. Single batchId so the bell groups it.
 */
export async function notifySprintLifecycle(args: {
  sprintId: string;
  kind: "sprint_started" | "sprint_ended";
  actorMemberId: string | null;
}): Promise<void> {
  const supabase = db();
  const { data: sprint } = await supabase
    .from("Sprint")
    .select("id, name, projectId")
    .eq("id", args.sprintId)
    .maybeSingle();
  if (!sprint) return;

  const { data: members } = await supabase
    .from("ProjectMember")
    .select("memberId")
    .eq("projectId", sprint.projectId);
  const recipientIds = (members ?? []).map((m) => m.memberId);
  if (recipientIds.length === 0) return;

  await notifyMembers(recipientIds, {
    kind: args.kind,
    entityType: "sprint",
    entityId: sprint.id,
    actorMemberId: args.actorMemberId,
    batchId: crypto.randomUUID(),
    payload: {
      title: sprint.name,
      projectId: sprint.projectId,
    },
  });
}
