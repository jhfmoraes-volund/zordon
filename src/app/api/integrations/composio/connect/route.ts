import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/dal";
import { initiateConnection, type ComposioToolkit } from "@/lib/composio/client";

const SUPPORTED_TOOLKITS: ComposioToolkit[] = ["github", "googlesheets", "googledrive"];

/**
 * POST /api/integrations/composio/connect
 *   Body: { toolkit: "github" | "googlesheets" | "googledrive", returnTo?: string }
 *   Inicia a conexão OAuth via Composio e devolve { redirectUrl } pro
 *   frontend redirecionar o usuário.
 *
 *   userId no Composio = Member.id (1 conexão por membro por toolkit).
 *   callbackUrl = APP_URL + returnTo (default /settings).
 */
export async function POST(req: Request) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { toolkit?: string; returnTo?: string };
  try {
    body = (await req.json()) as { toolkit?: string; returnTo?: string };
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

  const appUrl =
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL;
  if (!appUrl) {
    return NextResponse.json(
      { error: "APP_URL/NEXT_PUBLIC_SITE_URL ausente — não dá pra montar callback" },
      { status: 500 },
    );
  }
  const callbackUrl = `${appUrl.replace(/\/$/, "")}${body.returnTo ?? "/settings"}`;

  const result = await initiateConnection(member.id, toolkit, callbackUrl);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    redirectUrl: result.redirectUrl,
    connectionId: result.connectionId,
  });
}
