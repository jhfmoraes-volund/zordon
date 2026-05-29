/**
 * GET /api/projects/[id]/insumo-pool?excludePMReviewId=<uuid>
 *
 * Retorna o "pool" de insumos já instalados no projeto — material que outros
 * rituais (Planning OU PM Review) já ingeriram, pronto pra ser linkado a este
 * PM Review com 1 clique.
 *
 * Filtros:
 *   • Transcripts: linkados via PlanningTranscriptLink OU PMReviewTranscriptLink
 *     no escopo do projeto (não duplica se mesmo TranscriptRef aparece em 2
 *     rituais).
 *   • Meetings: linkadas via MeetingProjectLink ao projeto E com TranscriptRef
 *     anexado OU notes substanciais (≥50 chars). Filtra meetings sem material.
 *   • Exclui itens JÁ linkados ao PM Review corrente (excludePMReviewId).
 *
 * Forma da resposta:
 *   { transcripts: PoolTranscript[], meetings: PoolMeeting[] }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";

type PoolTranscript = {
  transcriptRefId: string;
  source: string;
  sourceId: string | null;
  title: string | null;
  capturedAt: string | null;
  origin: {
    kind: "planning" | "pm_review";
    label: string;
    ritualId: string;
  } | null;
};

type PoolMeeting = {
  meetingId: string;
  title: string | null;
  date: string;
  hasTranscript: boolean;
  notesPreview: string | null;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;

  const excludePMReviewId = req.nextUrl.searchParams.get("excludePMReviewId");
  const supabase = db();

  // ─── 1. Transcripts no pool ────────────────────────────────────────────
  // Coleta IDs de TranscriptRef linkados a qualquer ritual do projeto.

  // Planning side: pega plannings do projeto + transcript links delas.
  const { data: planningsRes } = await supabase
    .from("PlanningCeremony")
    .select(
      'id, sprint:Sprint(name), links:PlanningTranscriptLink("transcriptRefId", transcript:TranscriptRef(id, source, "sourceId", title, "capturedAt"))',
    )
    .eq("projectId", projectId);

  // PM Review side: pega pm reviews do projeto + links.
  const { data: pmReviewsRes } = await supabase
    .from("PMReview")
    .select(
      'id, "referenceWeek", links:PMReviewTranscriptLink("transcriptRefId", transcript:TranscriptRef(id, source, "sourceId", title, "capturedAt"))',
    )
    .eq("projectId", projectId);

  // Dedup por transcriptRefId; preserva a primeira origem encontrada.
  const transcriptMap = new Map<string, PoolTranscript>();

  for (const p of planningsRes ?? []) {
    const sprintName = (p.sprint as { name: string } | null)?.name ?? null;
    for (const l of (p.links ?? []) as Array<{
      transcriptRefId: string;
      transcript: unknown;
    }>) {
      const t = (l as { transcript: PoolTranscript & { id: string } | null }).transcript;
      if (!t) continue;
      const refId = (l as { transcriptRefId: string }).transcriptRefId;
      if (transcriptMap.has(refId)) continue;
      transcriptMap.set(refId, {
        transcriptRefId: refId,
        source: t.source,
        sourceId: t.sourceId,
        title: t.title,
        capturedAt: t.capturedAt,
        origin: {
          kind: "planning",
          label: sprintName ? `Planning · ${sprintName}` : "Planning",
          ritualId: p.id,
        },
      });
    }
  }

  for (const r of pmReviewsRes ?? []) {
    // Se for o PM Review corrente, ignora — itens já linkados a ele não entram no pool.
    if (excludePMReviewId && r.id === excludePMReviewId) continue;
    for (const l of (r.links ?? []) as Array<{
      transcriptRefId: string;
      transcript: unknown;
    }>) {
      const t = (l as { transcript: PoolTranscript & { id: string } | null }).transcript;
      if (!t) continue;
      const refId = (l as { transcriptRefId: string }).transcriptRefId;
      if (transcriptMap.has(refId)) continue;
      transcriptMap.set(refId, {
        transcriptRefId: refId,
        source: t.source,
        sourceId: t.sourceId,
        title: t.title,
        capturedAt: t.capturedAt,
        origin: {
          kind: "pm_review",
          label: `PM Review · sem ${r.referenceWeek.slice(5)}`,
          ritualId: r.id,
        },
      });
    }
  }

  // Remove transcripts JÁ linkados ao PM Review corrente.
  if (excludePMReviewId) {
    const { data: alreadyLinked } = await supabase
      .from("PMReviewTranscriptLink")
      .select("transcriptRefId")
      .eq("pmReviewId", excludePMReviewId);
    for (const l of alreadyLinked ?? []) {
      transcriptMap.delete(l.transcriptRefId);
    }
  }

  const transcripts = Array.from(transcriptMap.values()).sort((a, b) => {
    const da = a.capturedAt ?? "";
    const db_ = b.capturedAt ?? "";
    return db_.localeCompare(da);
  });

  // ─── 2. Meetings do projeto com material utilizável ─────────────────────
  const { data: meetingLinks } = await supabase
    .from("MeetingProjectLink")
    .select(
      'meetingId, meeting:Meeting(id, title, date, notes, transcriptRefs:TranscriptRef!TranscriptRef_meetingId_fkey(id, "fullText"))',
    )
    .eq("projectId", projectId);

  type MeetingShape = {
    id: string;
    title: string | null;
    date: string;
    notes: string | null;
    transcriptRefs: Array<{ id: string; fullText: string | null }> | null;
  };

  const meetings: PoolMeeting[] = [];
  for (const link of meetingLinks ?? []) {
    const m = link.meeting as MeetingShape | null;
    if (!m) continue;
    const hasTranscript =
      (m.transcriptRefs ?? []).some(
        (t) => t.fullText && t.fullText.length > 0,
      ) ?? false;
    const notesLen = (m.notes ?? "").trim().length;
    // Filtro: tem transcript OU notes ≥50 chars.
    if (!hasTranscript && notesLen < 50) continue;
    meetings.push({
      meetingId: m.id,
      title: m.title,
      date: m.date,
      hasTranscript,
      notesPreview: m.notes ? m.notes.slice(0, 200) : null,
    });
  }

  // Remove meetings JÁ linkadas ao PM Review corrente.
  if (excludePMReviewId) {
    const { data: alreadyLinked } = await supabase
      .from("PMReviewMeetingLink")
      .select("meetingId")
      .eq("pmReviewId", excludePMReviewId);
    const seen = new Set(
      (alreadyLinked ?? []).map((l) => l.meetingId as string),
    );
    for (let i = meetings.length - 1; i >= 0; i--) {
      if (seen.has(meetings[i].meetingId)) meetings.splice(i, 1);
    }
  }

  meetings.sort((a, b) => b.date.localeCompare(a.date));

  return NextResponse.json({ transcripts, meetings });
}
