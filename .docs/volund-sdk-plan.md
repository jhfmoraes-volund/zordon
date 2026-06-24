# Plano — Volund OS como Plataforma + SDK consumível externamente

**Repos envolvidos:** `volund-ia/volund-os` (deles), `Perke/volund` (este, Vitor)
**Branch sugerida (Volund):** `feat/platform-api-v1`
**Branch sugerida (Vitor):** `feat/use-volund-sdk`
**Data:** 2026-05-14
**Status:** projeto multi-fase, 6-10 semanas

---

## 0. TL;DR

Hoje Volund OS é app SaaS-style: cookie de sessão Supabase, UI deles, sem API externa. Pra Vitor consumir como serviço, **3 entregas grandes** em ordem:

1. **API Platform** no Volund (endpoints server-to-server + API key + org-scoped)
2. **SDK TypeScript** (`@volund/sdk`) — fina camada de cliente HTTP/streaming sobre a API
3. **Integração no Vitor** — UI continua, `/api/chat` proxya pro Volund via SDK

Cada entrega tem subpartes. Patches que você já passou pro dev (`build-mcp-config` lendo `mcp_servers`) são pré-requisito da Fase 1.

---

## 1. Arquitetura final

```
┌─────────────────────────────────────────┐
│ Vitor UI (browser)                      │
│   chat de design session                │
└────────────────┬────────────────────────┘
                 ↓ POST /api/design-sessions/[id]/chat
┌─────────────────────────────────────────┐
│ Vitor (Next 16 — este repo)             │
│   route.ts:                             │
│     ├─ auth (cookie do Vitor)           │
│     ├─ resolve volundThreadId           │
│     └─ @volund/sdk → streamChat()       │
└────────────────┬────────────────────────┘
                 ↓ POST https://volund/api/v1/chat
                 ↓   Authorization: Bearer <PAT>
                 ↓   X-Volund-Agent-Id: <vitor-portado>
                 ↓   body: { messages, threadId }
┌─────────────────────────────────────────┐
│ Volund OS Platform API                  │
│   ├─ auth: PAT → service principal      │
│   ├─ rate limit + quota                 │
│   ├─ → runAgentV2(agente "Vitor")       │
│   │     ↳ Claude Code em E2B sandbox    │
│   │     ↳ MCP: volund interno + vitor   │
│   ├─ stream SSE de volta                │
│   └─ webhook (opcional) on completion   │
└──────────┬──────────────────────────────┘
           ↓ HTTP MCP (Bearer)
┌─────────────────────────────────────────┐
│ Vitor MCP server (mesmo app Vitor)      │
│   POST /api/mcp                         │
│   ↳ tools: decisions, stories, etc      │
│   ↳ Postgres Vitor                      │
└─────────────────────────────────────────┘
```

**Direções da seta** (importantes pra não confundir):
- Vitor UI → Vitor backend (cookie auth interno)
- Vitor backend → Volund API (Bearer PAT — **novo**)
- Volund sandbox → Vitor MCP (Bearer compartilhado — **novo**)
- Volund stream SSE → Vitor backend → Vitor UI (pipe transparente)

---

## 2. Estado atual (auditoria)

### 2.1 Volund OS hoje

| Componente | Estado | Gap |
|---|---|---|
| `app/api/chat/route.ts` | `webConnector.handle(req)` com cookie auth | Não aceita Bearer/API key |
| `lib/agent/connectors/web.ts:71` | `createClient()` → `cookie.auth.getUser()` | Falha sem cookie Supabase |
| `lib/agent/v2/run.ts` (736 linhas) | Funciona, mas acoplado a vault, e2b, composio, RAG, knowledge, pricing, github, quota, usage-logs | Engine não é portável; só consumível via runtime Volund |
| `lib/agent/v2/build-mcp-config.ts` | Hardcoded `volund` interno | **Patch já em dev** — passa a ler `mcp_servers` |
| Tabela `mcp_servers` | Agent-scoped, HTTP/SSE, OAuth, tool_prefix | OK pra Fase 1 |
| Multi-tenancy | Org → User → Agent. `has_agent_access(agent_id, 'use'/'configure')` | RLS já existe |
| Billing/quota | `lib/agent/v2/quota.ts` (243 linhas) — token quota refresh | Existe pra usuário; **não existe pra API consumer** |
| API key system | **Inexistente** | Precisa criar do zero |
| SDK npm | **Inexistente** | Precisa criar |
| Docs de integração | **Inexistente** | Precisa criar |

