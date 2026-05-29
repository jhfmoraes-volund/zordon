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
import { requireProjectViewApi } from "@/lib/dal";
import { listPlanningsForProject } from "@/lib/dal/planning";
import {
  listPMReviewsForProject,
  type PMReviewNoteKind,
} from "@/lib/dal/pm-review";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";

type RitualItem =
  | {
      kind: "planning";
      id: string;
      title: string;
      status: string;
      scheduledFor: string | null;
      sortKey: string;
      href: string;
      badges: { linkedCount: number; noteCount: number; pendingCount: number };
      facilitatorName: string | null;
      sprintName: string | null;
    }
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

  const [plannings, pmReviews, canCreatePMReview] = await Promise.all([
    listPlanningsForProject(projectId),
    listPMReviewsForProject(projectId),
    canCreatePMReviewForProject(projectId),
  ]);

  const items: RitualItem[] = [];

  for (const p of plannings) {
    const baseDate = p.scheduledFor ?? p.startedAt ?? null;
    items.push({
      kind: "planning",
      id: p.id,
      title: `Planning${p.sprintName ? ` · ${p.sprintName}` : ""}`,
      status: p.phase,
      scheduledFor: baseDate,
      sortKey: baseDate ?? "0",
      href: `/rituals/${p.id}`,
      badges: {
        linkedCount: p.linkedMeetingCount + p.linkedTranscriptCount,
        noteCount: p.contextNoteCount,
        pendingCount: p.pendingActionCount,
      },
      facilitatorName: p.facilitatorName,
      sprintName: p.sprintName,
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
