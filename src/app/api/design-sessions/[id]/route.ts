import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi, requireSessionEditApi } from "@/lib/dal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;
  const { data: session } = await db()
    .from("DesignSession")
    .select(`
      *,
      project:Project!DesignSession_projectId_fkey(name, client:Client(name)),
      participants:DesignSessionParticipant(*, member:Member(name)),
      stepData:DesignSessionStepData(*),
      items:DesignSessionItem(*)
    `)
    .eq("id", id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Sort items by orderIndex
  const sessionWithItems = session as { items?: { orderIndex: number }[] };
  if (sessionWithItems.items) {
    sessionWithItems.items.sort((a, b) => a.orderIndex - b.orderIndex);
  }

  return NextResponse.json(session);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;
  const body = await req.json();
  const { data: session, error } = await db()
    .from("DesignSession")
    .update(body)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(session);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  // PRDs são artefatos da sessão e são a única casa de spec deles (além de poderem
  // ter ForgeRun referenciando). Deletar a sessão os orfanaria. Sessão com PRD só
  // pode ser arquivada (PUT { archivedAt }), nunca deletada.
  const { count: prdCount, error: countErr } = await db()
    .from("ProductRequirement")
    .select("id", { count: "exact", head: true })
    .eq("designSessionId", id)
    .is("dismissedAt", null);
  if (countErr)
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  if ((prdCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Esta sessão tem PRDs vinculados e não pode ser deletada. Arquive-a em vez disso.",
        code: "session_has_prds",
        prdCount,
      },
      { status: 409 },
    );
  }

  const { error } = await db().from("DesignSession").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