### 2.2 Vitor hoje (este repo)

| Componente | Estado | Como muda |
|---|---|---|
| `src/app/api/design-sessions/[id]/chat/route.ts` | `webConnector.handle(req, sessionId)` → `runAgent(vitorAgent)` local | Muda pra proxy via `@volund/sdk` |
| `src/lib/agent/connectors/web.ts` | Engine local com OpenRouter | Deprecate eventual (mantém durante migração) |
| `src/lib/agent/agents/vitor/` | Prompt 1447 linhas + loadContext + tools | Portar pro agente Volund |
| `src/lib/agent/tools/` (16 tools) | Tools locais | Algumas viram MCP, outras ficam internas |
| Tabelas `ChatThread`/`ChatMessage` | Persistência local | Coexiste com persistência Volund (durante migração) |
| Auth | Cookie Supabase Vitor | Continua igual; interno |

---

## 3. Fase 1 — API Platform no Volund OS

**Trabalho:** no repo `volund-ia/volund-os`. Você precisa coordenar com o dev de lá.

**Duração estimada:** 2-3 semanas.

### 3.1 Schema

Migration nova `supabase/migrations/<date>_platform_api_keys.sql`:

```sql
-- API Keys (Personal Access Tokens). Org-scoped.
CREATE TABLE public.api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  -- service principal: a "fake user" que rep o consumer externo
  service_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,                    -- "Vitor production", "Vitor staging"
  key_prefix      text NOT NULL,                    -- "vlnd_live_a1b2"  (visível)
  key_hash        text NOT NULL,                    -- bcrypt do token completo
  scopes          text[] NOT NULL DEFAULT ARRAY['chat:write','chat:read'],
  allowed_agents  uuid[],                           -- whitelist; NULL = todos da org
  rate_limit_rpm  integer NOT NULL DEFAULT 60,
  expires_at      timestamptz,
  last_used_at    timestamptz,
  created_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

CREATE INDEX idx_api_keys_prefix ON public.api_keys(key_prefix) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_org ON public.api_keys(org_id);

-- Usage tracking (também alimenta billing)
CREATE TABLE public.api_key_usage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id      uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  agent_id        uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  thread_id       uuid,
  endpoint        text NOT NULL,           -- "chat", "threads.create", etc
  status_code     integer NOT NULL,
  duration_ms     integer,
  input_tokens    integer,
  output_tokens   integer,
  cost_usd        numeric(10,6),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_key_usage_key_time ON public.api_key_usage(api_key_id, created_at DESC);

-- Rate limit windows
CREATE TABLE public.api_key_rate_limit (
  api_key_id   uuid PRIMARY KEY REFERENCES public.api_keys(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0
);

-- RLS: só admins de org veem suas próprias keys
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY ak_select ON public.api_keys FOR SELECT USING (
  org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid() AND role = 'admin')
);
```

### 3.2 Service principal pattern

API key não é um user real — é vinculada a um `service_user_id` (usuário "robô" criado quando API key é provisionada). Permissões fluem via `has_agent_access(agent_id, 'use')` igual aos users normais.

Endpoint admin (UI ou API) cria: `POST /api/admin/api-keys`:
- Cria `auth.users` row com email `api-key+<uuid>@volund.service`
- Adiciona service user em `agent_members` pros agentes whitelisted
- Retorna token uma única vez: `vlnd_live_<prefix>_<random>`

