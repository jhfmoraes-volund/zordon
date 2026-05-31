import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/forge/active-builders
 *
 * Returns count of distinct daemons with recent heartbeat (last 2 minutes).
 * Queries ForgeJob table for jobs with status='running' or 'claimed' and
 * heartbeatAt within the last 2 minutes.
 */
export async function GET() {
  try {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const { data, error } = await db()
      .from("ForgeJob")
      .select("claimedBy")
      .in("status", ["claimed", "running"])
      .gte("heartbeatAt", twoMinutesAgo)
      .not("claimedBy", "is", null);

    if (error) throw error;

    // Count distinct claimedBy values
    const uniqueDaemons = new Set(
      (data ?? []).map((row) => row.claimedBy).filter(Boolean),
    );

    return NextResponse.json({ count: uniqueDaemons.size });
  } catch (error) {
    console.error("Failed to fetch active builders:", error);
    return NextResponse.json(
      { error: "Failed to fetch active builders", count: 0 },
      { status: 500 },
    );
  }
}
