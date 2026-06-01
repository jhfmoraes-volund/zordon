# PRD — Chat via Claude Code local (MVP)

**Reference**: ZMC-LOCAL
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Substitui (em MVP)**: docs/prd/backlog/_future/zordon-mcp/ (4 PRDs congelados)

## §1 Problema

1. Vitor/Vitoria/Alpha rodam 100% via OpenRouter pago pela Volund — custo cresce linear com uso.
2. O João já paga Claude Pro/Max — usar **a subscription dele** local resolve custo e qualidade ao mesmo tempo.
3. Hoje não há toggle no produto: o usuário não escolhe modelo. Pra dogfood antes de escalar pra time, precisa de uma forma simples de alternar.

## §2 Solução em uma frase

Toggle em `/settings/agents` por agente (OpenRouter | Claude Daemon); quando ativo, mensagens viram `ChatTurn` que o daemon local pega, roda `claude -p` com MCP server stdio, e streamea de volta via Supabase Realtime.

## §3 Não-objetivos

- Multi-user / outros PMs com daemon (fica em PRDs `_future/zordon-mcp/`).
- Repo `zordon-mcp` separado — daemon continua em `scripts/forge/`.
- Auth Bearer / `DaemonToken` — daemon usa `SUPABASE_SERVICE_ROLE_KEY` como hoje.
- LaunchAgent / auto-start.
- Telemetria + dashboard `/admin/metrics`.
- Vitoria e Alpha funcionando — esta PRD entrega só **Vitor**. Os outros 2 ficam **visíveis e desabilitados** na settings ("MCP tools pendentes").

## §4 Personas e jornada

- **João (PM Volund)**: "Quero usar minha subscription Claude pra Vitor sem mudar nada na UI do chat."

## §5 Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | Toggle vive em `/settings/agents`, **não** no chat | UI do chat fica intocada; decisão estável, debug trivial |
| D2 | `AgentMode (userId, agentSlug)` global por user — sem `threadId` | Decisão por agente, não por conversa. Simplifica RX |
| D3 | Daemon segue em `scripts/forge/daemon.ts`, sem extração de repo | Local-only; service_role do daemon é OK |
| D4 | Sem Bearer auth nova — daemon usa `db()` direto (mesmo padrão atual) | MVP local não justifica camada HTTP |
| D5 | `ForgeJob.kind ∈ {forge, chat}` (extensão, não tabela nova) | Reusa claim loop existente |
| D6 | Tabelas novas: `ChatTurn`, `ChatTurnEvent`, `AgentMode` | Semântica de turn é distinta de ForgeRun |
| D7 | Streaming via Supabase Realtime em `ChatTurnEvent` | Infra já existe; UI subscribe normal |
| D8 | Fallback automático: daemon offline → OpenRouter no próximo turn + toast | Resilience sem mascarar problema |
| D9 | Vitoria/Alpha **visíveis** em settings com dropdown **desabilitado** + tooltip "MCP tools pendentes" | Sinaliza roadmap sem prometer "agora" |
| D10 | MCP server stdio long-lived (1 por daemon, spawn no startup) | Cold start <500ms por turn é inaceitável |
| D11 | Tools chamam de volta o Zordon via HTTP `POST /api/agents/tools/:toolName` | Single source of truth no DB; MCP é proxy fino |
| D12 | System prompt do Vitor lido server-side e snapshotado em `ChatTurn.systemPrompt` | Permite versionar prompts sem deploy do daemon |

## §6 Arquitetura