### 3.3 Middleware de auth

`lib/api/auth.ts` (novo no Volund):

```ts
import { createServiceClient } from "@/lib/supabase/service";

export interface ApiContext {
  apiKeyId: string;
  serviceUserId: string;
  orgId: string;
  scopes: string[];
  allowedAgents: string[] | null;
}

export async function authenticateApiKey(req: Request): Promise<{ ok: true; ctx: ApiContext } | { ok: false; status: number; error: string }> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing Bearer token" };
  }
  const token = header.slice(7);
  if (!token.startsWith("vlnd_")) {
    return { ok: false, status: 401, error: "Invalid token format" };
  }
  const prefix = token.split("_").slice(0, 3).join("_"); // vlnd_live_a1b2

  const supabase = createServiceClient();
  const { data: key } = await supabase
    .from("api_keys")
    .select("id, key_hash, service_user_id, org_id, scopes, allowed_agents, expires_at, revoked_at, rate_limit_rpm")
    .eq("key_prefix", prefix)
    .maybeSingle();

  if (!key || key.revoked_at || (key.expires_at && new Date(key.expires_at) < new Date())) {
    return { ok: false, status: 401, error: "Invalid or expired key" };
  }

  // bcrypt compare
  const valid = await bcryptCompare(token, key.key_hash);
  if (!valid) return { ok: false, status: 401, error: "Invalid key" };

  // Rate limit (sliding window 1 min)
  const limited = await checkRateLimit(key.id, key.rate_limit_rpm);
  if (limited) return { ok: false, status: 429, error: "Rate limited" };

  // Fire-and-forget update de last_used_at
  void supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);

  return {
    ok: true,
    ctx: {
      apiKeyId: key.id,
      serviceUserId: key.service_user_id,
      orgId: key.org_id,
      scopes: key.scopes,
      allowedAgents: key.allowed_agents,
    },
  };
}
```

### 3.4 Endpoint público — `app/api/v1/chat/route.ts`

```ts
import { authenticateApiKey } from "@/lib/api/auth";
import { runChatViaApi } from "@/lib/api/chat-handler";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(req: Request) {
  const auth = await authenticateApiKey(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  return runChatViaApi(req, auth.ctx);
}
```

`runChatViaApi` é cópia adaptada de `webConnector.handle` que:
- Pula `cookie.auth.getUser()` — usa `ctx.serviceUserId` como `ownerUserId`
- Valida que `body.agentId ∈ ctx.allowedAgents` (se whitelist set)
- Chama `runAgentV2` ou `runAgent` igual
- Loga em `api_key_usage` no `onFinish`
- Stream SSE de volta (igual `webConnector` faz)

### 3.5 Endpoint de threads — `app/api/v1/threads/route.ts`

CRUD básico:
- `POST /api/v1/threads` — cria thread (recebe `agent_id`, retorna `{ id }`)
- `GET /api/v1/threads/:id/messages` — lista mensagens
- `DELETE /api/v1/threads/:id` — soft delete

Reusa `lib/threads/*` do Volund, gateando por `agent_id ∈ ctx.allowedAgents`.

### 3.6 Endpoint de agents (read-only) — `app/api/v1/agents/route.ts`

`GET /api/v1/agents` — lista agentes que esta API key pode usar.

Útil pro Vitor descobrir qual `agentId` passar.

### 3.7 Webhooks (opcional, mas recomendado)

Tabela `webhooks`:
```sql
CREATE TABLE public.webhooks (
  id          uuid PRIMARY KEY,
  api_key_id  uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  url         text NOT NULL,
  secret      text NOT NULL,                -- HMAC SHA256 do payload
  events      text[] NOT NULL,              -- ["thread.completed", "thread.failed"]
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);
```

Volund POSTa eventos pro Vitor: `{ event, thread_id, agent_id, timestamp }`. Útil pra UI mostrar "agente terminou" sem manter SSE aberto.

