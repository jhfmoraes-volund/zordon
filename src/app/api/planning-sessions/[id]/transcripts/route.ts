/**
 * GET  /api/planning-sessions/[id]/transcripts
 *   Lista reuniões importáveis (Roam + Granola) + as já linkadas ao release planning.
 *
 * POST /api/planning-sessions/[id]/transcripts
 *   Body: { source: "roam"|"granola", sourceId: string }
 *   Upsert idempotente em ContextSource (SSOT) + link via EntityLink.planningSessionId.
 *
 * Espelha /api/design-sessions/[id]/transcripts, trocando o host pra planningSessionId.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getCurrentMember,
  requireProjectViewApi,
  requireProjectEditSessionsApi,
} from "@/lib/dal";
import { getMemberIntegrationToken } from "@/lib/member-integrations";
import { getMeetingDetail, type MeetingSource } from "@/lib/meetings";
import { buildGranolaClient } from "@/lib/granola";
import { upsertTranscriptRef } from "@/lib/transcripts/upsert";
import { getSession, linkContextSource } from "@/lib/dal/planning-session";

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(session.projectId);
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  const [roamToken, granolaToken, linkedRes] = await Promise.all([
    getMemberIntegrationToken(member.id, "roam"),
    getMemberIntegrationToken(member.id, "granola"),
    db()
      .from("EntityLink")
      .select(
        `contextSourceId,
         transcript:ContextSource!EntityLink_contextSourceId_fkey(id, source, "sourceId", title, "capturedAt", summary)`,
      )
      .eq("planningSessionId", sessionId)
      .not("contextSourceId", "is", null),
  ]);

  const importedRich = (linkedRes.data ?? [])
    .map((l) => l.transcript as
      | { id: string; source: string; sourceId: string | null; title: string | null; capturedAt: string | null; summary: string | null }
      | null)
    .filter((t): t is NonNullable<typeof t> => !!t && !!t.source && !!t.sourceId);

  const imported = importedRich.map((t) => ({
    id: t.id,
    source: t.source,
    sourceId: t.sourceId,
    meetingTitle: t.title,
    meetingStart: t.capturedAt,
    summary: t.summary,
  }));

  const importedSet = new Set(
    importedRich.map((t) => `${t.source}::${t.sourceId}`),
  );

  const [roamSlice, granolaSlice] = await Promise.all([
    loadRoamSlice(roamToken, importedSet),
    loadGranolaSlice(granolaToken, importedSet),
  ]);

  return NextResponse.json({
    sources: { roam: roamSlice, granola: granolaSlice },
    imported,
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
          Math.round((new Date(t.end).getTime() - new Date(t.start).getTime()) / 60000),
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
  const { id: sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requireProjectEditSessionsApi(session.projectId);
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

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
    source === "granola" ? await getMemberIntegrationToken(member.id, "granola") : null;
  if (source === "roam" && !roamToken) {
    return NextResponse.json(
      { error: "Conecte sua conta Roam em /settings/integrations primeiro." },
      { status: 400 },
    );
  }
  if (source === "granola" && !granolaToken) {
    return NextResponse.json(
      { error: "Conecte sua conta Granola em /settings/integrations primeiro." },
      { status: 400 },
    );
  }

  let detail;
  try {
    detail = await getMeetingDetail({ roamToken, granolaToken }, source, sourceId);
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("404")) {
      return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });
    }
    if (msg.includes("401") || msg.includes("403")) {
      return NextResponse.json(
        { error: `Credencial ${source} inválida — revise as integrações.` },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: `Falha ao buscar transcrição: ${msg}` },
      { status: 502 },
    );
  }

  const meetingTitle =
    detail.title?.trim() || `Reunião ${new Date(detail.start).toLocaleString("pt-BR")}`;

  // 1) Upsert ContextSource (SSOT). Idempotente por (source, sourceId).
  let transcriptRefId: string;
  try {
    transcriptRefId = await upsertTranscriptRef(db(), {
      source,
      sourceId,
      title: meetingTitle,
      fullText: detail.transcriptText,
      capturedAt: detail.start,
      importedById: member.id,
    });
    await db()
      .from("ContextSource")
      .update({
        endedAt: detail.end ?? detail.start,
        participants: detail.participants as unknown as never,
        summary: detail.summary ?? null,
        actionItems: detail.actionItems as unknown as never,
      })
      .eq("id", transcriptRefId);
  } catch (err) {
    return NextResponse.json(
      { error: `Falha ao salvar transcript: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  // 2) Linka ao release planning (idempotente — checa antes).
  const { data: existing } = await db()
    .from("EntityLink")
    .select("id")
    .eq("planningSessionId", sessionId)
    .eq("contextSourceId", transcriptRefId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "Essa reunião já foi importada neste release planning." },
      { status: 409 },
    );
  }

  let linkId: string;
  try {
    const link = await linkContextSource(sessionId, transcriptRefId, member.id);
    linkId = link.id;
  } catch (err) {
    return NextResponse.json(
      { error: `Falha ao linkar transcript: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: linkId,
    source,
    sourceId,
    meetingTitle,
    meetingStart: detail.start,
    summary: detail.summary ?? null,
  });
}
