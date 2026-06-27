import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCapabilityApi } from "@/lib/access/require-capability";

/**
 * POST /api/projects/[id]/wiki/compose — async sempre (PRD D3): cria WikiJob
 * e dispara o worker interno fire-and-forget. Retorna 202 { jobId }; o
 * cliente faz poll em GET /wiki/jobs/[jobId].
 *
 * Auth de edição: manager OU contributor/lead no projeto (canEditTasks é o
 * proxy canônico de "canEditProject" no repo).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const projectId = parsed.data;

  const denied = await requireCapabilityApi("task.edit", { projectId });
  if (denied) return denied;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new NextResponse("Server misconfigured: CRON_SECRET missing", {
      status: 500,
    });
  }

  const supabase = db();
  const { data: job, error } = await supabase
    .from("WikiJob")
    .insert({ projectId, trigger: "manual" })
    .select("id")
    .single();
  if (error || !job) {
    return NextResponse.json(
      { error: error?.message ?? "Falha ao criar job" },
      { status: 500 }
    );
  }

  // Fire-and-forget: o fetch do worker não é aguardado (compose pode levar
  // minutos). Base relativa ao próprio deployment.
  const origin = req.nextUrl.origin;
  fetch(`${origin}/api/internal/wiki-composer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": secret,
    },
    body: JSON.stringify({ projectId, jobId: job.id, trigger: "manual" }),
  }).catch((err) => {
    console.error("[wiki/compose] kick do worker falhou:", err);
  });

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
