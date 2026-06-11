import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUser, canViewProject } from "@/lib/dal";

/**
 * GET /api/projects/[id]/wiki/jobs/[jobId] — poll do compose (D9: lê WikiJob,
 * não Map in-memory — Cloud Run multi-instância).
 *   200 { status, error?, finishedAt? } · 404 job desconhecido
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id, jobId } = await params;
  const parsed = z
    .object({ id: z.string().uuid(), jobId: z.string().uuid() })
    .safeParse({ id, jobId });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
  }

  if (!(await canViewProject(parsed.data.id))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { data: job, error } = await db()
    .from("WikiJob")
    .select("status, error, finishedAt")
    .eq("id", parsed.data.jobId)
    .eq("projectId", parsed.data.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    error: job.error ?? undefined,
    finishedAt: job.finishedAt ?? undefined,
  });
}
