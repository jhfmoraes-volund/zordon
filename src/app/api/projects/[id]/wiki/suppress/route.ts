import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUser, getActorMemberId, canEditTasks } from "@/lib/dal";
import { parseSuppressed, type SuppressedEntry } from "@/lib/wiki/suppressed";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Suppress de bullet (PRD D2) — única edição humana da Wiki.
 *   POST   { sectionKey, bulletHash } → adiciona entry (idempotente)
 *   DELETE { sectionKey, bulletHash } → remove entry
 * Service role escreve (REVOKE em authenticated); auth de edição no Next.
 */

const BodySchema = z.object({
  sectionKey: z.string().min(1),
  bulletHash: z.string().min(1),
});

async function authAndParse(
  req: NextRequest,
  params: Promise<{ id: string }>
): Promise<
  | { ok: true; projectId: string; memberId: string; body: z.infer<typeof BodySchema> }
  | { ok: false; res: NextResponse }
> {
  const user = await getUser();
  if (!user) {
    return { ok: false, res: new NextResponse("Unauthorized", { status: 401 }) };
  }

  const { id } = await params;
  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    return {
      ok: false,
      res: NextResponse.json({ error: "Invalid project id" }, { status: 400 }),
    };
  }

  if (!(await canEditTasks(idParsed.data))) {
    return { ok: false, res: new NextResponse("Forbidden", { status: 403 }) };
  }

  const memberId = await getActorMemberId();
  if (!memberId) {
    return { ok: false, res: new NextResponse("Unauthorized", { status: 401 }) };
  }

  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Invalid body", details: body.error.format() },
        { status: 400 }
      ),
    };
  }

  return { ok: true, projectId: idParsed.data, memberId, body: body.data };
}

async function loadSection(projectId: string, sectionKey: string) {
  return db()
    .from("ProjectWikiSection")
    .select("id, suppressed")
    .eq("projectId", projectId)
    .eq("sectionKey", sectionKey)
    .maybeSingle();
}

async function saveSuppressed(sectionId: string, suppressed: SuppressedEntry[]) {
  return db()
    .from("ProjectWikiSection")
    .update({
      suppressed: suppressed as unknown as Json,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", sectionId);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authAndParse(req, params);
  if (!auth.ok) return auth.res;

  const { data: section, error } = await loadSection(
    auth.projectId,
    auth.body.sectionKey
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!section) {
    return NextResponse.json({ error: "Seção não encontrada" }, { status: 404 });
  }

  const suppressed = parseSuppressed(section.suppressed);
  // Idempotente: mesmo bulletHash não duplica.
  if (!suppressed.some((s) => s.bulletHash === auth.body.bulletHash)) {
    suppressed.push({
      bulletHash: auth.body.bulletHash,
      suppressedBy: auth.memberId,
      suppressedAt: new Date().toISOString(),
    });
    const { error: updateError } = await saveSuppressed(section.id, suppressed);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, suppressed });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authAndParse(req, params);
  if (!auth.ok) return auth.res;

  const { data: section, error } = await loadSection(
    auth.projectId,
    auth.body.sectionKey
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!section) {
    return NextResponse.json({ error: "Seção não encontrada" }, { status: 404 });
  }

  const suppressed = parseSuppressed(section.suppressed).filter(
    (s) => s.bulletHash !== auth.body.bulletHash
  );
  const { error: updateError } = await saveSuppressed(section.id, suppressed);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, suppressed });
}
