import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { getProjectDetail } from "@/lib/finance/dal";

/**
 * GET /api/finance/projects/[id]?from=&to= — detalhe financeiro do projeto
 * (série mensal, totais, custo de equipe por membro, alocações). Admin-only.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const year = new Date().getUTCFullYear();
  const from = searchParams.get("from") || `${year}-01`;
  const to = searchParams.get("to") || `${year}-12`;
  try {
    return NextResponse.json(await getProjectDetail(id, from, to));
  } catch (e) {
    console.error("[/api/finance/projects/[id]]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
