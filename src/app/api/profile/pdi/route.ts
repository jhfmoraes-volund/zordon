import { NextResponse } from "next/server";
import { loadPdiPayload } from "@/lib/profile/pdi-load";

/**
 * GET /api/profile/pdi
 * Returns the current cycle's PDI for the logged-in member, with all
 * actions. Auto-creates the row on first read so the UI doesn't have
 * to bootstrap.
 */
export async function GET() {
  try {
    const payload = await loadPdiPayload();
    if (!payload) return new NextResponse("Unauthorized", { status: 401 });
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
