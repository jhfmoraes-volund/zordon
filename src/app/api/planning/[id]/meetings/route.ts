/**
 * Link/unlink de Meeting numa PlanningCeremony — curadoria manual do PM.
 *
 * POST   body  { meetingId, note? }       → link
 * DELETE query ?meetingId=…               → unlink
 *
 * Auth: caller precisa ter acesso ao projeto da planning.
 * RLS na tabela exige ADICIONALMENTE `can_view_meeting` pra SELECT do link —
 * service_role bypassa, mas o caller já passou pela checagem de projeto e
 * o Meeting tem visibility própria; integridade de quem pode "ver depois"
 * é responsabilidade da RLS (cliente lê via JWT real).
 */
import { NextRequest, NextResponse } from "next/server";
import { getActorMemberId, requireProjectViewApi } from "@/lib/dal";
import {
  getPlanningById,
  linkMeetingToPlanning,
  unlinkMeetingFromPlanning,
} from "@/lib/dal/planning";

async function loadAndAuthorize(id: string) {
  const planning = await getPlanningById(id);
  if (!planning) {
    return {
      denied: NextResponse.json({ error: "Planning não encontrada" }, { status: 404 }),
    };
  }
  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return { denied };
  return { planning };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { denied } = await loadAndAuthorize(id);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | { meetingId?: string; note?: string | null }
    | null;
  if (!body?.meetingId) {
    return NextResponse.json({ error: "meetingId obrigatório" }, { status: 400 });
  }

  const linkedById = await getActorMemberId();
  if (!linkedById) {
    return NextResponse.json({ error: "sem memberId no contexto" }, { status: 401 });
  }

  try {
    const link = await linkMeetingToPlanning({
      planningCeremonyId: id,
      meetingId: body.meetingId,
      linkedById,
      note: body.note ?? null,
    });
    return NextResponse.json(link, { status: 201 });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("duplicate key") || msg.includes("23505")) {
      return NextResponse.json({ error: "meeting já linkada" }, { status: 409 });
    }
    return NextResponse.json({ error: "Falha ao linkar meeting", detail: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { denied } = await loadAndAuthorize(id);
  if (denied) return denied;

  const meetingId = req.nextUrl.searchParams.get("meetingId");
  if (!meetingId) {
    return NextResponse.json({ error: "meetingId obrigatório" }, { status: 400 });
  }

  await unlinkMeetingFromPlanning(id, meetingId);
  return NextResponse.json({ ok: true });
}