### 3.8 Docs

`docs/api/v1/` no Volund:
- `intro.md` — visão geral, modelo de auth
- `chat.md` — endpoint, body, SSE format
- `threads.md`
- `webhooks.md`
- `errors.md` — códigos canônicos

Ideal: hospedar em `volund.com.br/docs/api` ou similar.

### 3.9 Critério de aceite Fase 1

- [ ] Migration aplicada
- [ ] `POST /api/v1/chat` aceita Bearer, autentica, streama SSE
- [ ] Rate limit funciona (1 req/segundo numa key com `rate_limit_rpm=60`)
- [ ] Whitelist `allowed_agents` bloqueia agentId fora dela
- [ ] Logs em `api_key_usage` populados após cada run
- [ ] Admin UI mostra "criar API key" e exibe token uma vez
- [ ] Docs publicadas

---

## 4. Fase 2 — SDK TypeScript (`@volund/sdk`)

**Trabalho:** repo novo `volund-ia/volund-sdk-ts` (ou submodule no monorepo deles).

**Duração estimada:** 1 semana após Fase 1 estável.

### 4.1 Surface da API

```ts
import { VolundClient } from "@volund/sdk";

const volund = new VolundClient({
  apiKey: process.env.VOLUND_API_KEY!,           // vlnd_live_...
  baseUrl: "https://volund.com.br",              // default
  // optional: timeout, retries, fetch override pra Next
});

// Chat com streaming
const stream = await volund.chat.stream({
  agentId: "uuid-vitor-portado",
  threadId: "uuid-thread",                       // opcional: cria nova se omitido
  messages: [{ role: "user", content: "olá" }],
});

for await (const event of stream) {
  // event = { type: "text-delta", text: "..." } | { type: "tool-call", ... } | { type: "finish", ... }
}

// Threads CRUD
const thread = await volund.threads.create({ agentId: "..." });
const messages = await volund.threads.messages(thread.id);

// Agents
const agents = await volund.agents.list();
```

### 4.2 Estrutura do package

```
packages/sdk/
├── src/
│   ├── client.ts            # VolundClient class
│   ├── resources/
│   │   ├── chat.ts          # chat.stream() — SSE parser
│   │   ├── threads.ts
│   │   ├── agents.ts
│   │   └── webhooks.ts      # verifyWebhook(signature, body, secret)
│   ├── streaming.ts         # parseSSE generator
│   ├── errors.ts            # VolundError, RateLimitError, AuthError
│   └── types.ts             # tipos compartilhados
├── tests/
├── package.json             # @volund/sdk
└── README.md
```

### 4.3 Decisões técnicas

- **Runtime:** Node 20+ (mesmo do Vitor). Funciona em Vercel Edge? Sim, se evitar `node:*` no client.
- **Dependências:** zero externas. `fetch` global, JSON, async iterators. Sem axios, sem ws.
- **TypeScript:** strict. Types gerados a partir de OpenAPI schema da API v1 (manter consistência).
- **Streaming:** SSE via `ReadableStream` da Response — parser próprio (não depende de `eventsource-parser` etc).
- **Errors:** classes tipadas pra cada status (401 → `AuthError`, 429 → `RateLimitError`, 5xx → `ServerError`).
- **Retry:** opt-in via config (`{ retries: 3 }`), exponencial. Default off.

### 4.4 Exemplo de uso do streaming no Vitor

```ts
// src/app/api/design-sessions/[id]/chat/route.ts (versão SDK)
import { VolundClient } from "@volund/sdk";
import { resolveVolundThread } from "@/lib/volund/threads";

const volund = new VolundClient({ apiKey: process.env.VOLUND_API_KEY! });

export async function POST(req: NextRequest, { params }) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const body = await req.json();
  const volundThreadId = await resolveVolundThread(sessionId);

  const stream = await volund.chat.stream({
    agentId: process.env.VOLUND_VITOR_AGENT_ID!,
    threadId: volundThreadId,
    messages: body.messages,
    metadata: {
      "vitor-session-id": sessionId,
      "vitor-step-key": body.currentStepKey,
    },
  });

  // Convert async iterator → Response stream (SSE pra UI)
  return new Response(
    new ReadableStream({
      async start(controller) {
        for await (const event of stream) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}
```

