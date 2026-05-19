import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getCurrentMember,
  requireSessionAccessApi,
  requireSessionEditApi,
} from "@/lib/dal";
import { getMemberRoamClient } from "@/lib/member-integrations";
import { cuesToText } from "@/lib/roam";
import type { Database } from "@/lib/supabase/database.types";

type TranscriptInsert =
  Database["public"]["Tables"]["DesignSessionTranscript"]["Insert"];

/**
 * GET /api/design-sessions/[id]/roam-transcripts
 *
 * Lists Roam transcripts available for import (last 30 from the caller's
 * Roam workspace) plus the ones already imported into this session.
 *
 * Returns:
 *  - needsAuth: caller has no Roam token connected
 *  - available: items the caller can pick to import (alreadyImported flag set
 *    when one matches an existing row)
 *  - imported: rows already attached to the session (newest meeting first)
 *  - error: present when the Roam call failed (e.g. token revoked) — UI
 *    should treat the same as needsAuth and offer reconnect
 */
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

  const [client, importedRes] = await Promise.all([
    getMemberRoamClient(member.id),
    db()
      .from("DesignSessionTranscript")
      .select(
        "id, source, sourceId, meetingTitle, meetingStart, meetingEnd, participants, summary, actionItems, importedAt, importedByMemberId",
      )
      .eq("sessionId", sessionId)
      .eq("source", "roam")
      .order("meetingStart", { ascending: false }),
  ]);

  // Reshape to the legacy {roamTranscriptId} contract so the old modal keeps working.
  const imported = (importedRes.data ?? []).map((r) => ({
    ...r,
    roamTranscriptId: r.sourceId,
  }));

  if (!client) {
    return NextResponse.json({
      needsAuth: true,
      available: [],
      imported,
    });
  }

  try {
    const available = await client.listTranscriptsInRange({ max: 30 });
    const importedRoamIds = new Set(imported.map((t) => t.sourceId));
    return NextResponse.json({
      needsAuth: false,
      available: available.map((t) => ({
        ...t,
        alreadyImported: importedRoamIds.has(t.id),
      })),
      imported,
    });
  } catch (err) {
    const msg = (err as Error).message || "";
    return NextResponse.json({
      needsAuth: false,
      available: [],
      imported,
      error: msg.includes("401") || msg.includes("403")
        ? "Token Roam invalido ou expirado — reconecte em /settings/integrations."
        : `Falha ao listar reunioes do Roam: ${msg}`,
    });
  }
}

/**
 * POST /api/design-sessions/[id]/roam-transcripts
 * Body: { roamTranscriptId: string }
 *
 * Fetches the full transcript from Roam, formats cues into a readable
 * `[HH:MM] Speaker: text` block, and persists everything.
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
    | { roamTranscriptId?: string }
    | null;
  const roamTranscriptId = body?.roamTranscriptId?.trim();
  if (!roamTranscriptId) {
    return NextResponse.json(
      { error: "roamTranscriptId obrigatorio" },
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

  const client = await getMemberRoamClient(member.id);
  if (!client) {
    return NextResponse.json(
      { error: "Conecte sua conta Roam em /settings/integrations primeiro." },
      { status: 400 },
    );
  }

  let detail;
  try {
    detail = await client.getTranscript(roamTranscriptId);
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("404")) {
      return NextResponse.json({ error: "Reuniao nao encontrada no Roam." }, { status: 404 });
    }
    if (msg.includes("401") || msg.includes("403")) {
      return NextResponse.json(
        { error: "Token Roam invalido — reconecte em /settings/integrations." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: `Falha ao buscar transcricao: ${msg}` },
      { status: 502 },
    );
  }

  const meetingTitle =
    detail.eventName?.trim() ||
    `Reuniao ${new Date(detail.start).toLocaleString("pt-BR")}`;

  const insertRow: TranscriptInsert = {
    sessionId,
    projectId: session.projectId,
    source: "roam",
    sourceId: roamTranscriptId,
    meetingTitle,
    meetingStart: detail.start,
    meetingEnd: detail.end,
    participants: detail.participants as unknown as TranscriptInsert["participants"],
    summary: detail.summary ?? null,
    actionItems: (detail.actionItems ?? []) as unknown as TranscriptInsert["actionItems"],
    fullText: cuesToText(detail.cues),
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
        { error: "Essa reuniao ja foi importada nesta sessao." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json(inserted);
}
