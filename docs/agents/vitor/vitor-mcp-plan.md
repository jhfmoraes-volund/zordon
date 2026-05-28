# Plano — Vitor MCP Server (consumido pelo Volund OS v2)

**Repo:** `volund` (este)
**Branch sugerida:** `feat/vitor-mcp-server`
**Pré-requisito externo:** patch em `volund-os` que faz `build-mcp-config.ts` ler `mcp_servers` (já no dev — assumido em prod).
**Data:** 2026-05-14

---

## 0. Premissa

Volund v2 spawna Claude Code no E2B com `--strict-mcp-config`. Após o patch dele, ele lê `mcp_servers` filtrado por `agent_id + enabled=true` e injeta no `mcp.json` do sandbox. Vitor MCP entra como server HTTP com Bearer token.

**O que este plano cobre:** lado Vitor — route handler MCP, escopo de tools, auth, deploy, testes, rollout.

---

## 1. Arquitetura final

```
┌───────────────────────────────────────────────────┐
│ Você no chat do Volund OS                         │
└────────────────────┬──────────────────────────────┘
                     ↓
┌───────────────────────────────────────────────────┐
│ Volund OS (Vercel/Next) — runAgentV2              │
│  ├─ fetch mcp_servers → encontra "Vitor"          │
│  ├─ resolve OAuth/Bearer headers                  │
│  └─ escreve mcp.json no scratch do sandbox        │
└────────────────────┬──────────────────────────────┘
                     ↓ spawn Claude Code CLI
┌───────────────────────────────────────────────────┐
│ E2B Sandbox                                       │
│  Claude Code CLI                                  │
│   ├─ MCP "volund" (stdio, interno)                │
│   └─ MCP "vitor" (HTTP) ───────┐                  │
└────────────────────────────────┼──────────────────┘
                                 ↓ HTTPS Bearer
┌───────────────────────────────────────────────────┐
│ App Vitor (Next 16 — este repo)                   │
│   route: POST /api/mcp                            │
│     ├─ auth: Bearer VITOR_MCP_TOKEN               │
│     ├─ JSON-RPC 2.0 stateless                     │
│     └─ tools/list, tools/call                     │
│  ↓ delega pra funções de tools internas           │
│  src/lib/agent/tools/memory.ts (já existe)        │
│  ↓                                                │
│  Postgres Supabase                                │
└───────────────────────────────────────────────────┘
```

**Decisões fundamentais (resgatadas das conversas anteriores):**

- **Transport:** HTTP (não SSE — deprecated por Anthropic, não stdio — Vitor é app, não binário).
- **JSON-RPC manual stateless**, sem `@modelcontextprotocol/sdk` (Web Fetch ↔ Node API mismatch; SDK exige IncomingMessage/ServerResponse). 200 linhas vs adapter frágil.
- **Mesmo deploy do app Vitor.** Sem Fly.io novo, sem container separado — route handler `/api/mcp` no Next 16 do worktree (eventualmente mergeado pra main).
- **Auth:** Bearer compartilhado por ambiente (single tenant interno). Token novo no `.env`.
- **Escopo:** memória estruturada do Vitor (decisions, open questions, research, business context, project/session memory, mvp_check, compact). **Sem hierarquia** (modules/stories/tasks/personas) — esses são território exclusivo do Vitor conduzindo design session, não exporto via MCP.
- **Stateless por design:** `projectId`/`sessionId` são argumentos obrigatórios em toda call. MCP server não rastreia state — quem chama (Volund) controla escopo.

---

## 2. Escopo das tools (15 tools, alinhado com `vitor-mcp-spec.md`)

Reusa funções já implementadas em [src/lib/agent/tools/memory.ts](../src/lib/agent/tools/memory.ts) e [src/lib/agent/tools/mvp-check.ts](../src/lib/agent/tools/mvp-check.ts). **Não duplica lógica** — só desembrulha o wrapper `tool({...})` do Vercel AI SDK em funções puras que o MCP handler chama.

### 2.1 Tools expostas

| # | Tool | Tipo | Origem |
|---|---|---|---|
| 1 | `record_decision` | write | memory.ts:23 |
| 2 | `revise_decision` | write | memory.ts:58 |
| 3 | `list_decisions` | read | memory.ts:97 |
| 4 | `add_open_question` | write | memory.ts:124 |
| 5 | `resolve_open_question` | write | memory.ts:152 |
| 6 | `list_open_questions` | read | memory.ts:177 |
| 7 | `list_research` | read | memory.ts:202 |
| 8 | `read_business_context` | read | memory.ts:232 |
| 9 | `read_session_memory` | read | memory.ts:251 |
| 10 | `update_session_memory` | write | memory.ts:338 |
| 11 | `read_project_memory` | read | memory.ts:401 |
| 12 | `update_project_memory` | write | memory.ts:449 |
| 13 | `list_project_sessions` | read | memory.ts:504 |
| 14 | `compact_session_to_project` | write | memory.ts:528 |
| 15 | `mvp_check` | read+eval | mvp-check.ts:39 |

