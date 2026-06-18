// Freshness de uma folder vinculada (runbook ritual-playbook-consolidation, A2).
//   GET /api/projects/[id]/granola-folders/[bindingId]/freshness
// Mostra se há nota do Granola pra a semana atual do PM Review — substitui a
// promessa genérica do banner por estado real. Usa o token do MEMBER dono do
// binding (é quem enxerga a folder), não o do caller.

import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { getMemberGranolaClient } from "@/lib/member-integrations";
import { createAdminClient } from "@/lib/supabase/admin";

export interface FolderFreshness {
  state: "fresh" | "stale" | "orphan" | "error";
  weekCount: number;
  hasMore: boolean;
  lastNoteAt: string | null;
  lastNoteTitle: string | null;
  error?: string;
}

/** Início (ISO) da semana atual em BRT (segunda 00:00 -03:00). Mesmo eixo do cron. */
function brtWeekStartISO(now: Date): string {
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const dow = brt.getUTCDay();
  brt.setUTCDate(brt.getUTCDate() - ((dow + 6) % 7));
  const ymd = brt.toISOString().slice(0, 10);
  return new Date(`${ymd}T00:00:00-03:00`).toISOString();
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; bindingId: string }> },
) {
  const { id: projectId, bindingId } = await params;
  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;

  const admin = createAdminClient();
  const { data: binding } = await admin
    .from("ProjectGranolaFolder")
    .select('"folderId", "memberId"')
    .eq("id", bindingId)
    .eq("projectId", projectId)
    .maybeSingle();

  if (!binding) {
    return NextResponse.json({ error: "binding_not_found" }, { status: 404 });
  }
  if (!binding.memberId) {
    return NextResponse.json({
      state: "orphan",
      weekCount: 0,
      hasMore: false,
      lastNoteAt: null,
      lastNoteTitle: null,
    } satisfies FolderFreshness);
  }

  const client = await getMemberGranolaClient(binding.memberId as string);
  if (!client) {
    return NextResponse.json({
      state: "orphan",
      weekCount: 0,
      hasMore: false,
      lastNoteAt: null,
      lastNoteTitle: null,
    } satisfies FolderFreshness);
  }

  try {
    const res = await client.listNotes({
      folderId: binding.folderId as string,
      createdAfter: brtWeekStartISO(new Date()),
      limit: 50,
    });
    const notes = res.notes;
    const newest = notes[0] ?? null;
    return NextResponse.json({
      state: notes.length > 0 ? "fresh" : "stale",
      weekCount: notes.length,
      hasMore: res.hasMore,
      lastNoteAt: newest?.created_at ?? null,
      lastNoteTitle: newest?.title ?? null,
    } satisfies FolderFreshness);
  } catch (err) {
    const msg = (err as Error).message || "";
    return NextResponse.json({
      state: "error",
      weekCount: 0,
      hasMore: false,
      lastNoteAt: null,
      lastNoteTitle: null,
      error:
        msg.includes("401") || msg.includes("403")
          ? "Token Granola inválido/expirado."
          : `Falha ao consultar a folder: ${msg}`,
    } satisfies FolderFreshness);
  }
}
