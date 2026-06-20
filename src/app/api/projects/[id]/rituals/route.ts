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
      sortKey: string;
      href: string;
      badges: { linkedCount: number; noteCount: number };
      facilitatorId: string | null;
      facilitatorName: string | null;
    };

function fmtWeekTitle(referenceWeek: string): string {
  // Ex: "PM Review · semana de 27/mai".
  try {
    const d = new Date(referenceWeek + "T00:00:00Z");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const months = [
      "jan",
      "fev",
      "mar",
      "abr",
      "mai",
      "jun",
      "jul",
      "ago",
      "set",
      "out",
      "nov",
      "dez",
    ];
    return `PM Review · semana de ${day}/${months[d.getUTCMonth()]}`;
  } catch {
    return `PM Review · semana de ${referenceWeek}`;
  }
}

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
    // Resolve nome do facilitador + contagem de insumos linkados (EntityLink).
    const [facilitator, linkedCountRes] = await Promise.all([
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
    ]);
    const scheduledFor = releasePlanning.scheduledFor ?? releasePlanning.createdAt;
    items.push({
      kind: "release_planning",
      id: releasePlanning.id,
      // Planning é contínuo (lê as sprints do contrato) — o título não carrega
      // mais o nº de sprints; é só o ritual do projeto.
      title: "Planning do Projeto",
      status: releasePlanning.status,
      scheduledFor,
      sortKey: scheduledFor ?? "0",
      href: `/projects/${projectId}/planning`,
      badges: { linkedCount: linkedCountRes.count ?? 0, noteCount: 0 },
      facilitatorId: releasePlanning.facilitatorId,
      facilitatorName: (facilitator.data as { name: string } | null)?.name ?? null,
    });
  }

  for (const r of pmReviews) {
    items.push({
      kind: "pm_review",
      id: r.id,
      title: fmtWeekTitle(r.referenceWeek),
      status: r.status,
      scheduledFor: r.scheduledFor,
      referenceWeek: r.referenceWeek,
      sortKey: r.referenceWeek,
      href: `/pm-reviews/${r.id}`,
      badges: {
        linkedCount: r.linkedMeetingCount + r.linkedTranscriptCount,
        noteCount: r.noteTotal,
        noteByKind: r.noteCountByKind,
        reportGenerated: r.reportGeneratedAt !== null,
      },
      facilitatorId: r.facilitatorId,
      facilitatorName: r.facilitatorName,
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
