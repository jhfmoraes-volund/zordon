import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getCurrentMember,
  requireSessionAccessApi,
  requireSessionEditApi,
} from "@/lib/dal";
import { getMemberIntegrationToken } from "@/lib/member-integrations";
import { getMeetingDetail, type MeetingSource } from "@/lib/meetings";
import { buildGranolaClient } from "@/lib/granola";
import { upsertTranscriptRef } from "@/lib/transcripts/upsert";
import {
  linkTranscriptToSession,
  listSessionTranscripts,
} from "@/lib/dal/design-session-transcripts";

/**
 * GET /api/design-sessions/[id]/transcripts
 *
 * Lists every importable meeting (Roam + Granola) for this session plus the
 * transcripts already attached. Após Fundação B (2026-05-29) os imported items
 * vêm via `DesignSessionTranscriptLink` joined a `TranscriptRef` (SSOT).
 *
 * Response shape:
 *   {
 *     sources: { roam: SourceSlice; granola: SourceSlice },
 *     imported: ImportedTranscript[],
 *   }
 */
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

  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  const [roamToken, granolaToken, importedRich] = await Promise.all([
    getMemberIntegrationToken(member.id, "roam"),
    getMemberIntegrationToken(member.id, "granola"),
    listSessionTranscripts(db(), sessionId),
  ]);

  // Forma leve enviada ao client. Inclui meetingStart + summary porque
  // pre-work-step renderiza chips com título + data + summary no hover.
  const imported = importedRich.map((t) => ({
    id: t.id,
    source: t.source,
    sourceId: t.sourceId,
    meetingTitle: t.meetingTitle,
    meetingStart: t.meetingStart,
    summary: t.summary,
  }));

  const importedKey = (source: string, id: string) => `${source}::${id}`;
  const importedSet = new Set(
    importedRich
      .filter((t) => t.sourceId !== null)
      .map((t) => importedKey(t.source, t.sourceId as string)),
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

/**
 * POST /api/design-sessions/[id]/transcripts
 * Body: { source: "roam" | "granola", sourceId: string }
 *
 * Fluxo (pós Fundação B):
 *   1) Busca metadata + texto na API do provider.
 *   2) Upsert idempotente em TranscriptRef (SSOT). Re-import do mesmo
 *      Roam/Granola em DS+Planning aponta pra MESMA row física.
 *   3) Cria link `DesignSessionTranscriptLink`. Idempotente.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const denied = await requireSessionEditApi(sessionId);
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

  const { data: session } = await db()
    .from("DesignSession")
    .select("projectId")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const roamToken = source === "roam" ? await getMemberIntegrationToken(member.id, "roam") : null;
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
    detail.title?.trim() ||
    `Reunião ${new Date(detail.start).toLocaleString("pt-BR")}`;

  // 1) Upsert TranscriptRef (SSOT). Idempotente por (source, sourceId).
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
    // Patch dos campos novos (endedAt + participants + summary + actionItems)
    // — upsertTranscriptRef cuida do core, mas não conhece os 4 extras de DS.
    await db()
      .from("TranscriptRef")
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

  // 2) Linka à sessão (idempotente).
  let linkId: string;
  try {
    const link = await linkTranscriptToSession(db(), {
      sessionId,
      transcriptRefId,
      linkedById: member.id,
      weight: "primary",
    });
    if (!link.created) {
      return NextResponse.json(
        { error: "Essa reunião já foi importada nesta sessão." },
        { status: 409 },
      );
    }
    linkId = link.id;
  } catch (err) {
    return NextResponse.json(
      { error: `Falha ao linkar transcript à sessão: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  // Forma leve no retorno (mesma que GET imported[]).
  return NextResponse.json({
    id: linkId,
    source,
    sourceId,
    meetingTitle,
    meetingStart: detail.start,
    summary: detail.summary ?? null,
  });
}
