/**
 * POST /api/planning/[id]/complete
 *
 * Staging-commit: PM clica "Concluir planning" → aplica todas as
 * MeetingTaskAction pendentes em cascata + transiciona phase pra `closed`.
 *
 * Append-only e irreversível. Pra reverter, PM abre uma nova planning na
 * mesma sprint (discutindo com Vitoria os ajustes).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectEditTasksApi, getCurrentMember } from "@/lib/dal";
import { getPlanningById, concludePlanning } from "@/lib/dal/planning";
import { recordPlanningEventFromCeremony } from "@/lib/dal/planning-event";

// Aplica o plano inteiro em cascata (pode ser dezenas de tasks). Com o executor
// em lote roda em ~2-3s. maxDuration >= o timeout do cliente (90s em
// proposals.tsx) de propósito: o server precisa ser o teto, senão ele é cortado
// aos 60s e o cliente espera por algo que já morreu (estado parcial, achado #8).
// Backfill patológico (centenas de tasks) que estoure 120s → tornar async (202+job).
export const maxDuration = 120;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }

  const denied = await requireProjectEditTasksApi(planning.projectId);
  if (denied) return denied;

  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "sem memberId no contexto" }, { status: 401 });
  }

  if (planning.phase === "closed" || planning.phase === "archived") {
    return NextResponse.json(
      { error: "planning já concluída", phase: planning.phase },
      { status: 409 },
    );
  }

  try {
    const result = await concludePlanning(id, me.id);

    // Planning Vivo Versionado — Fase 1 (Log): grava o PlanningEvent (snapshot +
    // briefing) pra o canvas mostrar histórico em vez de "Plano vazio". Keyed por
    // PlanningSession (a companion ceremony é reciclada a cada apply). Best-effort:
    // o apply (mutação que importa) já foi commitado — uma falha aqui NÃO derruba
    // a request. No-op se a ceremony for uma Sprint Planning (não Release Planning).
    //
    // INVARIANTE: o snapshot INFORMA versões futuras, nunca vira estado a restaurar.
    try {
      await recordPlanningEventFromCeremony({
        planningCeremonyId: id,
        createdById: me.id,
        appliedCount: result.applied.applied,
        failedCount: result.applied.failed,
        skippedCount: result.applied.skipped,
      });
    } catch (logErr) {
      console.error(
        `[planning/complete] PlanningEvent log falhou (ceremony=${id}); apply OK, seguindo:`,
        logErr,
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao concluir planning", detail: msg },
      { status: 500 },
    );
  }
}
