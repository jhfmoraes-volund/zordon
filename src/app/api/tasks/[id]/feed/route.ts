import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import { getFeedForTask } from "@/lib/dal/task-feed";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: task } = await db()
    .from("Task")
    .select("projectId")
    .eq("id", id)
    .maybeSingle();
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const denied = await requireProjectViewApi(task.projectId);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const before = sp.get("before") ?? undefined;
  const limitParam = sp.get("limit");
  const limit = limitParam
    ? Math.min(MAX_LIMIT, Math.max(1, parseInt(limitParam, 10) || DEFAULT_LIMIT))
    : DEFAULT_LIMIT;

  const items = await getFeedForTask(id, { before, limit });
  return NextResponse.json({ items });
}
