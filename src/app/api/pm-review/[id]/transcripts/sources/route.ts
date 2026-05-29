/**
 * GET  /api/pm-review/[id]/transcripts/sources
 *   Lista reuniões importáveis do Roam/Granola, marcando as já linkadas.
 *
 * POST /api/pm-review/[id]/transcripts/sources
 *   Cria/reusa TranscriptRef (SSOT) e linka ao PM Review.
 *   Body: { source: "roam"|"granola", sourceId: string }
 *
 * Espelha /api/planning/[id]/transcripts/sources.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember, requireProjectViewApi } from "@/lib/dal";
import { getMemberIntegrationToken } from "@/lib/member-integrations";
import { getMeetingDetail, type MeetingSource } from "@/lib/meetings";
import { buildGranolaClient } from "@/lib/granola";
import { upsertTranscriptRef } from "@/lib/transcripts/upsert";
import { linkTranscriptToPMReview } from "@/lib/dal/pm-review";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";

interface SourceSlice {
  needsAuth: boolean;
  available: ImportableMeeting[];
  error?: string;
}

interface ImportableMeeting {
  source: MeetingSource;
  id: string;
  title: string;
  start: string;
  end?: string;
  durationMinutes?: number;
  participants: { name: string; email?: string }[];
  alreadyImported: boolean;
}

async function loadProject(pmReviewId: string) {
  const { data } = await db()
    .from("PMReview")
    .select("projectId")
    .eq("id", pmReviewId)
    .maybeSingle();
  return (data?.projectId as string | undefined) ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: pmReviewId } = await params;

  const projectId = await loadProject(pmReviewId);
  if (!projectId)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });

  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member)
    return NextResponse.json({ error: "Member not found" }, { status: 403 });

  const [roamToken, granolaToken, linkedRes] = await Promise.all([
    getMemberIntegrationToken(member.id, "roam"),
    getMemberIntegrationToken(member.id, "granola"),
    db()
      .from("PMReviewTranscriptLink")
      .select('"transcriptRefId", transcript:TranscriptRef("sourceId", source)')
      .eq("pmReviewId", pmReviewId),
  ]);

  const importedSet = new Set<string>();
  for (const link of linkedRes.data ?? []) {
    const t = link.transcript as { sourceId: string; source: string } | null;
    if (t) importedSet.add(`${t.source}::${t.sourceId}`);
  }

  const [roamSlice, granolaSlice] = await Promise.all([
    loadRoamSlice(roamToken, importedSet),
    loadGranolaSlice(granolaToken, importedSet),
  ]);

  return NextResponse.json({
    sources: { roam: roamSlice, granola: granolaSlice },
    imported: [],
  });
}

async function loadRoamSlice(
  token: string | null,
  importedSet: Set<string>,
): Promise<SourceSlice> {
  if (!token) return { needsAuth: true, available: [] };
  const { RoamClient } = await import("@/lib/roam");
  try {
    const client = new RoamClient(token);
    const transcripts = await client.listTranscriptsInRange({ max: 30 });
    return {
      needsAuth: false,
      available: transcripts.map((t) => ({
        source: "roam" as const,
        id: t.id,
        title: t.eventName?.trim() || "Sem título",
        start: t.start,
        end: t.end,
        durationMinutes: Math.max(
          1,
          Math.round(
            (new Date(t.end).getTime() - new Date(t.start).getTime()) / 60000,
          ),
        ),
        participants: t.participants.map((p) => ({ name: p.name, email: p.email })),
        alreadyImported: importedSet.has(`roam::${t.id}`),
      })),
    };
  } catch (err) {
    const msg = (err as Error).message || "";
    return {
      needsAuth: false,
      available: [],
      error:
        msg.includes("401") || msg.includes("403")
          ? "Token Roam inválido ou expirado — reconecte em /settings/integrations."
          : `Falha ao listar reuniões do Roam: ${msg}`,
    };
  }
}

async function loadGranolaSlice(
  token: string | null,
  importedSet: Set<string>,
): Promise<SourceSlice> {
  const client = buildGranolaClient(token);
  if (!client) return { needsAuth: true, available: [] };
  try {
    const notes = await client.listNotesInRange({ max: 30 });
    return {
      needsAuth: false,
      available: notes.map((n) => ({
        source: "granola" as const,
        id: n.id,
        title: n.title?.trim() || "Sem título",
        start: n.created_at,
        participants: [],
        alreadyImported: importedSet.has(`granola::${n.id}`),
      })),
    };
  } catch (err) {
    const msg = (err as Error).message || "";
    return {
      needsAuth: false,
      available: [],
      error:
        msg.includes("401") || msg.includes("403")
          ? "Chave Granola inválida — peça ao admin para revisar."
          : `Falha ao listar reuniões do Granola: ${msg}`,
    };
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: pmReviewId } = await params;

  const projectId = await loadProject(pmReviewId);
  if (!projectId)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });

  const allowed = await canCreatePMReviewForProject(projectId);
  if (!allowed)
    return NextResponse.json(
      { error: "Apenas PMs (lead) ou admins podem editar." },
      { status: 403 },
    );

  const member = await getCurrentMember();
  if (!member)
    return NextResponse.json({ error: "Member not found" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { source?: string; sourceId?: string }
    | null;
  const source = body?.source?.trim() as MeetingSource | undefined;
  const sourceId = body?.sourceId?.trim();
  if (!source || !sourceId || (source !== "roam" && source !== "granola")) {
    return NextResponse.json(
      { error: "source ('roam'|'granola') e sourceId obrigatórios" },
      { status: 400 },
    );
  }

  const roamToken =
    source === "roam" ? await getMemberIntegrationToken(member.id, "roam") : null;
  const granolaToken =
    source === "granola"
      ? await getMemberIntegrationToken(member.id, "granola")
      : null;
  if (source === "roam" && !roamToken)
    return NextResponse.json(
      { error: "Conecte sua conta Roam em /settings/integrations primeiro." },
      { status: 400 },
    );
  if (source === "granola" && !granolaToken)
    return NextResponse.json(
      { error: "Conecte sua conta Granola em /settings/integrations primeiro." },
      { status: 400 },
    );

  let detail;
  try {
    detail = await getMeetingDetail({ roamToken, granolaToken }, source, sourceId);
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("404"))
      return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });
    if (msg.includes("401") || msg.includes("403"))
      return NextResponse.json(
        { error: `Credencial ${source} inválida — revise as integrações.` },
        { status: 400 },
      );
    return NextResponse.json(
      { error: `Falha ao buscar transcrição: ${msg}` },
      { status: 502 },
    );
  }

  const title =
    detail.title?.trim() ||
    `Reunião ${new Date(detail.start).toLocaleString("pt-BR")}`;

  try {
    const refId = await upsertTranscriptRef(db(), {
      source,
      sourceId,
      title,
      fullText: detail.transcriptText,
      capturedAt: detail.start,
      importedById: member.id,
    });

    await linkTranscriptToPMReview({
      pmReviewId,
      transcriptRefId: refId,
      linkedById: member.id,
      weight: "primary",
    });

    return NextResponse.json(
      { id: refId, source, sourceId, meetingTitle: title },
      { status: 201 },
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes("duplicate key") || msg.includes("23505"))
      return NextResponse.json(
        { error: "transcript já linkado a este PM Review" },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "Falha ao importar transcrição", detail: msg },
      { status: 500 },
    );
  }
}
