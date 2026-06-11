import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/dal";
import { disconnect, type ComposioToolkit } from "@/lib/composio/client";

const SUPPORTED_TOOLKITS: ComposioToolkit[] = ["github", "googlesheets", "googledrive"];

/**
 * POST /api/integrations/composio/disconnect
 *   Body: { toolkit: "github" | "googlesheets" | "googledrive" }
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

  const toolkit = body.toolkit as ComposioToolkit | undefined;
  if (!toolkit || !SUPPORTED_TOOLKITS.includes(toolkit)) {
    return NextResponse.json(
      { error: `Toolkit não suportado. Suportados: ${SUPPORTED_TOOLKITS.join(", ")}` },
      { status: 400 },
    );
  }

  const result = await disconnect(member.id, toolkit);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
