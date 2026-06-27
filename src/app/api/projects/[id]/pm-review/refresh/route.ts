// Trigger por-projeto do PM Review (runbook pm-review-production, Fase 0/1).
//   POST /api/projects/[id]/pm-review/refresh
// Roda o MESMO núcleo do cron (refreshPMReviewForProject) pra um projeto, sob
// demanda: usado como (a) bootstrap ao LIGAR a automação no card — acha-ou-cria
// o PMReview da semana e sintetiza 1× — e (b) futuro "Atualizar agora" manual.
// Autoridade = mesma do PM Review (Manager/PM ou acima, ou grant). Ação explícita:
// não checa o flag `enabled` aqui (o card liga via PUT antes de chamar).

import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  refreshPMReviewForProject,
  resolvePMReviewOwner,
} from "@/lib/pm-review/refresh";

export const maxDuration = 120;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  // PM Review = Manager (PM) ou acima (ou grant ritual.pm_review). authz-catalog.ts.
  const denied = await requireCapabilityApi("pm_review.write", { projectId });
  if (denied) return denied;

  const admin = createAdminClient();

  // Owner que dirige o turno no daemon: o PM que vinculou a folder; senão o
  // caller. Sem nenhum dos dois não há como rodar.
  const member = await getCurrentMember();
  const ownerId = (await resolvePMReviewOwner(admin, projectId)) ?? member?.id ?? null;
  if (!ownerId) {
    return NextResponse.json(
      { error: "Vincule uma folder do Granola (com sua conta) antes de rodar." },
      { status: 400 },
    );
  }

  const outcome = await refreshPMReviewForProject(admin, projectId, ownerId);
  if (outcome.status === "error") {
    return NextResponse.json(outcome, { status: 500 });
  }
  return NextResponse.json(outcome);
}
