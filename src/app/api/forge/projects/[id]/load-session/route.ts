import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { setForgeSourceSession } from "@/lib/dal/forge-project";

export const dynamic = "force-dynamic";

const Body = z.object({
  designSessionId: z.string().uuid().nullable(),
});

/**
 * POST /api/forge/projects/[id]/load-session
 *
 * Marca uma DesignSession como source da Forja pra este projeto, ou unlinka
 * passando `designSessionId: null`. Valida que a session pertence ao projeto e
 * é tipo `prd_session` (regra de negócio: Inception não vai pra Forja direto;
 * passa pela PRD Session primeiro).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const denied = await requireCapabilityApi("forge.operate");
  if (denied) return denied;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    await setForgeSourceSession({
      projectId,
      designSessionId: parsed.data.designSessionId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
