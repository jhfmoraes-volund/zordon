import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canViewProject, requireMinLevelApi } from "@/lib/dal";
import { BUILDER } from "@/lib/roles";
import { getPrdsForProject, type PrdStatus } from "@/lib/dal/product-requirements";

export const dynamic = "force-dynamic";

const Query = z.object({
  projectId: z.string().uuid(),
  status: z.enum(["draft", "review", "approved", "superseded"]).optional(),
});

export async function GET(req: NextRequest) {
  const denied = await requireMinLevelApi(BUILDER);
  if (denied) return denied;

  const url = new URL(req.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  if (!(await canViewProject(parsed.data.projectId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const status: PrdStatus[] | undefined = parsed.data.status
    ? [parsed.data.status]
    : undefined;
  const rows = await getPrdsForProject(parsed.data.projectId, { status });
  return NextResponse.json({ data: rows });
}