### 2.2 Tools deliberadamente NÃO expostas

- `create_user_story`, `create_task`, `propose_modules`, `sync_personas`, `set_story_refinement`, `list_stories`, `list_tasks`, `list_project_tags` — hierarquia é território exclusivo do Vitor conduzindo design session.
- `web_search` — Vitor tem hook próprio que auto-captura research (lado app, fora do MCP).
- `search_doc`, `_text-decode` — tools internas, sem valor externo.
- `alpha-hierarchy`, `alpha-planner` — pertencem ao agente Alpha, não Vitor.

### 2.3 Diferença vs assinatura atual das funções

**Hoje** (factory pattern em `memory.ts`):
```ts
export function createRecordDecisionTool(sessionId: string, projectId: string) {
  return tool({
    execute: async ({ statement, rationale, ... }) => { /* closure usa sessionId/projectId */ }
  });
}
```

**Pro MCP** (handler stateless):
```ts
export async function recordDecision(input: {
  projectId: string; sessionId: string;
  statement: string; rationale: string; confidence: ...; tags?: string[];
  agent?: string; // default "external"
}) { /* recebe scope como argumento */ }
```

**Refactor:** extrai cada `execute` em função pura nomeada (`recordDecision`, `listDecisions`, etc), e a factory existente (`createRecordDecisionTool`) passa a wrappear a função pura. Zero mudança de comportamento pro Vitor original; ganho: MCP route handler chama as funções puras diretamente.

---

## 3. Estrutura de código

```
src/app/api/mcp/
├── route.ts                    # POST handler — entrypoint MCP
├── auth.ts                     # Bearer token check
├── rpc.ts                      # JSON-RPC 2.0 envelope helpers
├── tools.ts                    # registry: nome → schema + handler
└── schemas.ts                  # JSON Schemas exportados pra tools/list

src/lib/agent/tools/
├── memory.ts                   # ← refatorar: extrair funções puras
└── mvp-check.ts                # ← idem
```

### 3.1 `route.ts` — entrypoint

```ts
import { NextRequest } from "next/server";
import { verifyAuth } from "./auth";
import { handleRpc } from "./rpc";

export const runtime = "nodejs";        // precisa de Postgres TCP
export const dynamic = "force-dynamic"; // sem cache de rota

export async function POST(req: NextRequest) {
  const authErr = verifyAuth(req);
  if (authErr) return authErr;
  const body = await req.json();
  const response = await handleRpc(body);
  return Response.json(response);
}

export async function GET() {
  // Health check pro Volund descobrir o server.
  return Response.json({ name: "vitor-mcp", version: "0.1.0", protocol: "2024-11-05" });
}
```

**Por que não SSE/streaming:** stateless mode do MCP suporta JSON puro (request → response síncrona). Volund/Claude Code aceita esse modo. Mais simples, mais rápido, sem `ReadableStream` shenanigans.

### 3.2 `auth.ts` — Bearer

```ts
export function verifyAuth(req: NextRequest): Response | null {
  const expected = process.env.VITOR_MCP_TOKEN;
  if (!expected) return new Response("Server misconfigured", { status: 500 });
  const header = req.headers.get("authorization");
  if (header !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
```

### 3.3 `rpc.ts` — JSON-RPC envelope

```ts
// Tipos JSON-RPC 2.0
type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: unknown };
type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

// Códigos canônicos
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export async function handleRpc(req: RpcRequest): Promise<RpcResponse> {
  const id = req.id ?? null;
  if (req.jsonrpc !== "2.0" || !req.method) {
    return { jsonrpc: "2.0", id, error: { code: INVALID_REQUEST, message: "Invalid JSON-RPC" } };
  }

  try {
    switch (req.method) {
      case "initialize": return { jsonrpc: "2.0", id, result: handleInitialize() };
      case "tools/list": return { jsonrpc: "2.0", id, result: { tools: TOOL_REGISTRY.map(t => t.schema) } };
      case "tools/call": return { jsonrpc: "2.0", id, result: await handleToolCall(req.params) };
      default: return { jsonrpc: "2.0", id, error: { code: METHOD_NOT_FOUND, message: `Unknown method: ${req.method}` } };
    }
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: INTERNAL_ERROR, message: (e as Error).message } };
  }
}

function handleInitialize() {
  return {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "vitor-mcp", version: "0.1.0" },
  };
}

async function handleToolCall(params: unknown) {
  const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };
  const tool = TOOL_REGISTRY.find(t => t.schema.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  const result = await tool.handler(args);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}
```

