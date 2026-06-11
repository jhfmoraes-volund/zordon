import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser, canViewProject } from "@/lib/dal";
import { getWikiMetrics } from "@/lib/dal/wiki-metrics";

/**
 * GET /api/projects/[id]/wiki/metrics
 *   Camada determinística da Wiki — métricas SQL live (cache 5min no DAL).
 *   401 sem auth · 403 sem canViewProject · 200 WikiMetrics
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  if (!(await canViewProject(parsed.data))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return NextResponse.json(await getWikiMetrics(parsed.data));
}
