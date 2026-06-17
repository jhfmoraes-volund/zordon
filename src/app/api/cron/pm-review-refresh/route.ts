// Cron: mantém vivo o draft do PM Review da semana pra cada projeto com folder
// do Granola vinculada (runbook pm-review-granola-folder, Fase 2). Roda diário
// (Seg–Sex). Idempotente e barato:
//   - 1 PMReview por (projeto, semana) — UNIQUE no banco (D1)
//   - no-op se nenhuma ContextSource nova desde reportGeneratedAt (D3) → 0 custo de LLM
//   - freeze: pula projeto cujo PMReview já está 'published' (D4)
//   - não re-enfileira se já há turno queued/running pra a thread
//   - só cria o PMReview quando há conteúdo fresco (não gera draft vazio)
// A síntese roda no daemon (Vitoria), via fila ChatTurn → ForgeJob — mesmo
// caminho do botão "Sintetizar report", só que server-triggered (sem stream).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createPMReview,
  mondayOf,
  linkMeetingToPMReview,
  linkTranscriptToPMReview,
} from "@/lib/dal/pm-review";
import { ensurePMReviewThread } from "@/lib/agent/context";
import { createChatTurn, enqueueChatJob } from "@/lib/dal/chat-turn";

export const maxDuration = 120;

const SYNTH_PROMPT =
  "Atualização automática (cron diário). Sintetize ou atualize o report do PM " +
  "Review desta semana a partir das reuniões e transcrições vinculadas e grave " +
  "com a tool update_pm_review_report. Se já existir report, incorpore apenas o " +
  "que há de novo desde a última geração, sem reescrever o que segue válido.";

/** Soma `days` a uma data YYYY-MM-DD (UTC), retornando YYYY-MM-DD. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const token = process.env.PM_REVIEW_REFRESH_AUTH_TOKEN;
  if (!token) {
    return new Response(
      "Server misconfigured: PM_REVIEW_REFRESH_AUTH_TOKEN missing",
      { status: 500 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();

  // Projetos com binding ativo (memberId não-null) + um ownerId que dirige o
  // turno da Vitoria no daemon (primeiro PM que vinculou folder no projeto).
  const { data: bindings } = await admin
    .from("ProjectGranolaFolder")
    .select('"projectId", "memberId"')
    .not("memberId", "is", null);

  const projectOwner = new Map<string, string>();
  for (const b of bindings ?? []) {
    if (b.memberId && !projectOwner.has(b.projectId)) {
      projectOwner.set(b.projectId, b.memberId as string);
    }
  }

  const referenceWeek = mondayOf(new Date()); // segunda da semana (YYYY-MM-DD)
  const weekEnd = addDays(referenceWeek, 7);

  const summary = {
    referenceWeek,
    projects: projectOwner.size,
    enqueued: 0,
    noop: 0,
    frozen: 0,
    inFlight: 0,
    errors: [] as { projectId: string; error: string }[],
  };

  for (const [projectId, ownerId] of projectOwner) {
    try {
      // 1. ContextSources roteadas da semana (Fase 1.3 setou projectId).
      const { data: weekSources } = await admin
        .from("ContextSource")
        .select('id, "meetingId", "createdAt"')
        .eq("source", "granola")
        .eq("projectId", projectId)
        .gte("capturedAt", referenceWeek)
        .lt("capturedAt", weekEnd);
      const sources = weekSources ?? [];
      if (sources.length === 0) {
        summary.noop++;
        continue;
      }

      // 2. PMReview existente da semana (ainda não cria — evita draft vazio).
      const { data: existing } = await admin
        .from("PMReview")
        .select("id, status, reportGeneratedAt")
        .eq("projectId", projectId)
        .eq("referenceWeek", referenceWeek)
        .maybeSingle();

      // 3. Freeze: published não é tocado (D4).
      if (existing?.status === "published") {
        summary.frozen++;
        continue;
      }

      // 4. No-op: nada novo desde a última geração (D3). Compara em epoch —
      //    Supabase devolve timestamptz como "…+00:00" e o daemon grava "…Z";
      //    comparar como string seria frágil entre os dois formatos.
      const sinceMs = existing?.reportGeneratedAt
        ? new Date(existing.reportGeneratedAt as string).getTime()
        : 0;
      const fresh = sources.filter(
        (s) => new Date(s.createdAt as string).getTime() > sinceMs,
      );
      if (fresh.length === 0) {
        summary.noop++;
        continue;
      }

      // 5. Há conteúdo fresco → garante o PMReview da semana.
      let pmReviewId = existing?.id as string | undefined;
      if (!pmReviewId) {
        const created = await createPMReview({ projectId, referenceWeek });
        pmReviewId = created.id;
      }

      // 6. EntityLink (idempotente) das transcrições + reuniões da semana.
      for (const s of sources) {
        await linkTranscriptToPMReview({
          pmReviewId,
          transcriptRefId: s.id as string,
        });
        if (s.meetingId) {
          await linkMeetingToPMReview({
            pmReviewId,
            meetingId: s.meetingId as string,
          });
        }
      }

      // 7. Não re-enfileira se já há turno em voo pra esta thread (evita
      //    pile-up enquanto o daemon ainda processa o turno de ontem).
      const threadId = await ensurePMReviewThread(pmReviewId, ownerId);
      const { data: inFlight } = await admin
        .from("ChatTurn")
        .select("id")
        .eq("threadId", threadId)
        .in("status", ["queued", "running"])
        .limit(1)
        .maybeSingle();
      if (inFlight) {
        summary.inFlight++;
        continue;
      }

      // 8. Enfileira o turno de síntese da Vitoria (daemon).
      const { data: msg, error: msgErr } = await admin
        .from("ChatMessage")
        .insert({ threadId, role: "user", content: SYNTH_PROMPT })
        .select("id")
        .single();
      if (msgErr || !msg) {
        throw new Error(`ChatMessage insert failed: ${msgErr?.message}`);
      }
      const chatTurnId = await createChatTurn({
        threadId,
        userMessageId: msg.id as string,
        agentSlug: "vitoria",
      });
      await enqueueChatJob({
        chatTurnId,
        agentSlug: "vitoria",
        ownerId,
        threadId,
      });
      summary.enqueued++;
    } catch (err) {
      summary.errors.push({ projectId, error: (err as Error).message });
    }
  }

  return NextResponse.json(summary);
}
