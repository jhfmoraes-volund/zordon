import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueuePrdQuickAskJob, runPrdQuickAskJob } from "@/lib/sessions/prd-session/jobs";
import { z } from "zod";

const RequestSchema = z.object({
  projectId: z.string().uuid(),
  brief: z.string().min(10).max(2000),
});

/**
 * POST /api/sessions/prd/quick-ask/start
 * Enfileira job async pra Vitor gerar PRDs do brief.
 * Retorna 202 + jobId.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validação falhou", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { projectId, brief } = parsed.data;

    // Get current member
    const supabase = db();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Find member
    const { data: member } = await supabase
      .from("Member")
      .select("id")
      .eq("userId", user.id)
      .single();

    if (!member) {
      return NextResponse.json({ error: "Membro não encontrado" }, { status: 403 });
    }

    // Enqueue job
    const { sessionId, jobId } = await enqueuePrdQuickAskJob({
      projectId,
      brief,
      actorMemberId: member.id,
    });

    // Fire worker async (non-blocking)
    runPrdQuickAskJob(jobId).catch((err) => {
      console.error(`[PrdQuickAskJob] Worker failed for jobId=${jobId}:`, err);
    });

    return NextResponse.json(
      { sessionId, jobId },
      { status: 202 }
    );
  } catch (error) {
    console.error("[POST /api/sessions/prd/quick-ask/start]", error);
    return NextResponse.json(
      { error: "Erro interno ao criar session" },
      { status: 500 }
    );
  }
}