### 4.5 Critério de aceite Fase 2

- [ ] Package publicado em npm (privado se necessário) como `@volund/sdk`
- [ ] Versionamento semver, changelog
- [ ] Smoke test: chat real contra API v1 de staging, recebe stream completo
- [ ] Types completos (sem `any` exposto)
- [ ] README com 3 exemplos: chat, threads, webhooks
- [ ] CI: lint + test + build no push

---

## 5. Fase 3 — Portar Vitor pro Volund

**Trabalho:** principalmente no Volund (criar agente "Vitor"), com mudanças menores no Vitor (proxy + mapping de threads).

**Duração estimada:** 3-4 semanas (parte mais difícil do projeto).

### 5.1 Subfase 3.1 — Criar agente "Vitor-portado" no Volund

Via UI ou SQL direto:

```sql
INSERT INTO agents (id, org_id, slug, name, description, system_prompt, harness_version, ...)
VALUES (
  '<uuid>',
  '<perke-org-id>',
  'vitor',
  'Vitor — Design Session',
  'Conduz design sessions de produto: discovery → story tree → task breakdown → promoção',
  '<conteudo do src/lib/agent/prompt.ts adaptado>',
  '2.0',
  ...
);
```

**Adaptação do prompt (1447 linhas):**

| Hoje no Vitor | No Volund |
|---|---|
| `tool({ description, inputSchema, execute })` direto via AI SDK | Via MCP (`mcp__vitor__*`) ou tools nativas Claude Code |
| `loadContext` (10 queries) | Tool MCP `mcp__vitor__load_session_context({ sessionId })` chamada como primeira tool |
| `briefingSubPhase` no system prompt | Mesmo, mas estado mora em metadata da thread Volund |
| `verbosity` adaptativa (5 níveis) | Mesmo conceito, mas montado por `mcp__vitor__load_session_context` retornando sessionContext já modulado |
| Tools de hierarquia (create_user_story etc) | Via `mcp__vitor__*` |
| `web_search`, `search_doc` | Substituídos por WebSearch nativo do Claude Code |

**Trabalho real aqui:** ler o prompt linha a linha, traduzir referências a tools locais pras tools MCP equivalentes. Algumas regras precisam reformulação (ex: "chame `list_project_tags` antes de criar task" → "chame `mcp__vitor__list_project_tags` antes").

**Não é copy-paste.** É refactor cuidadoso. Estimativa: 3-5 dias de trabalho focado + audit equivalente ao [vitor-audit.md](vitor-audit.md) pra validar paridade.

### 5.2 Subfase 3.2 — Expandir Vitor MCP server com tools de hierarquia

Plano original ([vitor-mcp-plan.md](vitor-mcp-plan.md)) cobria só memória. Agora precisa **expor toda a hierarquia** porque o agente Volund precisa criar modules/stories/tasks via MCP.

Tools adicionais a expor:
- `propose_modules`, `sync_personas`
- `create_user_story`, `set_story_refinement`, `list_stories`, `delete_user_story`
- `create_task`, `update_task`, `delete_task`, `list_session_tasks`, `list_project_tasks`
- `list_project_tags`
- `load_session_context` — **nova**, equivalente ao `loadContext` do agente, retorna o contexto montado pra agente Volund usar

Total: ~25 tools no MCP (15 originais + 10 novas).

**Refactor:** mesma estratégia — extrair função pura de cada factory, MCP delega.

### 5.3 Subfase 3.3 — Mapping de threads Vitor ↔ Volund

Adicionar coluna em `ChatThread` do Vitor:

