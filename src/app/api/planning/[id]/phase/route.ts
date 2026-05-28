/**
 * PATCH /api/planning/[id]/phase
 * Transição de fase disparada pelo PM (chat UI / botão).
 *
 * Body: { to: PlanningPhase }
 * Fluxo:
 *   1. Carrega planning (404) e autoriza pelo projeto.
 *   2. Carrega PhaseContext (counts) do banco.
 *   3. Chama state machine `transition()` — ela valida matriz + pré-cond.
 *   4. Aplica UPDATE com stamps (trigger SQL revalida a matriz como fail-safe).
 *   5. Side effect: reset de notes em `reading|proposing → idle`.
 *
 * Transições disparadas pelo Alpha (ex: reading → proposing) NÃO passam aqui
 * — vão direto via tool, chamando state machine + DAL server-side.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import {
  getPlanningById,
  getPlanningPhaseContext,
  updatePlanningPhase,
  resetBriefingNotes,
} from "@/lib/dal/planning";
import { transition, type PlanningPhase } from "@/lib/planning/phase";

type Body = { to: PlanningPhase };

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.to) {
    return NextResponse.json({ error: "to obrigatório" }, { status: 400 });
  }

  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }

  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return denied;

  const ctx = await getPlanningPhaseContext(id);
  const result = transition(planning.phase, body.to, ctx, "pm");

  if (!result.ok) {
    const status = result.reason === "missing_preconditions" ? 422 : 400;
    return NextResponse.json(
      { error: result.reason, detail: result.detail, from: result.from, to: result.to },
      { status },
    );
  }

  // Side effect ANTES do UPDATE: reset apaga notes, e o UPDATE confirma idle.
  // Ordem importa — se UPDATE rodar antes e o DELETE falhar, ficamos com
  // estado inconsistente (idle com notes). Banco não tem cascade aqui de
  // propósito (reset é só pro reset; archive/close preservam histórico).
  if (
    (result.from === "reading" || result.from === "proposing") &&
    result.to === "idle"
  ) {
    await resetBriefingNotes(id);
  }

  const updated = await updatePlanningPhase(id, result.to, result.stamps);
  return NextResponse.json(updated);
}
