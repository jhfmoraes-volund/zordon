import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  createPMReview,
  linkMeetingToPMReview,
  linkTranscriptToPMReview,
} from "@/lib/dal/pm-review";
import {
  getEffectivePlaybook,
  resolveLoadContextSources,
  derivePromptParams,
} from "@/lib/dal/ritual-playbook";
import { ensurePMReviewThread } from "@/lib/agent/context";
import { createChatTurn, enqueueChatJob } from "@/lib/dal/chat-turn";

// Núcleo do refresh do PM Review de UM projeto. Compartilhado pelo cron diário
// (loop sobre projetos) e pelo trigger por-projeto (bootstrap ao ligar a
// automação + "Atualizar agora" manual). Idempotente e barato:
//   - 1 PMReview por (projeto, semana) — UNIQUE no banco (D1)
//   - no-op se nenhuma fonte nova desde reportGeneratedAt (D3) → 0 custo de LLM
//   - freeze: pula se já 'published' (D4)
//   - não re-enfileira se já há turno queued/running pra a thread
//   - só cria o PMReview quando há conteúdo fresco (não gera draft vazio — D2)
// A síntese roda no daemon (Vitoria) via fila ChatTurn → ForgeJob.

export const PM_REVIEW_SYNTH_PROMPT =
  "Atualização automática (cron diário). Sintetize ou atualize o report do PM " +
  "Review desta semana a partir das reuniões e transcrições vinculadas e grave " +
  "com a tool update_pm_review_report. Se já existir report, incorpore apenas o " +
  "que há de novo desde a última geração, sem reescrever o que segue válido.";

type Client = SupabaseClient<Database>;

export type RefreshStatus =
  | "enqueued"
  | "noop"
  | "frozen"
  | "inFlight"
  | "error";

export type RefreshOutcome = {
  status: RefreshStatus;
  referenceWeek: string;
  pmReviewId?: string;
  error?: string;
};

/** Soma `days` a uma data YYYY-MM-DD, retornando YYYY-MM-DD. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Segunda-feira da semana corrente em BRT (Brasil sem DST desde 2019 → UTC-3),
 * como YYYY-MM-DD. referenceWeek + a janela do PM Review ficam ancorados em BRT
 * pra não jogar reunião de domingo-à-noite na semana errada.
 */
export function brtMonday(now: Date): string {
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000); // wall-clock BRT em campos UTC
  const dow = brt.getUTCDay(); // 0=Dom..6=Sáb
  const sinceMonday = (dow + 6) % 7; // dias desde segunda
  brt.setUTCDate(brt.getUTCDate() - sinceMonday);
  return brt.toISOString().slice(0, 10);
}

/**
 * Owner que dirige o turno da Vitoria no daemon: o primeiro PM que vinculou uma
 * folder do Granola ao projeto (binding com memberId não-null). Null se o
 * projeto não tem binding com token — sem owner não há como rodar.
 */
export async function resolvePMReviewOwner(
  admin: Client,
  projectId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("ProjectGranolaFolder")
    .select('"memberId"')
    .eq("projectId", projectId)
    .not("memberId", "is", null)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.memberId as string | null) ?? null;
}

/**
 * Refresca o PM Review da semana corrente de um projeto. `ownerId` dirige o
 * turno do daemon. Retorna o desfecho (enqueued/noop/frozen/inFlight/error) —
 * nunca lança: erros viram { status: 'error' }.
 */
export async function refreshPMReviewForProject(
  admin: Client,
  projectId: string,
  ownerId: string,
  now: Date = new Date(),
): Promise<RefreshOutcome> {
  const referenceWeek = brtMonday(now); // segunda da semana em BRT (YYYY-MM-DD)
  const weekEnd = addDays(referenceWeek, 7);
  const weekStartTs = `${referenceWeek}T00:00:00-03:00`;
  const weekEndTs = `${weekEnd}T00:00:00-03:00`;

  try {
    // 1. Playbook efetivo → fontes a linkar. Vazio quando a automação está
    //    desligada (sem row enabled) → no-op limpo.
    const caps = await getEffectivePlaybook(admin, projectId, "pm_review");
    const sources = await resolveLoadContextSources(admin, projectId, caps, {
      startTs: weekStartTs,
      endTs: weekEndTs,
    });
    if (sources.length === 0) {
      return { status: "noop", referenceWeek };
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
      return { status: "frozen", referenceWeek, pmReviewId: existing.id as string };
    }

    // 4. No-op: nada novo desde a última geração (D3). Compara em epoch.
    const sinceMs = existing?.reportGeneratedAt
      ? new Date(existing.reportGeneratedAt as string).getTime()
      : 0;
    const fresh = sources.filter(
      (s) => new Date(s.createdAt).getTime() > sinceMs,
    );
    if (fresh.length === 0) {
      return { status: "noop", referenceWeek, pmReviewId: existing?.id as string };
    }

    // 5. Há conteúdo fresco → garante o PMReview da semana. Conflict-safe.
    let pmReviewId = existing?.id as string | undefined;
    if (!pmReviewId) {
      try {
        const created = await createPMReview({ projectId, referenceWeek });
        pmReviewId = created.id;
      } catch (e) {
        const m = (e as Error).message ?? "";
        if (m.includes("PMReview_project_week_key") || m.includes("23505")) {
          const { data: row } = await admin
            .from("PMReview")
            .select("id")
            .eq("projectId", projectId)
            .eq("referenceWeek", referenceWeek)
            .single();
          pmReviewId = (row?.id as string | undefined) ?? undefined;
        } else {
          throw e;
        }
      }
    }
    if (!pmReviewId) {
      throw new Error("PMReview id ausente após create/refetch");
    }

    // 6. EntityLink (idempotente) das transcrições + reuniões da semana.
    for (const s of sources) {
      await linkTranscriptToPMReview({ pmReviewId, transcriptRefId: s.id });
      if (s.meetingId) {
        await linkMeetingToPMReview({ pmReviewId, meetingId: s.meetingId });
      }
    }

    // 7. Não re-enfileira se já há turno em voo pra esta thread.
    const threadId = await ensurePMReviewThread(pmReviewId, ownerId);
    const { data: inFlight } = await admin
      .from("ChatTurn")
      .select("id")
      .eq("threadId", threadId)
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();
    if (inFlight) {
      return { status: "inFlight", referenceWeek, pmReviewId };
    }

    // 8. Enfileira o turno de síntese da Vitoria (daemon).
    const { data: msg, error: msgErr } = await admin
      .from("ChatMessage")
      .insert({ threadId, role: "user", content: PM_REVIEW_SYNTH_PROMPT })
      .select("id")
      .single();
    if (msgErr || !msg) {
      throw new Error(`ChatMessage insert failed: ${msgErr?.message}`);
    }
    const chatTurnId = await createChatTurn({
      threadId,
      userMessageId: msg.id as string,
      agentSlug: "vitoria",
      turnParams: derivePromptParams(caps),
    });
    await enqueueChatJob({
      chatTurnId,
      agentSlug: "vitoria",
      ownerId,
      threadId,
    });
    return { status: "enqueued", referenceWeek, pmReviewId };
  } catch (err) {
    return { status: "error", referenceWeek, error: (err as Error).message };
  }
}
