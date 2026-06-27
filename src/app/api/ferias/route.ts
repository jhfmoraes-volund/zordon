import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { getFeriasData } from "@/lib/ferias/dal";

/**
 * GET /api/ferias?year=YYYY — calendário + saldos do escopo do usuário.
 * Manager+ (PM/Admin). A RLS escopa as entradas; o DAL escopa as linhas
 * (admin = time inteiro, PM = squad).
 */
export async function GET(req: Request) {
  const denied = await requireMinAccessLevelApi("manager");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year")) || new Date().getUTCFullYear();
  try {
    return NextResponse.json(await getFeriasData(year));
  } catch (e) {
    console.error("[/api/ferias GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
