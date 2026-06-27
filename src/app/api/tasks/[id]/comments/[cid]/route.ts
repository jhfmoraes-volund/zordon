import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  getActorMemberId,
} from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  decorateForViewer,
  deleteComment,
  editComment,
  getCommentById,
} from "@/lib/dal/task-comments";
import { parseMentions, type MentionMember } from "@/lib/mentions";

const patchSchema = z.object({
  body: z.string().trim().min(1).max(16_000),
});

async function fetchTaskProjectId(taskId: string): Promise<string | null> {
  const { data } = await db()
    .from("Task")
    .select("projectId")
    .eq("id", taskId)
    .maybeSingle();
  return data?.projectId ?? null;
}

async function fetchProjectMembers(
  projectId: string,
): Promise<MentionMember[]> {
  const { data, error } = await db()
    .from("ProjectMember")
    .select("member:Member!ProjectMember_memberId_fkey(id, name)")
    .eq("projectId", projectId);
  if (error) throw error;
  return (data ?? [])
    .map((pm) => {
      const m = pm.member as
        | { id: string; name: string | null }
        | { id: string; name: string | null }[]
        | null;
      return Array.isArray(m) ? m[0] ?? null : m;
    })
    .filter((m): m is MentionMember => Boolean(m));
}

async function authorizeAuthor(cid: string): Promise<
  | { ok: true; projectId: string }
  | { ok: false; response: Response }
> {
  const comment = await getCommentById(cid);
  if (!comment) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Comment not found" },
        { status: 404 },
      ),
    };
  }
  const projectId = await fetchTaskProjectId(comment.taskId);
  if (!projectId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Task not found" },
        { status: 404 },
      ),
    };
  }
  const denied = await requireCapabilityApi("task.comment", { projectId });
  if (denied) return { ok: false, response: denied };

  const me = await getActorMemberId();
  if (!me || comment.authorMemberId !== me) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Only the author can edit this comment" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, projectId };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  const { cid } = await params;
  const auth = await authorizeAuthor(cid);
  if (!auth.ok) return auth.response;

  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const members = await fetchProjectMembers(auth.projectId);
  const { ids: mentionedMemberIds } = parseMentions(parsed.data.body, members);

  try {
    const comment = await editComment(
      cid,
      parsed.data.body,
      mentionedMemberIds,
    );
    const viewerMemberId = await getActorMemberId();
    return NextResponse.json({
      comment: decorateForViewer(comment, viewerMemberId),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "edit failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  const { cid } = await params;
  const auth = await authorizeAuthor(cid);
  if (!auth.ok) return auth.response;

  try {
    await deleteComment(cid);
    return NextResponse.json({ ok: true, id: cid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