### 3.4 `tools.ts` — registry

```ts
import { recordDecision, listDecisions, reviseDecision, /* ... */ } from "@/lib/agent/tools/memory";
import { mvpCheck } from "@/lib/agent/tools/mvp-check";
import { TOOL_SCHEMAS } from "./schemas";

interface ToolEntry {
  schema: { name: string; description: string; inputSchema: object };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export const TOOL_REGISTRY: ToolEntry[] = [
  {
    schema: TOOL_SCHEMAS.record_decision,
    handler: async (args) => recordDecision(args as Parameters<typeof recordDecision>[0]),
  },
  // ... 14 outras
];
```

### 3.5 `schemas.ts` — JSON Schemas

15 schemas em formato MCP. Conteúdo já no `vitor-mcp-spec.md` seção 4 — só transcrever pra JSON Schema canônico (`type: object`, `properties`, `required`).

---

## 4. Refactor de `memory.ts` e `mvp-check.ts`

### Padrão atual
```ts
export function createRecordDecisionTool(sessionId: string, projectId: string) {
  return tool({ description: "...", inputSchema: z.object({...}),
    execute: async ({ statement, rationale, confidence, tags }) => {
      const { data, error } = await db().from("DesignDecision").insert({...}).select(...).single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, decision: data };
    },
  });
}
```

### Padrão novo (paralelo, não substituto)
```ts
// Função pura, exportada nominalmente. Pode ser chamada pelo MCP handler ou pela factory existente.
export async function recordDecision(input: {
  projectId: string; sessionId: string;
  statement: string; rationale: string;
  confidence: "hard_fact" | "inferred" | "assumption";
  tags?: string[]; agent?: string;
}) {
  const { data, error } = await db().from("DesignDecision").insert({
    sessionId: input.sessionId, projectId: input.projectId,
    statement: input.statement, rationale: input.rationale,
    confidence: input.confidence, tags: input.tags ?? null,
    createdBy: input.agent ?? "external",
  }).select("id, statement, status, confidence, tags, createdAt").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, decision: data };
}

// Factory existente passa a delegar
export function createRecordDecisionTool(sessionId: string, projectId: string) {
  return tool({
    description: "...",
    inputSchema: z.object({ statement: z.string(), /* ... */ }),
    execute: async ({ statement, rationale, confidence, tags }) =>
      recordDecision({ projectId, sessionId, statement, rationale, confidence, tags, agent: "vitor" }),
  });
}
```

**Pontos de cuidado:**
- `createdBy` no Vitor original é `"vitor"`; pelo MCP é o que vier no `agent` (default `"external"`). Pra auditoria saber quem criou o quê.
- `sessionId`/`projectId` passam de closure pra argumento. Toda função pura aceita scope explícito.
- Comportamento idêntico ao atual — só o "como" muda.

**Funções a extrair (15):** `recordDecision`, `reviseDecision`, `listDecisions`, `addOpenQuestion`, `resolveOpenQuestion`, `listOpenQuestions`, `listResearch`, `readBusinessContext`, `readSessionMemory`, `updateSessionMemory`, `readProjectMemory`, `updateProjectMemory`, `listProjectSessions`, `compactSessionToProject`, `mvpCheck`.

---

## 5. Variáveis de ambiente

Adicionar ao `.env` do app Vitor (e ao Vercel envs de prod/staging):

```bash
VITOR_MCP_TOKEN=<bearer-shared-secret>  # único novo
```

Já existem (reuso): `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DIRECT_URL`.

Gerar token: `openssl rand -hex 32`.

---

## 6. Cadastro no Volund OS

Após deploy do Vitor MCP no prod, INSERT em `mcp_servers` do Volund:

```sql
INSERT INTO mcp_servers (
  agent_id, name, server_url, transport_type,
  headers, enabled, tool_prefix
) VALUES (
  '<volund-agent-id>',                    -- agente do Volund que vai usar
  'Vitor (Perke design memory)',
  'https://<vitor-prod-domain>/api/mcp',
  'http',
  jsonb_build_object('Authorization', 'Bearer ' || '<VITOR_MCP_TOKEN>'),
  true,
  'vitor'
);
```

