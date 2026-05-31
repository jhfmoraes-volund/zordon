import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/sessions/prd/quick-ask/jobs/[id]
 * Polling endpoint: retorna status do job + PRDs gerados quando done.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const supabase = db();

    // Fetch job
    const { data: job, error: jobErr } = await supabase
      .from("PrdQuickAskJob")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobErr || !job) {
      return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
    }

    // If done, fetch PRDs
    let prds = null;
    if (job.status === "done") {
      const { data: prdData } = await supabase
        .from("ProductRequirement")
        .select("id, title, problem, goal, acceptanceCriteria, status")
        .eq("designSessionId", job.sessionId)
        .order("createdAt", { ascending: true });

      prds = prdData ?? [];
    }

    return NextResponse.json({
      jobId: job.id,
      sessionId: job.sessionId,
      status: job.status,
      prdCount: job.prdCount ?? 0,
      error: job.error,
      prds,
    });
  } catch (error) {
    console.error("[GET /api/sessions/prd/quick-ask/jobs/:id]", error);
    return NextResponse.json(
      { error: "Erro ao buscar job" },
      { status: 500 }
    );
  }
}
