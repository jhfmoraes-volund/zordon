/**
 * GET /api/projects/[id]/rituals
 *
 * Lista normalizada (UNION) de Planning + PM Review do projeto. A tab Rituais
 * (UI) consome só este endpoint pra montar a lista — não chama
 * /plannings e /pm-reviews separados.
 *
 * Cada item tem `kind` discriminador + `href` pra navegação.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import {
  listPMReviewsForProject,
  type PMReviewNoteKind,
} from "@/lib/dal/pm-review";
import { listForProject as listPlanningSessionsForProject } from "@/lib/dal/planning-session";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";

type RitualItem =
  | {
      kind: "pm_review";
      id: string;
      title: string;
      status: "draft" | "published" | "archived";
      scheduledFor: string | null;
      referenceWeek: string;
      /** Contínuo (como Planning): última atividade entre as reviews. */
      lastActivityAt: string;
      sortKey: string;
      href: string;
      badges: {
        linkedCount: number;
        noteCount: number;
        noteByKind: Partial<Record<PMReviewNoteKind, number>>;
        reportGenerated: boolean;
      };
      facilitatorId: string | null;
      facilitatorName: string | null;
    }
  | {
      kind: "release_planning";
      id: string;
      title: string;
      status: string;
      scheduledFor: string | null;
      /**
       * Quando o plano foi mexido pela última vez — o mais recente entre a última
       * versão aplicada (PlanningEvent), a última edição (updatedAt) e a criação.
       * Planning é singleton contínuo (nunca "publica"), então a UI mostra
       * atividade em vez de status de ciclo de vida. Ver rituais-file-view.
       */
      lastActivityAt: string;
      sortKey: string;
      href: string;
      badges: { linkedCount: number; noteCount: number };
      facilitatorId: string | null;
      facilitatorName: string | null;
    };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;

  const [pmReviews, planningSessions, canCreatePMReview] =
    await Promise.all([
      listPMReviewsForProject(projectId),
      listPlanningSessionsForProject(projectId),
      canCreatePMReviewForProject(projectId),
    ]);

  const items: RitualItem[] = [];

  // Release Planning é singleton por projeto: surface só o mais recente
  // (listForProject vem desc por createdAt).
  const releasePlanning = planningSessions.find((s) => s.status !== "aborted");
  if (releasePlanning) {
    // Resolve nome do facilitador + insumos linkados (EntityLink) + a última
    // versão aplicada (PlanningEvent, desc por createdAt) — fonte mais forte do
    // "usado pela última vez".
    const [facilitator, linkedCountRes, lastEventRes] = await Promise.all([
      releasePlanning.facilitatorId
        ? db()
            .from("Member")
            .select("name")
            .eq("id", releasePlanning.facilitatorId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      db()
        .from("EntityLink")
        .select("id", { count: "exact", head: true })
        .eq("planningSessionId", releasePlanning.id)
        .not("contextSourceId", "is", null),
      db()
        .from("PlanningEvent")
        .select("createdAt")
        .eq("planningSessionId", releasePlanning.id)
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const scheduledFor = releasePlanning.scheduledFor ?? releasePlanning.createdAt;
    // Última atividade = o mais recente entre: versão aplicada, edição, criação.
    // ISO 8601 ordena lexicograficamente = cronologicamente.
    const lastActivityAt =
      [
        (lastEventRes.data as { createdAt: string } | null)?.createdAt,
        releasePlanning.updatedAt,
        releasePlanning.createdAt,
      ]
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? releasePlanning.createdAt;
    items.push({
      kind: "release_planning",
      id: releasePlanning.id,
      // Planning é contínuo (lê as sprints do contrato) — o título não carrega
      // mais o nº de sprints; é só o ritual do projeto.
      title: "Planning do Projeto",
      status: releasePlanning.status,
      scheduledFor,
      lastActivityAt,
      sortKey: scheduledFor ?? "0",
      href: `/projects/${projectId}/planning`,
      badges: { linkedCount: linkedCountRes.count ?? 0, noteCount: 0 },
      facilitatorId: releasePlanning.facilitatorId,
      facilitatorName: (facilitator.data as { name: string } | null)?.name ?? null,
    });
  }

  // PM Review é contínuo por projeto (como Planning): UMA linha "PM Review do
  // Projeto". As semanas — inclusive as antigas — viram navegação na régua
  // (cronograma) DENTRO da app, não itens soltos aqui. A linha aparece quando
  // há ≥1 review viva; criar a 1ª semana vive na app (célula vazia) ou no picker.
  // Archived fica fora (D11 do runbook pm-review-unified-app).
  const liveReviews = pmReviews.filter((r) => r.status !== "archived");
  const latest = liveReviews[0]; // listPMReviewsForProject vem desc por referenceWeek
  if (latest) {
    const lastActivityAt =
      liveReviews
        .flatMap((r) => [
          r.reportGeneratedAt,
          r.publishedAt,
          r.scheduledFor,
          r.referenceWeek,
        ])
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? latest.referenceWeek;
    items.push({
      kind: "pm_review",
      id: latest.id,
      title: "PM Review do Projeto",
      status: latest.status,
      scheduledFor: latest.scheduledFor,
      referenceWeek: latest.referenceWeek,
      lastActivityAt,
      sortKey: lastActivityAt,
      href: `/projects/${projectId}/pm-review`,
      badges: {
        linkedCount: latest.linkedMeetingCount + latest.linkedTranscriptCount,
        noteCount: latest.noteTotal,
        noteByKind: latest.noteCountByKind,
        reportGenerated: latest.reportGeneratedAt !== null,
      },
      facilitatorId: latest.facilitatorId,
      facilitatorName: latest.facilitatorName,
    });
  }

  // Ordena tudo por sortKey (data) desc — mais recente primeiro.
  items.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));

  // Procura o "PM Review da semana" — último published.
  const featured =
    items.find((i) => i.kind === "pm_review" && i.status === "published") ?? null;

  return NextResponse.json({
    items,
    featured,
    permissions: { canCreatePMReview },
  });
}