Resultado: Claude Code dentro do sandbox v2 do agente Volund passa a ver tools:
- `mcp__vitor__record_decision`
- `mcp__vitor__list_decisions`
- `mcp__vitor__list_open_questions`
- ... etc (15 totais)

**Convenção do prefixo:** chave `vitor` em `mcp.json` → Claude Code prefixa com `mcp__vitor__<toolname>`.

---

## 7. Testes

### 7.1 Unit — funções puras

Pra cada uma das 15 funções extraídas, teste mínimo:
- Happy path (insert/update sucesso)
- Validação de schema (input inválido)
- Cross-project guard (ex: `revise_decision` rejeitando id de outro projeto)
- Conflict de version (em `update_session_memory` / `update_project_memory`)

Local: `tests/unit/lib/agent/tools/memory.test.ts` (novo).

### 7.2 Integration — JSON-RPC envelope

`tests/integration/api/mcp/route.test.ts`:
- POST sem `Authorization` → 401
- POST com token errado → 401
- POST `{ jsonrpc: "1.0" }` → error -32600
- POST `tools/list` → retorna 15 schemas
- POST `tools/call` com tool inválida → error
- POST `tools/call` `record_decision` → 200 + linha em `DesignDecision`

### 7.3 E2E manual (smoke)

1. **Local + ngrok:**
```bash
ngrok http 3000  # → https://xxxx.ngrok.io
```

2. **Cadastra no Volund (staging primeiro):**
```sql
INSERT INTO mcp_servers (agent_id, name, server_url, transport_type, headers, enabled, tool_prefix)
VALUES (
  '<staging-agent-id>',
  'Vitor (dev via ngrok)',
  'https://xxxx.ngrok.io/api/mcp',
  'http',
  '{"Authorization":"Bearer <token>"}'::jsonb,
  true,
  'vitor'
);
```

3. **Chama no chat do agente Volund (v2):**
> "Liste decisions ativas do projeto `ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652`"

Expect:
- Claude Code dentro do sandbox chama `mcp__vitor__list_decisions({ projectId: "...", scope: "project", status: "active" })`
- Recebe array de decisions
- Responde narrativamente

4. **Validar persistência:**
```sql
SELECT cm.role, cm.parts FROM "ChatMessage" cm ORDER BY cm."createdAt" DESC LIMIT 3;
-- parts inclui tool-call mcp__vitor__list_decisions + tool-result
```

### 7.4 Adversarial

- `record_decision` sem `agent` no input → grava `createdBy: "external"` (não `"vitor"`).
- `update_session_memory` com `expectedVersion` errado → retorna `{ conflict: true, currentVersion, currentMd }`.
- Token rotativo: trocar `VITOR_MCP_TOKEN` em prod, sem atualizar `mcp_servers.headers` → tools começam a retornar 401, Claude Code reporta erro graciosamente.

---

## 8. Deploy

### 8.1 Onde

App Vitor é Next 16 deployado em Vercel (existente). Route handler é deploy automático — push pra branch `feat/vitor-mcp-server`, abre PR, mergeia, Vercel redeploya. **Zero infra nova.**

### 8.2 DNS / URL

Endpoint final: `https://<dominio-vitor>/api/mcp`. Sem subdomínio novo, sem cert novo.

### 8.3 Ordem de deploy

1. PR no Vitor com:
   - Refactor `memory.ts` + `mvp-check.ts` (extração de funções puras)
   - Route `/api/mcp` + auth + RPC + schemas
   - Testes unit + integration
2. Merge → deploy automático pro staging.
3. Adicionar `VITOR_MCP_TOKEN` no env de staging.
4. Smoke test com ngrok local primeiro, depois com URL de staging real.
5. Promote pra prod (mesmo PR, ambiente Vercel prod).
6. Adicionar `VITOR_MCP_TOKEN` no env de prod (rotação separada do staging).
7. INSERT em `mcp_servers` apontando pro Vitor prod.
8. Smoke test final com agente Volund de prod.

### 8.4 Observabilidade

- Cada `tools/call` loga: tool name, projectId/sessionId, tempo de execução, ok/error.
- Log de auth fail (sinal de token comprometido ou cliente mal configurado).
- Monitor de latência p95 — alarme se > 2s (queries deveriam ser <100ms).

---

## 9. Riscos & decisões finais

### 9.1 Risco — service-role bypass RLS

