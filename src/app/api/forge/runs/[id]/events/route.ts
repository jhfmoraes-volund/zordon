import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEffectiveAccessLevel } from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/forge/runs/[runId]/events
 *
 * Retorna todos os ForgeEvent do run, ordenados por seq.
 * Usado pelo RunEventStream component pra initial fetch.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;

  const accessLevel = await getEffectiveAccessLevel();
  if (!hasMinAccessLevel(accessLevel, "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = db();
  const { data: events, error: evErr } = await supabase
    .from("ForgeEvent")
    .select("*")
    .eq("runId", runId)
    .order("seq", { ascending: true });

  if (evErr) {
    return NextResponse.json({ error: evErr.message }, { status: 500 });
  }

  return NextResponse.json({
    events: events ?? [],
  });
}
