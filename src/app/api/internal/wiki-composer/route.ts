import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { composeWiki } from "@/lib/wiki/composer";

/**
 * POST /api/internal/wiki-composer — worker do compose (emenda D8: módulo
 * Next em rota separada, em vez de Edge Function Deno).
 *
 * Sem sessão de usuário: autentica por header x-cron-secret === CRON_SECRET.
 * Invocada fire-and-forget pelo POST /wiki/compose (202); o cron chama
 * composeWiki() direto (mesma instância), não esta rota.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  projectId: z.string().uuid(),
  jobId: z.string().uuid(),
  trigger: z.enum(["manual", "cron"]).default("manual"),
});

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new NextResponse("Server misconfigured: CRON_SECRET missing", {
      status: 500,
    });
  }
  if (req.headers.get("x-cron-secret") !== secret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { projectId, jobId, trigger } = parsed.data;
  const result = await composeWiki(projectId, jobId, trigger);
  return NextResponse.json(result);
}
