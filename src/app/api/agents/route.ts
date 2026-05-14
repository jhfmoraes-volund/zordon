import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

/**
 * GET /api/agents — lista agentes ativos (Manager+).
 */
export async function GET() {
  try {
    const denied = await requireMinLevelApi(MANAGER);
    if (denied) return denied;

    const { data, error } = await db()
      .from("Agent")
      .select("id, slug, name, description, modelId, isActive, updatedAt")
      .eq("isActive", true)
      .order("name", { ascending: true });

    if (error) {
      console.error("[/api/agents] supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ agents: data || [] });
  } catch (e) {
    console.error("[/api/agents] throw:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