```
[Chat do Vitor (UI atual)] — sem mudança visual
         │
         │ user manda mensagem
         ▼
POST /api/chat/turns
         │
         ├─► lê AgentMode(userId, 'vitor')
         │
         ├─► mode='openrouter' → comportamento atual (stream SSE)
         │
         └─► mode='claude-daemon':
              ├─► INSERT Message (user)
              ├─► INSERT ChatTurn (status='queued', systemPrompt snapshot)
              ├─► INSERT ForgeJob (kind='chat', payload={chatTurnId})
              └─► Returns: 202 { chatTurnId }
         │
         ▼
[UI subscribe Realtime: ChatTurnEvent WHERE turnId=...]
         │
[scripts/forge/daemon.ts]
   claim job (filtro kind=chat)
   spawn scripts/forge/exec-chat-turn.ts
         │
         ▼
exec-chat-turn:
   spawn `claude -p "<prompt>" \
     --mcp-config /tmp/mcp-vitor-<turnId>.json \
     --output-format stream-json`
         │
         ├─► stream-json deltas → INSERT ChatTurnEvent → Realtime broadcast
         │
         └─► MCP server (long-lived child do daemon):
               recebe tool_use via stdio
                  │
                  └─► POST /api/agents/tools/create_prd_skeleton
                        │
                        └─► cria ProductRequirement no DB
```

## §7 Schema

```sql
-- 1. Job kind
ALTER TABLE "ForgeJob"
  ADD COLUMN "kind" text NOT NULL DEFAULT 'forge'
    CHECK ("kind" IN ('forge', 'chat'));
CREATE INDEX "ForgeJob_kind_status_idx" ON "ForgeJob" ("kind", "status");

-- 2. ChatTurn (1 mensagem do user → 1 resposta do agente)
CREATE TABLE "ChatTurn" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "threadId" uuid NOT NULL REFERENCES "Thread"(id) ON DELETE CASCADE,
  "userMessageId" uuid NOT NULL REFERENCES "Message"(id) ON DELETE CASCADE,
  "agentSlug" text NOT NULL,
  "mode" text NOT NULL CHECK ("mode" IN ('claude-daemon', 'openrouter')),
  "systemPrompt" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued'
    CHECK ("status" IN ('queued', 'running', 'done', 'error', 'aborted')),
  "claimedBy" uuid REFERENCES "ForgeDaemon"(id) ON DELETE SET NULL,
  "startedAt" timestamptz,
  "endedAt" timestamptz,
  "responseMessageId" uuid REFERENCES "Message"(id) ON DELETE SET NULL,
  "tokensIn" int,
  "tokensOut" int,
  "costUsd" numeric(10, 6),
  "errorReason" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ChatTurn_status_idx" ON "ChatTurn" ("status");
CREATE INDEX "ChatTurn_threadId_idx" ON "ChatTurn" ("threadId");

ALTER TABLE "ChatTurn" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_turn_thread_member" ON "ChatTurn"
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM "Thread" t WHERE t.id = "threadId" AND t."memberId" = auth.uid())
  );

-- 3. ChatTurnEvent (deltas de stream pra Realtime)
CREATE TABLE "ChatTurnEvent" (
  "turnId" uuid NOT NULL REFERENCES "ChatTurn"(id) ON DELETE CASCADE,
  "seq" int NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb,
  "ts" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("turnId", "seq")
);
ALTER TABLE "ChatTurnEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_turn_event_thread_member" ON "ChatTurnEvent"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "ChatTurn" ct
      JOIN "Thread" t ON t.id = ct."threadId"
      WHERE ct.id = "turnId" AND t."memberId" = auth.uid()
    )
  );

-- 4. AgentMode (preferência global por user + agente)
CREATE TABLE "AgentMode" (
  "userId" uuid NOT NULL REFERENCES "Member"(id) ON DELETE CASCADE,
  "agentSlug" text NOT NULL,
  "mode" text NOT NULL DEFAULT 'openrouter'
    CHECK ("mode" IN ('claude-daemon', 'openrouter')),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "agentSlug")
);
ALTER TABLE "AgentMode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_mode_owner" ON "AgentMode"
  FOR ALL USING ("userId" = auth.uid())
  WITH CHECK ("userId" = auth.uid());
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/chat/turns` | Body: `{threadId, message, agentSlug}` → branch por AgentMode → 202+`{chatTurnId}` (claude-daemon) ou 200+stream (openrouter) |
| GET | `/api/chat/turns/:id` | Returns: turn + events (hidratação inicial) |
| POST | `/api/daemon/chat-turns/:id/event` | Body: `{kind, payload}` → server atribui seq → 204 |
| POST | `/api/daemon/chat-turns/:id/complete` | Body: `{ok, errorReason?, tokensIn?, tokensOut?, costUsd?, responseText}` → cria Message(assistant), marca turn done |
| GET | `/api/agent-mode` | Returns: `[{agentSlug, mode}]` pro user atual |
| PUT | `/api/agent-mode` | Body: `{agentSlug, mode}` → 204 |
| GET | `/api/daemon/status` | Returns: `{daemonsActive: [{id, hostname, lastHeartbeatAt}]}` |
| POST | `/api/agents/tools/:toolName` | Body: `{args, chatTurnId}` → executa tool, retorna `{result}` ou `{error}` |