```sql
ALTER TABLE "ChatThread" ADD COLUMN "volundThreadId" uuid;
CREATE UNIQUE INDEX ON "ChatThread"("volundThreadId") WHERE "volundThreadId" IS NOT NULL;
```

Helper `src/lib/volund/threads.ts`:

```ts
export async function resolveVolundThread(sessionId: string): Promise<string> {
  const supabase = db();
  const { data: thread } = await supabase
    .from("ChatThread")
    .select("id, volundThreadId")
    .eq("sessionId", sessionId)
    .eq("channel", "web")
    .maybeSingle();

  if (thread?.volundThreadId) return thread.volundThreadId;

  // Cria thread no Volund + atualiza mapping
  const volund = new VolundClient({ apiKey: process.env.VOLUND_API_KEY! });
  const created = await volund.threads.create({
    agentId: process.env.VOLUND_VITOR_AGENT_ID!,
    metadata: { vitorSessionId: sessionId },
  });

  await supabase
    .from("ChatThread")
    .update({ volundThreadId: created.id })
    .eq("id", thread!.id);

  return created.id;
}
```

### 5.4 Subfase 3.4 — Proxy no route handler do Vitor

(Versão completa em §4.4 acima.) Mudança em `src/app/api/design-sessions/[id]/chat/route.ts`:

- Antes: `webConnector.handle(req, sessionId)` → roda agente local
- Depois: `volund.chat.stream({...})` → proxya, streama SSE de volta

UI **não muda**.

### 5.5 Subfase 3.5 — Persistência dupla durante migração

Durante transição, mensagens precisam ficar **em ambos** os bancos (Vitor + Volund) pra UI atual não quebrar:

- Volund persiste em `messages` (tabela deles) — fonte de verdade pro agente
- Vitor persiste em `ChatMessage` (espelho) via:
  - Opção A: hook no proxy — após cada chunk SSE, escreve em `ChatMessage`
  - Opção B: webhook `thread.message.created` do Volund → escreve em `ChatMessage`
  - Opção C: API call em `volund.threads.messages(threadId)` pra rebuilds

**Recomendo B** (webhook) — push é mais barato que poll. Volund precisa expor esse evento.

### 5.6 Subfase 3.6 — Audit de paridade

Rodar o [vitor-audit.md](vitor-audit.md) (V1..V10 + scorecard 60pts) **na versão Volund**. Critério: ≥ 50/60 (vs 58/60 do original) — pequena degradação aceitável dado o overhead extra; abaixo disso, ajustar prompt no Volund.

### 5.7 Critério de aceite Fase 3

- [ ] Agente "Vitor-portado" criado no Volund com `harness_version=2.0`
- [ ] MCP do Vitor expõe 25 tools (memória + hierarquia + load_session_context)
- [ ] Mapping `ChatThread.volundThreadId` populado pra todas as sessions ativas
- [ ] Proxy funcionando: UI Vitor → resposta de Volund chega via SSE
- [ ] Webhook configurado: `thread.message.created` → espelhamento em `ChatMessage`
- [ ] Audit V1..V10 atinge ≥ 50/60
- [ ] Sessões antigas continuam funcionando (rollback path: feature flag `USE_VOLUND_AGENT`)

---

## 6. Fase 4 — Deprecate agente Vitor local

**Duração estimada:** 1 semana, mas só após Fase 3 estável por 2-3 semanas em prod.

- Remover `src/lib/agent/connectors/web.ts` (engine local)
- Remover `src/lib/agent/agents/vitor/`
- Remover tools que viraram MCP (manter MCP server)
- Limpar imports órfãos
- Manter `ChatMessage`/`ChatThread` (espelho — útil pra UI funcionar offline-ish)

---

## 7. Riscos e mitigações

### 7.1 Volund não tem appetite pra virar plataforma

**Risco:** dev do Volund pode dizer "não, isso muda nosso modelo de produto".

