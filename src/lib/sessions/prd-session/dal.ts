import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";
import crypto from "crypto";

type Tables = Database["public"]["Tables"];
type DesignSessionInsert = Tables["DesignSession"]["Insert"];

// ─── Quick-Ask Launcher (QAL-003) ────────────────────────────────────────────
//
// Ciclo de vida draft-no-open (D13):
//   open   → createPrdDraftSession      (status=draft, firstAnalysisStatus=pending)
//   OK     → finalizePrdLauncherSession (valida brief OU insumo; status=in_progress)
//   cancel → deletePrdDraftSession      (só se ainda draft)
//
// Sem PrdQuickAskJob, sem Haiku single-shot — a 1ª análise vive no chat.

/**
 * Cria a DesignSession draft ao abrir o launcher. Insumos linkam ao vivo
 * nessa session (infra context-import já usa sessionId). Brief e finalização
 * vêm depois, no finalize.
 */
export async function createPrdDraftSession(args: {
  projectId: string;
  actorMemberId: string;
}): Promise<{ sessionId: string }> {
  const { projectId, actorMemberId } = args;
  const supabase = db();

  const sessionId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const insert: DesignSessionInsert = {
    id: sessionId,
    projectId,
    type: "prd_session",
    subKind: "quick_ask",
    title: "PRD Quick-Ask — rascunho",
    status: "draft",
    firstAnalysisStatus: "pending",
    currentStep: 0,
    totalSteps: 1,
    createdBy: actorMemberId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const { error } = await supabase.from("DesignSession").insert(insert);
  if (error) throw error;

  return { sessionId };
}

/** Conta insumos (ContextSource) linkados a uma session via EntityLink. */
async function countSessionInsumos(sessionId: string): Promise<number> {
  const supabase = db();
  const { count, error } = await supabase
    .from("EntityLink")
    .select("id", { count: "exact", head: true })
    .eq("designSessionId", sessionId)
    .not("contextSourceId", "is", null);
  if (error) throw error;
  return count ?? 0;
}

export type FinalizePrdLauncherResult =
  | { ok: true; sessionId: string }
  | { ok: false; status: number; error: string };

/**
 * Finaliza o launcher (OK). Valida brief≥10 OU ≥1 insumo linkado; seta
 * launcherBrief + status=in_progress. Idempotente via guard `status=draft`.
 */
export async function finalizePrdLauncherSession(args: {
  sessionId: string;
  brief?: string | null;
}): Promise<FinalizePrdLauncherResult> {
  const { sessionId } = args;
  const brief = (args.brief ?? "").trim();
  const supabase = db();

  const { data: session, error: fetchErr } = await supabase
    .from("DesignSession")
    .select("id, status, type, subKind")
    .eq("id", sessionId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!session) return { ok: false, status: 404, error: "Session não encontrada" };
  if (session.type !== "prd_session" || session.subKind !== "quick_ask") {
    return { ok: false, status: 400, error: "Session não é um launcher de Quick-Ask" };
  }
  if (session.status !== "draft") {
    return { ok: false, status: 409, error: "Session já finalizada" };
  }

  const hasBrief = brief.length >= 10;
  const insumoCount = hasBrief ? 0 : await countSessionInsumos(sessionId);
  if (!hasBrief && insumoCount === 0) {
    return {
      ok: false,
      status: 422,
      error: "Informe um brief (≥10 caracteres) ou anexe ao menos 1 insumo.",
    };
  }

  const title = hasBrief
    ? `PRD Quick-Ask — ${brief.slice(0, 50)}${brief.length > 50 ? "..." : ""}`
    : "PRD Quick-Ask — a partir de insumos";

  const { error: updErr } = await supabase
    .from("DesignSession")
    .update({
      launcherBrief: hasBrief ? brief : null,
      status: "in_progress",
      title,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("status", "draft"); // guard contra race
  if (updErr) throw updErr;

  return { ok: true, sessionId };
}

/**
 * Deleta a session draft no cancel/fechar. Só apaga se ainda `status=draft`
 * (no-op se já finalizada). Remove os EntityLinks de insumo antes, pra não
 * esbarrar em FK; ContextSource (reutilizável no projeto) é preservado.
 */
export async function deletePrdDraftSession(args: {
  sessionId: string;
}): Promise<{ deleted: boolean }> {
  const { sessionId } = args;
  const supabase = db();

  // Confirma que é uma draft de quick-ask antes de mexer.
  const { data: session, error: fetchErr } = await supabase
    .from("DesignSession")
    .select("id, status, type, subKind")
    .eq("id", sessionId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (
    !session ||
    session.type !== "prd_session" ||
    session.subKind !== "quick_ask" ||
    session.status !== "draft"
  ) {
    return { deleted: false };
  }

  // Solta os links de insumo (preserva ContextSource), depois a session.
  const { error: linkErr } = await supabase
    .from("EntityLink")
    .delete()
    .eq("designSessionId", sessionId);
  if (linkErr) throw linkErr;

  const { data, error } = await supabase
    .from("DesignSession")
    .delete()
    .eq("id", sessionId)
    .eq("status", "draft")
    .select("id");
  if (error) throw error;

  return { deleted: (data?.length ?? 0) > 0 };
}