## §9 UX

### `/settings/agents` (página nova)

```
┌──────────────────────────────────────────────────────────┐
│ Configurações > Agentes                                  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ Daemon local                                             │
│   ● Online · dmn_5xK2 · heartbeat 12s atrás             │
│   [Testar conexão]                                       │
│                                                          │
│ ──────────────────────────────────────────────────────  │
│                                                          │
│ Vitor       [▾ Claude Daemon         ]                  │
│ Vitoria     [▾ OpenRouter ─ disabled ]  ⓘ MCP pendente │
│ Alpha       [▾ OpenRouter ─ disabled ]  ⓘ MCP pendente │
│                                                          │
│ ℹ Daemon offline → cai automático pra OpenRouter no     │
│   próximo turn (toast informativo).                      │
└──────────────────────────────────────────────────────────┘
```

Chat UI dos 3 agentes fica **intocada**.

## §10 Integrações

- `scripts/forge/daemon.ts`: ganha branch por `job.kind`; spawna `exec-chat-turn.ts` quando kind=chat.
- `ConversationPanel`: lê `AgentMode` via hook; branches entre `useChat` (openrouter, atual) e `useDaemonChat` (claude-daemon, novo). Sem mudança visual.
- Tools do Vitor existentes (`src/lib/agent/tools/vitor/` se houver) viram endpoints `POST /api/agents/tools/:toolName`.

## §11 Faseamento

Esta PRD ship em 4 fases internas (não separa em PRDs):

- **A — Schema + APIs** (stories 1-4)
- **B — Daemon executa chat sem MCP** (stories 5-7)
- **C — Settings UI** (stories 8-9) → checkpoint: Vitor responde via Claude CLI puro
- **D — MCP + tools** (stories 10-13) → checkpoint final: Vitor cria PRD via chat

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Claude CLI cold start mata UX (>3s primeiro token) | A | M | Aceita ~2s no MVP; warm pool fica pra `_future/` |
| MCP server crasha mid-turn | M | A | Daemon monitora processo + restart on crash; turn vira error |
| Tool retorna dado sensível (PII) | M | A | Tools sempre filtram via DAL com checks de acesso por user |
| Daemon offline silencioso | M | M | Fallback automático + toast + indicador na settings |
| stream-json parser quebra com Claude CLI release nova | B | A | Pin version em package.json; smoke `zordon-mcp test` (futuro) detecta |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Turns claude-daemon vs openrouter (Vitor) | `SELECT mode, count(*) FROM "ChatTurn" WHERE "agentSlug"='vitor' GROUP BY mode` |
| Latência primeiro-token P50/P95 | Coluna `firstTokenAt` em ChatTurn (calculada a partir do primeiro event); query SQL |
| Fallback rate | `SELECT count(*) FILTER(WHERE "errorReason"='daemon_offline') / count(*) FROM "ChatTurn" WHERE mode='claude-daemon'` |
| Tools usadas por turn | `SELECT count(*) FROM "ChatTurnEvent" WHERE kind='tool_use' GROUP BY "turnId"` |

