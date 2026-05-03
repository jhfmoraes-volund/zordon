import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  getActorMemberId,
  requireProjectMemberApi,
  requireProjectViewApi,
} from "@/lib/dal";
import {
  createComment,
  decorateForViewer,
  getCommentsForTask,
} from "@/lib/dal/task-comments";
import { parseMentions, type MentionMember } from "@/lib/mentions";

const createSchema = z.object({
  body: z.string().trim().min(1).max(16_000),
});

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = await fetchTaskProjectId(id);
  if (!projectId) return new NextResponse("Not found", { status: 404 });

  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const before = sp.get("before") ?? undefined;
  const limitParam = sp.get("limit");
  const limit = limitParam
    ? Math.min(MAX_LIMIT, Math.max(1, parseInt(limitParam, 10) || DEFAULT_LIMIT))
    : DEFAULT_LIMIT;

  const [comments, viewerMemberId] = await Promise.all([
    getCommentsForTask(id, { before, limit }),
    getActorMemberId(),
  ]);
  return NextResponse.json({
    comments: comments.map((c) => decorateForViewer(c, viewerMemberId)),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = await fetchTaskProjectId(id);
  if (!projectId) return new NextResponse("Not found", { status: 404 });

  const denied = await requireProjectMemberApi(projectId);
  if (denied) return denied;

  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const members = await fetchProjectMembers(projectId);
  const { ids: mentionedMemberIds } = parseMentions(parsed.data.body, members);

  try {
    const comment = await createComment({
      taskId: id,
      body: parsed.data.body,
      mentionedMemberIds,
    });
    const viewerMemberId = await getActorMemberId();
    return NextResponse.json(
      { comment: decorateForViewer(comment, viewerMemberId) },
      { status: 201 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