**Mitigação:** pitch claro de valor — primeiro cliente (Vitor) provando o caso. Se eles ainda recusarem, fallback é Opção 2 do plano anterior (self-host Volund + cookie roubado), ou repensar arquitetura inteira.

### 7.2 Engine v2 está fortemente acoplada

4500 linhas com dependências em vault, e2b, composio, RAG, knowledge, pricing, github, quota, usage-logs. SDK não extrai o engine — **o engine continua no Volund**. SDK é só cliente HTTP. Mantém escopo gerenciável.

### 7.3 Latência extra

Cada chat agora: Vitor UI → Vitor backend → Volund API → sandbox E2B → Claude Code → MCP HTTP → Vitor MCP → Postgres Vitor.

**Cada hop adiciona latência.** Sandbox cold boot ~10-30s. Estimativa total: primeiro turn 15-40s, turns subsequentes 3-8s.

**Mitigação:** sandbox warm reconnect (já existe), HTTP/2 keep-alive em todas as pontes, MCP HTTP roda no mesmo datacenter do Volund (ideal).

### 7.4 Cost spike

Cada chat = sandbox E2B + Claude Code tokens (BYO subscription de quem? do API key?). Custo por turn ≫ chat OpenRouter de hoje.

**Mitigação:** quota explícita por API key + monitoring de cost em `api_key_usage`. Definir budget mensal antes de prod.

### 7.5 Migration window: sessões em fly durante deploy

Sessões ativas durante o deploy podem ter mensagens half-written em ambos os bancos.

**Mitigação:** deploy fora de horário, freeze de sessões durante janela (30 min), feature flag `USE_VOLUND_AGENT=false` por padrão e gradual rollout (sessões novas primeiro, antigas depois).

### 7.6 Reversibilidade

Se Fase 3 falhar, tem que conseguir voltar. Manter agente local funcional **até** Fase 4 (3-4 semanas após Fase 3 em prod).

---

## 8. Timeline consolidada

```
Semana 1-3:   Fase 1 (Platform API no Volund)
Semana 4:     Fase 2 (SDK TypeScript)
Semana 5-8:   Fase 3 (Portar Vitor + audit)
Semana 9-11:  Estabilização em prod
Semana 12:    Fase 4 (Deprecate agente local)
```

**Total: 10-12 semanas.** Com pessoas dedicadas. Se for trabalho de horas espalhadas, multiplique por 2.

---

## 9. Decisões pendentes (preciso de você)

1. **Quem paga as tokens Claude?** Cada API key tem OAuth Anthropic vinculado? Ou Volund tem service Anthropic conta e cobra do consumer?

2. **Multi-tenant Vitor?** Se outros clientes do Vitor (não-Perke) usarem essa arquitetura, cada um precisa de API key Volund própria, ou Perke gerencia 1 key central?

3. **Self-host Volund?** Vai usar SaaS deles ou hospedar instância própria? (Afeta cost, latência, controle.)

4. **Budget Fase 1?** Quanto vale o trabalho no Volund pra você? Você está bancando o dev de lá ou é mútuo benefício?

5. **Webhook ou SSE puro?** Fase 3 mais simples se for SSE puro (sem webhook). Vale a pena pular webhook no MVP?

6. **Versão do SDK** — public package npm (open source) ou private registry?

---

## 10. Próximo passo concreto

1. **Conversar com dev Volund sobre Fase 1** — confirmar interesse, validar prazo, alinhar prioridade.
2. **Em paralelo**, expandir Vitor MCP server pra incluir tools de hierarquia (vai ser necessário em Fase 3, dá pra adiantar).
3. **Spec OpenAPI da API v1** — escrita conjunta. Esse documento é a fonte de verdade pra gerar tipos do SDK e docs.
4. **Pilot agreement** — Perke é primeiro cliente; ganha desconto/early access em troca de ser cobaia.

Sem (1) o resto desmorona. Começa por aí.