## §14 Open questions

(vazio — tudo resolvido em §5)

## §15 Referências

- Memory `project_vitor_mcp_volund_v2.md` — direção decidida.
- Memory `project_agent_ui_parity.md` — ConversationPanel compartilhado.
- Claude CLI: https://docs.claude.com/en/docs/claude-code
- MCP spec: https://spec.modelcontextprotocol.io/specification/
- PRDs futuros: [_future/zordon-mcp/](_future/zordon-mcp/)

## §16 Stories implementáveis

```yaml
- id: ZMC-LOCAL-001
  title: Migration — ChatTurn + ChatTurnEvent + AgentMode + ForgeJob.kind
  description: Migration única adicionando 3 tabelas + ALTER em ForgeJob conforme §7. RLS conforme spec.
  acceptanceCriteria:
    - "Migration <data>_chat_via_claude_local.sql aplica sem erro"
    - "ForgeJob.kind tem CHECK pra ('forge','chat')"
    - "ChatTurnEvent PK composta (turnId, seq)"
    - "RLS habilitado nas 3 tabelas novas; policies thread-member para ChatTurn/Event"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('ChatTurn','ChatTurnEvent','AgentMode')"
      expected: "3"
    - kind: sql
      command_or_query: "SELECT column_name FROM information_schema.columns WHERE table_name='ForgeJob' AND column_name='kind'"
      expected: "kind"
  dependsOn: []
  estimateMinutes: 25
  touches: ["supabase/migrations/"]

- id: ZMC-LOCAL-002
  title: Endpoint POST /api/chat/turns + DAL
  description: Branch por AgentMode. Se claude-daemon → cria ChatTurn (queued) + ForgeJob (kind=chat) + retorna 202. Se openrouter → mantém comportamento atual (SSE stream). Snapshot systemPrompt do AgentDefinition em ChatTurn.systemPrompt.
  acceptanceCriteria:
    - "POST com agentSlug=vitor + AgentMode=claude-daemon retorna 202 + chatTurnId"
    - "ForgeJob criado com kind=chat e payload.chatTurnId"
    - "ChatTurn.systemPrompt populado por snapshot"
    - "Fallback: daemon offline → muda mode internamente pra openrouter + header X-Mode-Fallback=true"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-LOCAL-001]
  estimateMinutes: 30
  touches: ["src/app/api/chat/turns/route.ts", "src/lib/dal/chat-turn.ts"]

- id: ZMC-LOCAL-003
  title: Endpoints daemon — event + complete
  description: POST /api/daemon/chat-turns/:id/event (server-side seq via MAX+1 atomic + Realtime trigger automatic via INSERT). POST /complete cria Message(assistant) e marca turn done. Sem Bearer auth (daemon local usa db direto pelo NEXT_PUBLIC_SUPABASE_URL/SERVICE_ROLE).
  acceptanceCriteria:
    - "POST event grava ChatTurnEvent com seq monotônico (zero colisão em concorrência)"
    - "POST complete cria Message(role=assistant, threadId=ChatTurn.threadId) e marca turn done + ChatTurn.responseMessageId populado"
    - "Tokens/cost gravados se passados no payload"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-LOCAL-002]
  estimateMinutes: 30
  touches: ["src/app/api/daemon/chat-turns/"]

- id: ZMC-LOCAL-004
  title: API + hook AgentMode
  description: GET /api/agent-mode (retorna lista do user atual), PUT /api/agent-mode (upsert). Hook useAgentMode(agentSlug) com cache local.
  acceptanceCriteria:
    - "GET retorna [{agentSlug, mode}] do user atual; agentes sem registro default 'openrouter'"
    - "PUT upsert e retorna 204"
    - "useAgentMode hook expõe {mode, setMode, isLoading}"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-LOCAL-001]
  estimateMinutes: 25
  touches: ["src/app/api/agent-mode/route.ts", "src/hooks/use-agent-mode.ts"]

- id: ZMC-LOCAL-005
  title: scripts/forge/exec-chat-turn.ts — Claude CLI puro (sem MCP)
  description: Script recebe chatTurnId via env. Lê ChatTurn do DB. Spawn claude -p com systemPrompt + userMessage. Parseia stream-json delta-by-delta, INSERT ChatTurnEvent (kind='text_delta') por delta. POST complete ao final.
  acceptanceCriteria:
    - "scripts/forge/exec-chat-turn.ts existe e roda standalone"
    - "Cada delta de stream-json vira 1 ChatTurnEvent"
    - "result event extrai tokensIn/Out/costUsd"
    - "Sem dependência de MCP nesta story"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-LOCAL-003]
  estimateMinutes: 30
  touches: ["scripts/forge/exec-chat-turn.ts"]

- id: ZMC-LOCAL-006
  title: Daemon loop kind dispatch
  description: scripts/forge/daemon.ts no claim job branch por job.kind. kind=forge → exec-prd.ts (atual). kind=chat → exec-chat-turn.ts.
  acceptanceCriteria:
    - "Daemon claim aceita jobs com kind=chat (não filtra fora)"
    - "Branch por kind dispara o script correto"
    - "Jobs forge continuam funcionando sem regressão"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-LOCAL-005]
  estimateMinutes: 25
  touches: ["scripts/forge/daemon.ts"]

- id: ZMC-LOCAL-007
  title: Hook useDaemonChat — Realtime subscribe
  description: Hook React recebe chatTurnId; subscribe ChatTurnEvent via Supabase Realtime (postgres_changes); acumula text_deltas em string; retorna {messages, status, send} compatível shape com useChat (AI SDK) pra plug-and-play.
  acceptanceCriteria:
    - "Hook subscreve canal ChatTurnEvent filtrado por turnId"
    - "Tokens concatenam progressivamente em UI"
    - "status reflete queued|running|done|error|aborted"
    - "Unsubscribe limpo no unmount"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-LOCAL-003]
  estimateMinutes: 30
  touches: ["src/hooks/use-daemon-chat.ts"]

- id: ZMC-LOCAL-008
  title: Página /settings/agents
  description: Lista 3 agentes (Vitor/Vitoria/Alpha) com Select OpenRouter|Claude Daemon. Vitoria/Alpha disabled com tooltip "MCP tools pendentes" (lê AgentDefinition.mcpAvailable). Status do daemon online/offline no topo. Botão "Testar conexão".
  acceptanceCriteria:
    - "Página renderiza pra usuários access_level>=manager"
    - "Vitor com Select habilitado; Vitoria/Alpha disabled com tooltip"
    - "Daemon status (heartbeat <60s = online) visível"
    - "Botão testar conexão faz GET /api/daemon/status e mostra resultado"
    - "Salva via PUT /api/agent-mode com optimistic update"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-LOCAL-004]
  estimateMinutes: 30
  touches: ["src/app/(dashboard)/settings/agents/page.tsx"]

- id: ZMC-LOCAL-009
  title: ConversationPanel branch por mode
  description: ConversationPanel lê AgentMode via hook; se claude-daemon, usa useDaemonChat (subscribe Realtime); senão usa useChat (atual). Sem mudança visual no chat. send() faz POST /api/chat/turns que server-side decide branch.
  acceptanceCriteria:
    - "ConversationPanel troca de hook conforme AgentMode"
    - "Mensagens anteriores permanecem visíveis ao trocar mode em settings (sem reset)"
    - "Zero mudança visual no UI do chat"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-LOCAL-007, ZMC-LOCAL-008]
  estimateMinutes: 30
  touches: ["src/components/ui/conversation/conversation-panel.tsx"]

- id: ZMC-LOCAL-010
  title: scripts/forge/mcp-server.ts — stdio skeleton
  description: MCP server stdio conforme spec MCP. Lê env AGENT_SLUG. list_tools retorna tools do agente (fixo: 5 do Vitor nesta PRD). tools/call dispatcha pra POST /api/agents/tools/:toolName.
  acceptanceCriteria:
    - "Server arranca com tsx scripts/forge/mcp-server.ts"
    - "Responde initialize handshake JSON-RPC"
    - "list_tools retorna 5 tools do Vitor"
    - "tools/call routea via undici/fetch pra Zordon"
  verifiable:
    - kind: manual_browser
      command_or_query: "AGENT_SLUG=vitor npx tsx scripts/forge/mcp-server.ts < scripts/forge/tests/initialize.json"
      expected: "responde capabilities + tools list válida"
  dependsOn: []
  estimateMinutes: 30
  touches: ["scripts/forge/mcp-server.ts", "scripts/forge/tests/initialize.json"]

- id: ZMC-LOCAL-011
  title: Daemon spawn MCP server long-lived + exec-chat-turn --mcp-config
  description: daemon.ts startup spawna 1 mcp-server.ts como child (AGENT_SLUG=vitor por enquanto). exec-chat-turn gera /tmp/mcp-config-<turnId>.json apontando pro server e passa --mcp-config pra claude CLI.
  acceptanceCriteria:
    - "Daemon log mostra 'MCP server up' ao startup"
    - "MCP server reinicia automático se crashar (max 5 retries)"
    - "exec-chat-turn gera mcp-config válido (JSON com command+args)"
    - "claude CLI é invocada com --mcp-config"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-LOCAL-005, ZMC-LOCAL-010]
  estimateMinutes: 30
  touches: ["scripts/forge/daemon.ts", "scripts/forge/exec-chat-turn.ts"]

- id: ZMC-LOCAL-012
  title: Tool router + 5 tools do Vitor
  description: POST /api/agents/tools/:toolName valida input via Zod, dispatch pra handler. 5 tools: create_prd_skeleton, update_prd_status, search_memory, read_meeting_transcript, list_design_sessions. Cada uma valida acesso (user pertence ao projeto do recurso).
  acceptanceCriteria:
    - "Router POST /api/agents/tools/:toolName existe; 404 pra tool desconhecida"
    - "Os 5 endpoints validam args via Zod"
    - "create_prd_skeleton cria ProductRequirement status=draft"
    - "search_memory faz busca em DesignSessionMemory por keywords"
    - "Retorna shape {ok: true, result: ...} ou {ok: false, error: '...'}"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-LOCAL-001]
  estimateMinutes: 30
  touches: ["src/app/api/agents/tools/[toolName]/route.ts", "src/lib/agent/tools/vitor/"]

- id: ZMC-LOCAL-013
  title: Smoke end-to-end — Vitor cria PRD via chat
  description: Configura Vitor=claude-daemon em /settings/agents. No chat do Vitor diz "crie PRD pra feature notificações push". Vitor invoca create_prd_skeleton via MCP. ProductRequirement aparece no DB. Resposta do Vitor referencia o PRD criado. Resposta streama em tempo real.
  acceptanceCriteria:
    - "Mensagem do user dispara ChatTurn com mode=claude-daemon"
    - "ChatTurnEvent inclui ≥1 kind=tool_use"
    - "ProductRequirement com status=draft existe no DB"
    - "Stream renderiza tokens progressivamente (não one-shot)"
    - "Toggle pra openrouter funciona; nova mensagem usa openrouter"
  verifiable:
    - kind: manual_browser
      command_or_query: "Configurar Vitor=claude-daemon, mandar 'crie PRD pra notificações push' no chat"
      expected: "PRD criado + visível na resposta + streaming visível"
  dependsOn: [ZMC-LOCAL-006, ZMC-LOCAL-009, ZMC-LOCAL-011, ZMC-LOCAL-012]
  estimateMinutes: 30
  touches: ["(end-to-end test)"]
```

**Total: 13 stories, ~375min (~6h15).**
