import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/dal";
import { disconnect } from "@/lib/composio/client";

/**
 * POST /api/integrations/composio/disconnect
 *   Body: { toolkit: "github" }
 *   Apaga a conexão do member com o toolkit (idempotente).
 */
export async function POST(req: Request) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { toolkit?: string };
  try {
    body = (await req.json()) as { toolkit?: string };
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (body.toolkit !== "github") {
    return NextResponse.json(
      { error: "Toolkit não suportado. Suportados: github" },
      { status: 400 },
    );
  }

  const result = await disconnect(member.id, body.toolkit);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
