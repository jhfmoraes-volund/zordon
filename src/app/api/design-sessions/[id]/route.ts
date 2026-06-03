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

  // Deletar a session cascateia os PRDs vinculados (FK designSessionId ON DELETE
  // CASCADE). O único bloqueio é o vínculo com a FORGE: se algum projeto usa esta
  // session como fonte de PRDs (Project.forgeSourceSessionId), descarregue na tab
  // Forge antes de deletar — senão a Forja perderia a fonte silenciosamente.
  const { count: forgeRefCount, error: forgeErr } = await db()
    .from("Project")
    .select("id", { count: "exact", head: true })
    .eq("forgeSourceSessionId", id);
  if (forgeErr)
    return NextResponse.json({ error: forgeErr.message }, { status: 500 });
  if ((forgeRefCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Esta sessão está carregada na Forja de um projeto e não pode ser deletada. Descarregue-a na tab Forge antes.",
        code: "session_is_forge_source",
        projectCount: forgeRefCount,
      },
      { status: 409 },
    );
  }

  const { error } = await db().from("DesignSession").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
