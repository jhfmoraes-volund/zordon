import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/dal";

/**
 * GET /api/integrations/composio/github/tools-debug
 *
 * Diagnóstico camada-a-camada do Composio. Cada passo é independente — se
 * o (1) falhar, o (2) ainda roda. Retorna sempre JSON estruturado (não
 * "vaza" erro do SDK).
 */
export async function GET() {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized (sessão Volund)" }, { status: 401 });
  }

  const apiKey = process.env.COMPOSIO_API_KEY;
  const authConfigId =
    process.env.COMPOSIO_GITHUB_AUTH_CONFIG_ID ?? process.env.COMPOSIO_GITHUB_APP_ID;

  const out: Record<string, unknown> = {
    userId: member.id,
    env: {
      apiKeyPrefix: apiKey ? `${apiKey.slice(0, 8)}…` : "(ausente)",
      apiKeyLen: apiKey?.length ?? 0,
      authConfigIdPrefix: authConfigId ? `${authConfigId.slice(0, 8)}…` : "(ausente)",
    },
  };

  if (!apiKey) {
    return NextResponse.json(
      { ...out, error: "COMPOSIO_API_KEY ausente no env do server" },
      { status: 500 },
    );
  }

  // === Passo 1: API key direta via REST (sem SDK) ===
  // Bate em /api/v3/auth_configs (endpoint mínimo que precisa só da key).
  out.step1_directRest = await safe(async () => {
    const r = await fetch("https://backend.composio.dev/api/v3/auth_configs?limit=1", {
      headers: { "x-api-key": apiKey },
    });
    return {
      status: r.status,
      ok: r.ok,
      body: r.ok ? "ok (response truncated)" : await r.text().catch(() => "(empty)"),
    };
  });

  // === Passo 2: instanciar SDK ===
  let composio: unknown = null;
  out.step2_sdkInit = await safe(async () => {
    const { Composio } = await import("@composio/core");
    composio = new Composio({ apiKey });
    return { ok: true };
  });

  if (!composio) {
    return NextResponse.json(out);
  }

  // === Passo 3: listar conexões do user via SDK ===
  out.step3_connections = await safe(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = composio as any;
    const list = await c.connectedAccounts.list({
      userIds: [member.id],
      toolkitSlugs: ["github"],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (list?.items ?? list?.data ?? []) as any[];
    return {
      count: items.length,
      items: items.map((i) => ({
        id: i.id,
        status: i.status,
        toolkitSlug: i.toolkit?.slug ?? i.toolkitSlug,
        authConfigId: i.authConfig?.id ?? i.authConfigId,
      })),
    };
  });

  // === Passo 4: tools.get com userId + toolkit ===
  out.step4_toolsGet = await safe(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = composio as any;
    const tools = (await c.tools.get(member.id, {
      toolkits: ["github"],
      limit: 200,
    })) as Record<string, unknown>;
    const slugs = Object.keys(tools);
    return {
      count: slugs.length,
      slugs: slugs.slice(0, 50),
      truncated: slugs.length > 50,
    };
  });

  // === Passo 5: getRawComposioTools (catálogo, sem userId) ===
  out.step5_rawCatalog = await safe(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = composio as any;
    const raw = (await c.tools.getRawComposioTools({
      toolkits: ["github"],
      limit: 200,
    })) as Array<{ slug?: string; name?: string }>;
    const slugs = raw.map((t) => t.slug ?? t.name ?? "").filter((s) => s);
    return {
      count: slugs.length,
      slugs: slugs.slice(0, 50),
      truncated: slugs.length > 50,
    };
  });

  return NextResponse.json(out, { status: 200 });
}

// Helper: roda fn e devolve { ok: true, ...result } ou { ok: false, error }
async function safe<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; result: T } | { ok: false; error: string; errorRaw?: string }> {
  try {
    const result = await fn();
    return { ok: true, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Tenta extrair body do Composio se vier embutido
    let raw: string | undefined;
    if (err && typeof err === "object") {
      try {
        raw = JSON.stringify(err, Object.getOwnPropertyNames(err));
      } catch {
        // ignore
      }
    }
    return { ok: false, error: msg, ...(raw ? { errorRaw: raw } : {}) };
  }
}
