import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { listCategories } from "@/lib/finance/dal";

/** GET /api/finance/categories — taxonomia. Admin-only (D2/D11) + RLS. */
export async function GET() {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  try {
    return NextResponse.json({ categories: await listCategories() });
  } catch (e) {
    console.error("[/api/finance/categories]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
