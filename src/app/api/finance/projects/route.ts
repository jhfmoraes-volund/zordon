import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { getProjects } from "@/lib/finance/dal";

/**
 * GET /api/finance/projects?from=YYYY-MM&to=YYYY-MM
 * Margem por projeto (direta e com equipe), no range. Admin-only (D2/D11) + RLS.
 */
export async function GET(req: Request) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const year = new Date().getUTCFullYear();
  const from = searchParams.get("from") || `${year}-01`;
  const to = searchParams.get("to") || `${year}-12`;

  try {
    return NextResponse.json(await getProjects(from, to));
  } catch (e) {
    console.error("[/api/finance/projects]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