Tools escrevem usando service role (bypassa RLS). Cliente Volund pode em tese passar qualquer `projectId`/`sessionId`. Mitigação:
- Token Bearer é single-tenant interno (vocês) — sem multi-tenancy a impactar.
- `createdBy: "external"` deixa rastro de auditoria.
- Reusa as guardas já no código (ex: `revise_decision` rejeita id de outro projeto).

### 9.2 Risco — race condition em markdown memory

Volund e Vitor podem escrever markdown ao mesmo tempo. Mitigação: optimistic lock via `expectedVersion` já implementado. Em conflict, cliente relê e reaplica — comportamento testado.

### 9.3 Decisão — sem cache, sem rate limit, sem retry no MVP

Volund é único consumidor, uso esporádico, latência baixa. Adicionar complexidade fora do necessário. Se observabilidade mostrar abuse, adicionar depois.

### 9.4 Decisão — não exportar `search_doc`, `web_search`

`web_search` é hook auto-captura interno do Vitor. Volund chamando direto fura o pipeline. Se Volund precisar pesquisar, usa WebSearch nativo do Claude Code dentro do sandbox.

### 9.5 Decisão — sem OAuth, só Bearer

OAuth seria pra multi-tenant (per-user). Aqui é ferramenta interna, single tenant — Bearer compartilhado por ambiente é suficiente. Se evoluir pra multi-tenant, troca pra OAuth (Volund já suporta nativamente via `lib/mcp/oauth.ts`).

### 9.6 Decisão — `update_session_memory` / `update_project_memory` ficam expostas

Originalmente pensei em travar (governance: "Vitor é dono da narrativa"). Repensei: Volund pode ter casos legítimos de append (ex: "Vitor terminou session, vou pingar aprendizado pra outro projeto similar"). Mantém exposto **com nota na description** alertando o LLM cliente que cuidado com sobrescrita.

---

## 10. Out of scope

- **Tools de hierarquia** (modules/stories/tasks/personas) — território exclusivo do Vitor.
- **Streaming SSE** — JSON-RPC stateless suficiente; SSE seria pra notificações push, fora do caso.
- **Multi-tenant OAuth** — Bearer single-tenant resolve hoje.
- **Tool: search semantic** (pgvector em decisions/research) — futuro.
- **Webhook out** (notificar app Vitor quando Volund escreve) — futuro; UI atualiza no próximo refresh.
- **Patch no Volund OS** — assumido feito (não é deste repo).

---

## 11. Critério de aceite

- [ ] 15 funções puras extraídas de `memory.ts` + `mvp-check.ts`, testadas unit.
- [ ] Factories existentes (`createRecordDecisionTool` etc) delegam pras funções puras sem mudança de comportamento (zero regressão no Vitor original).
- [ ] Route `/api/mcp` responde `initialize`, `tools/list` (15 tools), `tools/call`.
- [ ] Auth Bearer funcionando — 401 em falta/erro de token.
- [ ] Conflict optimistic-lock funciona em `update_session_memory` (`expectedVersion`).
- [ ] Smoke E2E: agente Volund v2 com Vitor MCP cadastrado consegue `list_decisions` + `record_decision` no projeto teste.
- [ ] Logs estruturados em cada tool call.
- [ ] `VITOR_MCP_TOKEN` no env de staging e prod.
- [ ] `mcp_servers` cadastrado no Volund (staging + prod).

---

## 12. Estimativa

| Fase | Tempo |
|---|---|
| Refactor `memory.ts` + `mvp-check.ts` (15 funções) | 3h |
| Route + auth + RPC + schemas | 2h |
| Tests unit (15 fns) + integration (RPC) | 3h |
| Smoke E2E local (ngrok + staging Volund) | 1h |
| Deploy staging + cadastro + validar | 1h |
| Deploy prod + cadastro + validar | 1h |
| **Total** | **~11h** |

---

## 13. Próximas perguntas (depois deste plano rodar)

1. **Quem vai usar?** Você direto, ou outros membros do time? Cada membro tem agente Volund próprio?
2. **Quais agentes Volund vão ter Vitor MCP cadastrado?** Um geral ("Volund Ops") ou múltiplos especializados?
3. **Compact ao fim de session — Volund pode disparar?** Hoje só Vitor faz no flow dele. Volund podendo chamar `compact_session_to_project` permite "Volund consolida aprendizado de session X em project memory" via chat.
4. **Read da hierarquia (modules/stories/tasks counts)** — vale uma tool `read_project_overview` read-only no futuro? Útil pra Volund saber "o que existe".
