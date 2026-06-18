// Cron: mantém vivo o draft do PM Review da semana pra cada projeto com folder
// do Granola vinculada E automação ligada (runbook pm-review-granola-folder,
// Fase 2). Roda diário (Seg–Sex). O núcleo por-projeto vive em
// @/lib/pm-review/refresh (compartilhado com o trigger por-projeto). Default da
// automação é OFF: sem RitualPlaybook enabled, getEffectivePlaybook retorna []
// → sources vazias → no-op (o projeto não entra no cron até o PM ligar).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshPMReviewForProject } from "@/lib/pm-review/refresh";

export const maxDuration = 120;

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

  const now = new Date();
  const summary = {
    referenceWeek: "",
    projects: projectOwner.size,
    enqueued: 0,
    noop: 0,
    frozen: 0,
    inFlight: 0,
    errors: [] as { projectId: string; error: string }[],
  };

  for (const [projectId, ownerId] of projectOwner) {
    const r = await refreshPMReviewForProject(admin, projectId, ownerId, now);
    summary.referenceWeek = r.referenceWeek;
    if (r.status === "error") {
      summary.errors.push({ projectId, error: r.error ?? "erro" });
    } else {
      summary[r.status]++;
    }
  }

  return NextResponse.json(summary);
}
