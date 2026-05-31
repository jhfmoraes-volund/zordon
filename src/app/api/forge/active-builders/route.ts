import { NextResponse } from "next/server";
import {
  countActiveDaemons,
  listActiveDaemons,
} from "@/lib/forge/dal/daemon";

/**
 * GET /api/forge/active-builders
 *
 * Retorna lista de daemons vivos (heartbeat < 2min) com metadata pro banner
 * visual: hostname, uptime, último heartbeat. `count` é mantido pra
 * back-compat com consumidores que só queriam o número.
 */
export async function GET() {
  try {
    const [count, daemons] = await Promise.all([
      countActiveDaemons(),
      listActiveDaemons(),
    ]);
    return NextResponse.json({ count, daemons });
  } catch (error) {
    console.error("Failed to fetch active builders:", error);
    return NextResponse.json(
      { error: "Failed to fetch active builders", count: 0, daemons: [] },
      { status: 500 },
    );
  }
}
