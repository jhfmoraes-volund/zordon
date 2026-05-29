import "server-only";
import type { ToolSet } from "ai";

/**
 * Composio integration — usa a SDK oficial com VercelProvider pra expor as
 * tools como AI SDK ToolSet (formato esperado pela engine).
 *
 * Auth flow (OAuth gerenciado pelo Composio):
 *   1. PM clica "Conectar GitHub" → /api/integrations/composio/connect
 *      chama initiateConnection(memberId, "github") → devolve redirectUrl.
 *   2. Frontend redireciona → usuário autentica no GitHub → Composio captura
 *      tokens, callback volta pro APP_URL configurado no Auth Config.
 *   3. /api/integrations/composio/status confirma via getConnectionStatus.
 *   4. Em runtime, agent.buildTools chama getUserTools(memberId, ["github"])
 *      → tools como GITHUB_GET_REPOSITORY_CONTENT entram no toolset.
 *
 * Pré-requisito MANUAL (1x, no painel Composio):
 *   - platform.composio.dev → Auth Configs → New → toolkit=github → Composio-managed OAuth
 *   - Copia o auth_config_id (ac_xxx) e põe em COMPOSIO_GITHUB_AUTH_CONFIG_ID
 *
 * Env vars necessárias:
 *   COMPOSIO_API_KEY                  (já existe)
 *   COMPOSIO_GITHUB_AUTH_CONFIG_ID    (precisa criar no painel Composio)
 *   APP_URL                           (pra callbackUrl pós-OAuth)
 */

// Cache do client singleton — Composio mantém estado interno (pusher, etc),
// não dá pra recriar a cada request.
type ComposioClient = unknown;
let _client: ComposioClient | null = null;

async function getClient(): Promise<ComposioClient | null> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    console.debug("[composio] COMPOSIO_API_KEY not set — skipping");
    return null;
  }
  if (_client) return _client;

  const { Composio } = await import("@composio/core");
  const { VercelProvider } = await import("@composio/vercel");
  _client = new Composio({
    apiKey,
    provider: new VercelProvider(),
  });
  return _client;
}

const GITHUB_AUTH_CONFIG_ID_ENV = "COMPOSIO_GITHUB_AUTH_CONFIG_ID";

function githubAuthConfigId(): string | null {
  return process.env[GITHUB_AUTH_CONFIG_ID_ENV] ?? null;
}

export type ComposioConnectionStatus = {
  toolkit: string;
  /** "active" | "initiated" | "expired" | "failed" | "inactive" | "not_connected" */
  status: string;
  connectedAccountId: string | null;
};

/**
 * Inicia conexão OAuth pra um toolkit (github). Devolve URL que o frontend
 * redireciona pra autenticação. userId = member.id (entityId no Composio).
 */
export async function initiateConnection(
  userId: string,
  toolkit: "github",
  callbackUrl?: string,
): Promise<{ redirectUrl: string; connectionId: string } | { error: string }> {
  const client = await getClient();
  if (!client) return { error: "Composio não configurado (COMPOSIO_API_KEY ausente)" };

  const authConfigId = githubAuthConfigId();
  if (!authConfigId) {
    return {
      error:
        "COMPOSIO_GITHUB_AUTH_CONFIG_ID ausente. Crie um Auth Config no painel Composio (toolkit=github, Composio-managed OAuth) e copie o ac_xxx pro .env.",
    };
  }
  void toolkit; // toolkit é implícito via authConfigId; mantido pra clarity da API

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const request = await c.connectedAccounts.initiate(userId, authConfigId, {
      callbackUrl,
    });
    const url = request?.redirectUrl;
    if (!url) {
      return { error: "Composio devolveu sem redirectUrl — verifique o Auth Config." };
    }
    return { redirectUrl: url, connectionId: request.id };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Lista conexões ativas de um usuário pra um toolkit. Devolve a primeira
 * (Composio garante 1 conexão por (user, toolkit, auth_config) em prática).
 */
export async function getConnectionStatus(
  userId: string,
  toolkit: "github",
): Promise<ComposioConnectionStatus> {
  const client = await getClient();
  if (!client) {
    return { toolkit, status: "not_connected", connectedAccountId: null };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const list = await c.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: [toolkit],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (list?.items ?? list?.data ?? []) as any[];
    const active = items.find((i) => i.status === "ACTIVE" || i.status === "active");
    const first = active ?? items[0];
    if (!first) {
      return { toolkit, status: "not_connected", connectedAccountId: null };
    }
    return {
      toolkit,
      status: String(first.status ?? "unknown").toLowerCase(),
      connectedAccountId: first.id ?? null,
    };
  } catch (err) {
    console.warn("[composio] getConnectionStatus failed:", (err as Error).message);
    return { toolkit, status: "not_connected", connectedAccountId: null };
  }
}

/**
 * Deleta a conexão. Idempotente — se não existe, retorna ok=true.
 */
export async function disconnect(
  userId: string,
  toolkit: "github",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = await getClient();
  if (!client) return { ok: false, error: "Composio não configurado" };

  const status = await getConnectionStatus(userId, toolkit);
  if (!status.connectedAccountId) return { ok: true };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    await c.connectedAccounts.delete(status.connectedAccountId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Carrega tools de um toolkit pro userId. Vazio se sem conexão ativa.
 * Cap em limit pra não estourar contexto (Vitória só precisa de 4-5
 * tools do GitHub no fluxo de planning).
 */
export async function getUserTools(
  userId: string,
  toolkits: Array<"github">,
  opts: { limit?: number; toolSlugs?: string[] } = {},
): Promise<ToolSet> {
  const client = await getClient();
  if (!client) return {};

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const tools = (await c.tools.get(userId, {
      toolkits,
      ...(opts.toolSlugs ? { tools: opts.toolSlugs } : {}),
      ...(opts.limit ? { limit: opts.limit } : {}),
    })) as ToolSet | Record<string, unknown>;
    // VercelProvider já devolve no formato ToolSet.
    return tools as ToolSet;
  } catch (err) {
    console.warn("[composio] getUserTools failed:", (err as Error).message);
    return {};
  }
}

// Mantém compat com chamadas antigas no Alpha (que usavam {userId, toolkits})
export async function getComposioTools(
  userId: string,
  toolkits: string[],
): Promise<ToolSet> {
  const supported = toolkits.filter((t): t is "github" => t === "github");
  if (supported.length === 0) return {};
  return getUserTools(userId, supported);
}
