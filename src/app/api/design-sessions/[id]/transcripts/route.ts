import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getCurrentMember,
  requireSessionAccessApi,
  requireSessionEditApi,
} from "@/lib/dal";
import { getMemberIntegrationToken } from "@/lib/member-integrations";
import { getMeetingDetail, type MeetingSource } from "@/lib/meetings";
import { getGranolaClient } from "@/lib/granola";
import type { Database } from "@/lib/supabase/database.types";

type TranscriptRow =
  Database["public"]["Tables"]["DesignSessionTranscript"]["Row"];
type TranscriptInsert =
  Database["public"]["Tables"]["DesignSessionTranscript"]["Insert"];

/**
 * GET /api/design-sessions/[id]/transcripts
 *
 * Lists every importable meeting (Roam + Granola) for this session plus the
 * transcripts already attached. Replaces the legacy /roam-transcripts route
 * which only knew about Roam.
 *
 * Response shape:
 *   {
 *     sources: { roam: SourceSlice; granola: SourceSlice },
 *     imported: TranscriptRow[],
 *   }
 *
 * Each SourceSlice mirrors the importable-meetings contract, with
 * `alreadyImported` precomputed against the imported set for the UI.
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

  const [roamToken, importedRes] = await Promise.all([
    getMemberIntegrationToken(member.id, "roam"),
    db()
      .from("DesignSessionTranscript")
      .select(
        "id, source, sourceId, meetingTitle, meetingStart, meetingEnd, participants, summary, actionItems, importedAt, importedByMemberId",
      )
      .eq("sessionId", sessionId)
      .order("meetingStart", { ascending: false }),
  ]);

  const imported = (importedRes.data ?? []) as Pick<
    TranscriptRow,
    | "id"
    | "source"
    | "sourceId"
    | "meetingTitle"
    | "meetingStart"
    | "meetingEnd"
    | "participants"
    | "summary"
    | "actionItems"
    | "importedAt"
    | "importedByMemberId"
  >[];

  const importedKey = (source: string, id: string) => `${source}::${id}`;
  const importedSet = new Set(imported.map((t) => importedKey(t.source, t.sourceId)));

  const [roamSlice, granolaSlice] = await Promise.all([
    loadRoamSlice(roamToken, importedSet),
    loadGranolaSlice(importedSet),
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

async function loadGranolaSlice(importedSet: Set<string>): Promise<SourceSlice> {
  const client = getGranolaClient();
  if (!client) return { needsAuth: true, available: [] };

  try {
    const notes = await client.listNotesInRange({ max: 30 });
    // No participant enrichment here — the DS list view is OK with owner-only.
    // The detail comes through on import (POST).
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
  if (source === "roam" && !roamToken) {
    return NextResponse.json(
      { error: "Conecte sua conta Roam em /settings/integrations primeiro." },
      { status: 400 },
    );
  }
  if (source === "granola" && !getGranolaClient()) {
    return NextResponse.json(
      { error: "Granola não está configurado neste workspace." },
      { status: 400 },
    );
  }

  let detail;
  try {
    detail = await getMeetingDetail({ roamToken }, source, sourceId);
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

  const insertRow: TranscriptInsert = {
    sessionId,
    projectId: session.projectId,
    source,
    sourceId,
    meetingTitle,
    meetingStart: detail.start,
    meetingEnd: detail.end ?? detail.start,
    participants: detail.participants as unknown as TranscriptInsert["participants"],
    summary: detail.summary ?? null,
    actionItems: detail.actionItems as unknown as TranscriptInsert["actionItems"],
    fullText: detail.transcriptText,
    importedByMemberId: member.id,
  };

  const { data: inserted, error: insertErr } = await db()
    .from("DesignSessionTranscript")
    .insert(insertRow)
    .select()
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json(
        { error: "Essa reunião já foi importada nesta sessão." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json(inserted);
}
