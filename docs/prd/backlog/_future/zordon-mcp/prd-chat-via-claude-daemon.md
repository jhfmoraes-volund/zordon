# PRD — Chat de agente via Claude Daemon

**Reference**: ZMC-CHAT
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Depende de**: prd-zordon-mcp-extract (daemon + auth de Bearer token prontos)

## §1 Problema

1. Vitor/Vitoria/Alpha hoje rodam 100% via OpenRouter pago pela Volund. Custo cresce linear com uso.
2. OpenRouter limita qualidade: tools custom, parsing JSON menos confiável, context window menor que Claude.
3. PM já paga Claude Pro/Max — usar **a subscription dele** pra agentes resolve custo e qualidade ao mesmo tempo.
4. Hoje não há toggle no chat: usuário não escolhe modelo. Faz sentido oferecer escolha por thread (sticky).

## §2 Solução em uma frase

Adiciona modo de execução "Claude Daemon" no chat dos 3 agentes — quando ativo, mensagens viram `ChatTurn` em vez de stream OpenRouter, daemon do PM pega job, roda `claude -p` localmente e streamea resposta via Realtime.

## §3 Não-objetivos

- MCP server com tools custom — fica em PRD `zordon-mcp-server`. Esta PRD usa Claude CLI **sem** MCP (só system prompt + texto livre).
- Daemon central no servidor Volund — fica explícito como "local-only" nesta fase.
- Fallback inteligente baseado em latência. Por enquanto: daemon offline → OpenRouter.
- Custom tools dentro do Claude CLI. Por enquanto, agente só responde texto (chat puro).

## §4 Personas e jornada

- **PM (João, futura squad)**: "Quero usar minha subscription Claude no chat com Vitor pra ter melhor qualidade e não onerar Volund."
- **Builder Zordon**: "Quero reaproveitar a infra do daemon Forge pra processar chat sem reescrever do zero."

## §5 Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | `ForgeJob.kind` ganha valor `'chat'` (atual = `'forge'`) | Reusa fila e claim loop existente. Daemon filtra `?kind=` no claim. |
| D2 | Novas tabelas `ChatTurn` + `ChatTurnEvent` (separadas de ForgeEvent) | Semântica diferente: turn é unit, event é granular dentro do turn. ForgeEvent é por run/story. |
| D3 | `AgentMode (userId, agentSlug, threadId, mode)` — preferência **per-thread** sticky | Toggle escolhe ao abrir/criar thread; mantém o mesmo modelo até reiniciar conversa. Previsível. |
| D4 | Streaming via Supabase Realtime em `ChatTurnEvent` (postgres_changes) | Reusa infra Realtime já existente. UI subscribe e renderiza token a token. |
| D5 | Fallback: daemon sem heartbeat há >60s → mostra modo `claude-daemon` com badge "offline" e cai pra OpenRouter no próximo turn (não silenciosa: toast informa) | Resilência sem mascarar problema. |
| D6 | Side sheet `DaemonStatusSheet` (ResponsiveSheet size=sm) | Padrão UI do projeto. |
| D7 | Toggle visualmente: pequeno ícone no header do chat (modelo) — click abre sheet | Minimalista. Não polui o chat. |
| D8 | Fase 2 (esta PRD) cobre apenas **Vitor**. Vitoria e Alpha vêm em PRD `zordon-mcp-server` (com tools). | Vitor é texto-pesado; tools são opcionais. Outros agentes dependem mais de tools. |
| D9 | Persistência de mensagem do user: continua em `Thread` + `Message` (modelos atuais). `ChatTurn` referencia `messageId` | Não duplica fonte de mensagem. |
| D10 | Claude CLI chamado com `claude -p "..."` (sem `--mcp-config` nesta fase) | MCP entra na próxima PRD. Aqui é texto + system prompt. |
| D11 | System prompt do Vitor carregado server-side e passado no `ChatTurn.systemPrompt` (snapshot imutável) | Permite versionamento de prompts; daemon não precisa conhecer prompt — só executa. |
| D12 | Token usage + custo registrados em `ChatTurn.tokensIn/tokensOut/costUsd` (lidos do `result` event do Claude CLI) | Auditoria de uso por agente/user. |

## §6 Arquitetura

```
[User digita "Olá Vitor" no chat]
         │
         ▼
[ConversationPanel] — toggle "Claude Daemon" ON
         │
         ▼
POST /api/chat/turns
  body: { threadId, message, agentSlug, mode: 'claude-daemon' }
         │
         ├─► INSERT Message (user)
         ├─► INSERT ChatTurn (status='queued', systemPrompt snapshot)
         ├─► INSERT ForgeJob (kind='chat', payload={chatTurnId})
         └─► Returns: { chatTurnId }
         │
         ▼
[UI] subscribe Realtime: ChatTurnEvent WHERE turnId=chatTurnId
         │
         ▼ (in parallel, no laptop do PM)
[zordon-mcp daemon]
  POST /api/daemon/jobs/claim?kind=chat
       │
       ▼ (job claimed)
[scripts/exec-chat-turn.ts]
       │
       ▼
spawn `claude -p "<systemPrompt>\n\n<userMessage>" --output-format stream-json`
       │
       ▼ (cada delta)
[stream parser] → POST /api/daemon/chat-turns/:id/event
       │            body: { kind: 'text_delta', payload: { text: '...' } }
       ▼
[Supabase] INSERT ChatTurnEvent → triggers Realtime broadcast
       │
       ▼
[UI] renderiza token-by-token (mesma UX de useChat)
       │
       ▼ (ao final)
POST /api/daemon/chat-turns/:id/complete
  body: { ok, tokensIn, tokensOut, costUsd }
       │
       ▼
ChatTurn.status = 'done' → INSERT Message (assistant) → UI tira spinner
```

## §7 Schema

```sql
-- Estender ForgeJob com kind
ALTER TABLE "ForgeJob"
  ADD COLUMN "kind" text NOT NULL DEFAULT 'forge'
    CHECK ("kind" IN ('forge', 'chat'));
CREATE INDEX "ForgeJob_kind_status_idx" ON "ForgeJob" ("kind", "status");

-- Turn = uma mensagem do user + uma resposta esperada do agente
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

-- Event granular (deltas de stream)
CREATE TABLE "ChatTurnEvent" (
  "turnId" uuid NOT NULL REFERENCES "ChatTurn"(id) ON DELETE CASCADE,
  "seq" int NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb,
  "ts" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("turnId", "seq")
);
CREATE INDEX "ChatTurnEvent_turnId_seq_idx" ON "ChatTurnEvent" ("turnId", "seq");

ALTER TABLE "ChatTurnEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_turn_event_thread_member" ON "ChatTurnEvent"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "ChatTurn" ct
      JOIN "Thread" t ON t.id = ct."threadId"
      WHERE ct.id = "turnId" AND t."memberId" = auth.uid()
    )
  );

-- Preferência de modo por thread
CREATE TABLE "AgentMode" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "Member"(id) ON DELETE CASCADE,
  "threadId" uuid REFERENCES "Thread"(id) ON DELETE CASCADE,
  "agentSlug" text NOT NULL,
  "mode" text NOT NULL DEFAULT 'openrouter'
    CHECK ("mode" IN ('claude-daemon', 'openrouter')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "threadId", "agentSlug")
);
CREATE INDEX "AgentMode_userId_idx" ON "AgentMode" ("userId");

ALTER TABLE "AgentMode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_mode_owner" ON "AgentMode"
  FOR ALL USING ("userId" = auth.uid())
  WITH CHECK ("userId" = auth.uid());
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/chat/turns` | Body: `{threadId, message, agentSlug, mode}` → Returns: `{chatTurnId}` (202 quando mode=claude-daemon; 200+stream quando mode=openrouter) |
| POST | `/api/daemon/jobs/claim?kind=chat` | (já existe da PRD ext) Retorna `ChatTurn` + thread context |
| POST | `/api/daemon/chat-turns/:id/event` | Body: `{kind, payload}` (server atribui seq) → 204 |
| POST | `/api/daemon/chat-turns/:id/complete` | Body: `{ok, errorReason?, tokensIn?, tokensOut?, costUsd?, responseText}` → 204 |
| GET | `/api/chat/turns/:id` | Returns: turn + events array (pra hidratação inicial antes do Realtime conectar) |
| GET | `/api/agent-mode?agentSlug=...&threadId=...` | Returns: `{mode}` ou default `'openrouter'` |
| PUT | `/api/agent-mode` | Body: `{agentSlug, threadId, mode}` → 204 |
| GET | `/api/daemon/status` | Returns: `{daemonsActive: [{id, hostname, lastHeartbeatAt}]}` — usado pelo DaemonStatusSheet |

## §9 UX

### Toggle no header do chat

```
┌────────────────────────────────────────────────────────┐
│ Vitor                            [claude-daemon ●]  ⋮  │  ← ícone clica = abre sheet
│ ─────────────────────────────────────────────────────  │
│ ...mensagens do chat...                                │
└────────────────────────────────────────────────────────┘
```

Ícone:
- `●` (verde) — claude-daemon ativo + daemon online
- `◐` (amarelo) — claude-daemon ativo + daemon offline (vai cair pra OpenRouter)
- `○` (cinza) — openrouter

### DaemonStatusSheet (ResponsiveSheet sm)

```
┌─────────────────────────────────┐
│ Modo do chat — Vitor            │
│ ─────────────────────────────── │
│                                 │
│ ○ OpenRouter                    │
│   Padrão. Volund paga tokens.   │
│                                 │
│ ● Claude Daemon                 │
│   Sua subscription Claude.      │
│   ✓ dmn_5xK2 online · 12s ago   │
│   [Testar conexão]              │
│                                 │
│ ─────────────────────────────── │
│ Sem daemon? Instale:            │
│ → /settings/daemon              │
└─────────────────────────────────┘
```

## §10 Integrações

- **Daemon zordon-mcp**: precisa de novo entrypoint `exec-chat-turn.ts` + claim com kind=chat (PRD ext expôs filtro).
- **Vitor agent definition** (`src/lib/agent/agents/vitor`): system prompt extraído em arquivo legível pra snapshot em `ChatTurn.systemPrompt`.
- **ConversationPanel**: adiciona `mode` prop + hook decisor `useDaemonChat | useOpenRouterChat`.
- **Realtime**: subscribe canal `chat_turn_event:turn_id=eq.<id>`.

## §11 Faseamento

Fase 2 (esta PRD):
1. Schema (3 tabelas + 1 ALTER em ForgeJob) → migrations atômicas
2. API server-side (turns/events/complete/agent-mode)
3. exec-chat-turn.ts no zordon-mcp + stream parser
4. UI: toggle + sheet + hook useDaemonChat
5. Vitor exclusivamente (Vitoria/Alpha ficam pra Fase 3 quando MCP tools entram)
6. Smoke: PM seleciona Claude Daemon no chat do Vitor, manda 3 mensagens, vê stream funcionando

Fase 3+: MCP server (Vitor com tools), Vitoria/Alpha — PRD separadas.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Claude CLI cold start mata UX (>3s pra primeiro token) | A | M | Daemon mantém 1 processo `claude` warm idle (TODO Fase 4); por enquanto aceita ~2s |
| User troca thread enquanto turn rodando → eventos chegam pro turn errado | M | M | Subscribe canal filtra por `turnId`; turn cancelado vira status=aborted; daemon termina graciosamente |
| Daemon do PM crasha mid-turn → turn fica em `running` pra sempre | M | M | Heartbeat updates turn status; quando daemon some, sweeper move running→aborted após 5min |
| OpenRouter fallback automatic perde contexto do thread | B | A | Fallback re-envia histórico completo, é função idempotente |
| RLS em ChatTurn/Event quebra pra agent que precisa snapshot | M | A | API daemon usa Bearer (não RLS); leitura final da UI usa RLS normal |
| PM sem subscription Claude tenta ativar claude-daemon | A | B | `zordon-mcp test` valida `claude` retorna 200; UI mostra warning pré-toggle |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| % turns claude-daemon vs openrouter | `SELECT mode, count(*) FROM "ChatTurn" GROUP BY mode` |
| Latência primeiro-token (P50, P95) por modo | `SELECT mode, percentile_cont(0.5) WITHIN GROUP (ORDER BY ms_to_first_token), percentile_cont(0.95) ...` — coluna `firstTokenAt` derivada |
| Taxa de fallback automatic (claude-daemon → openrouter) | `SELECT count(*) FROM "ChatTurn" WHERE "errorReason" = 'daemon_offline'` |
| Custo Volund mensal (OpenRouter only) | OpenRouter API billing dashboard |

## §14 Open questions

- ❓ Vitoria/Alpha precisam de tools antes de migrar pro claude-daemon? **Resolução: Fase 3 com MCP**.
- ❓ Streaming nativo do Claude SSE vs stream-json: por enquanto stream-json (mais robusto pra parsing).

## §15 Referências

- [project_vitor_mcp_volund_v2.md] memory — direção decidida.
- [project_agent_ui_parity.md] memory — ConversationPanel compartilhado.
- Claude CLI docs: https://docs.claude.com/en/docs/claude-code

## §16 Stories implementáveis

```yaml
- id: ZMC-CHAT-001
  title: Migration — ChatTurn + ChatTurnEvent + AgentMode + ForgeJob.kind
  description: Migration única adicionando 3 tabelas e ALTER em ForgeJob. Todas com RLS conforme §7.
  acceptanceCriteria:
    - "Migration <data>_chat_turn.sql aplica sem erro"
    - "ForgeJob.kind tem CHECK constraint pra ('forge','chat')"
    - "ChatTurnEvent PK composta (turnId, seq)"
    - "RLS habilitado nas 3 tabelas novas"
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

- id: ZMC-CHAT-002
  title: Endpoint POST /api/chat/turns (cria turn + job)
  description: Branch por mode. Se claude-daemon, cria ChatTurn (status=queued) + ForgeJob (kind=chat) e retorna 202 com chatTurnId. Se openrouter, comportamento atual (stream sse).
  acceptanceCriteria:
    - "POST com mode=claude-daemon retorna 202 + chatTurnId"
    - "ForgeJob criado com kind=chat e payload.chatTurnId"
    - "ChatTurn.systemPrompt populado por snapshot do agent definition"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-CHAT-001]
  estimateMinutes: 30
  touches: ["src/app/api/chat/turns/route.ts", "src/lib/dal/chat-turn.ts"]

- id: ZMC-CHAT-003
  title: Endpoints daemon — event + complete pra chat turns
  description: POST /api/daemon/chat-turns/:id/event (server-side seq assign + Realtime broadcast); POST /api/daemon/chat-turns/:id/complete (marca status=done + cria Message do assistant). Bearer auth da PRD ext.
  acceptanceCriteria:
    - "POST event grava ChatTurnEvent com seq auto-incrementado"
    - "POST complete cria Message(role=assistant) e marca turn done"
    - "Bearer token validado em ambos"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-CHAT-002]
  estimateMinutes: 30
  touches: ["src/app/api/daemon/chat-turns/"]

- id: ZMC-CHAT-004
  title: API AgentMode (GET/PUT) + hook useAgentMode
  description: Backend e hook React pra leitura/escrita da preferência por thread+agent. Cache local + persist.
  acceptanceCriteria:
    - "GET /api/agent-mode?agentSlug=&threadId= retorna mode atual ou 'openrouter' default"
    - "PUT /api/agent-mode persiste e retorna 204"
    - "useAgentMode hook expõe { mode, setMode, isLoading }"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-CHAT-001]
  estimateMinutes: 25
  touches: ["src/app/api/agent-mode/", "src/hooks/use-agent-mode.ts"]

- id: ZMC-CHAT-005
  title: exec-chat-turn.ts no zordon-mcp (claude CLI + stream parser)
  description: Script que recebe chatTurnId via env, spawn claude -p com systemPrompt + userMessage, parseia stream-json delta-by-delta e POSTa pra /api/daemon/chat-turns/:id/event. POST complete ao final com tokens/cost.
  acceptanceCriteria:
    - "scripts/exec-chat-turn.ts existe no zordon-mcp"
    - "Daemon loop reconhece kind=chat e dispara exec-chat-turn"
    - "Cada delta vira 1 POST event"
    - "result event extrai tokensIn/Out/cost e envia em complete"
  verifiable:
    - kind: typecheck
      command_or_query: "cd ~/zordon-mcp && npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-CHAT-003]
  estimateMinutes: 30
  touches: ["zordon-mcp/scripts/exec-chat-turn.ts", "zordon-mcp/scripts/daemon.ts"]

- id: ZMC-CHAT-006
  title: Hook useDaemonChat — Realtime subscribe + render
  description: Hook React que recebe chatTurnId, subscribe ChatTurnEvent via Supabase Realtime, monta string de tokens, retorna {messages, status, send}. Compatível visualmente com useChat (AI SDK).
  acceptanceCriteria:
    - "Hook subscreve canal chat_turn_event:turn_id=eq.<id>"
    - "Tokens text_delta concatenam progressivamente"
    - "status=streaming|done|error refletido em UI"
    - "Unsubscribe limpo no unmount"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-CHAT-003]
  estimateMinutes: 30
  touches: ["src/hooks/use-daemon-chat.ts"]

- id: ZMC-CHAT-007
  title: DaemonStatusSheet — ResponsiveSheet com status + toggle
  description: Sheet sm que mostra estado do daemon (online/offline + heartbeat ago), botões pra escolher mode, link pra /settings/daemon. Usa GET /api/daemon/status.
  acceptanceCriteria:
    - "Sheet renderiza estado online/offline correto"
    - "Toggle ativa/desativa modo claude-daemon"
    - "Click 'Testar conexão' faz request real e mostra resultado"
    - "ConfirmDialog (não confirm()) pra trocar modo se houver turn em andamento"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-CHAT-004]
  estimateMinutes: 30
  touches: ["src/components/agent/chat/daemon-status-sheet.tsx"]

- id: ZMC-CHAT-008
  title: ConversationPanel — ícone modo + branch hook por mode
  description: Adiciona ícone no header (●/◐/○) baseado em useAgentMode + status do daemon. Click abre DaemonStatusSheet. ConversationPanel escolhe useChat (openrouter) ou useDaemonChat (claude-daemon).
  acceptanceCriteria:
    - "Ícone correto pros 3 estados (online, offline, openrouter)"
    - "Mode trocou no sheet → próximo send usa novo hook"
    - "Mensagens anteriores do thread permanecem visíveis ao trocar mode"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-CHAT-006, ZMC-CHAT-007]
  estimateMinutes: 30
  touches: ["src/components/ui/conversation/conversation-panel.tsx"]

- id: ZMC-CHAT-009
  title: Fallback automatic — daemon offline → openrouter no próximo turn
  description: Em POST /api/chat/turns, se mode=claude-daemon e GET /daemon/status não tem daemon ativo, cai pra openrouter e retorna header X-Mode-Fallback=true. UI mostra toast informativo.
  acceptanceCriteria:
    - "Sem daemon ativo → API muda mode internamente"
    - "Response inclui X-Mode-Fallback=true"
    - "UI exibe toast 'Daemon offline, usando OpenRouter'"
    - "AgentMode preference do user permanece claude-daemon (não muda silenciosa)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-CHAT-002]
  estimateMinutes: 20
  touches: ["src/app/api/chat/turns/route.ts"]

- id: ZMC-CHAT-010
  title: Sweeper — running turn sem heartbeat por 5min vira aborted
  description: Endpoint cron /api/cron/sweep-chat-turns ou Edge Function que roda cada 1min: turns com status=running cujo daemon heartbeat <-5min → status=aborted, errorReason='daemon_timeout'.
  acceptanceCriteria:
    - "Endpoint sweep movimenta turns conforme regra"
    - "Schedule documentada em supabase/cron.sql ou ~/zordon-mcp/README"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-CHAT-003]
  estimateMinutes: 25
  touches: ["src/app/api/cron/sweep-chat-turns/route.ts"]

- id: ZMC-CHAT-011
  title: Smoke end-to-end Vitor
  description: PM ativa Claude Daemon no chat com Vitor, manda "ola tudo bem?", vê resposta streamando. Tenta 3 mensagens consecutivas. Trocar pra OpenRouter e voltar funciona.
  acceptanceCriteria:
    - "Primeira mensagem responde via Claude (visível no DB ChatTurn.mode='claude-daemon')"
    - "Stream visível na UI (não one-shot)"
    - "Toggle pra openrouter no meio funciona; histórico preservado"
    - "ChatTurn.tokensIn/Out/costUsd populados"
  verifiable:
    - kind: manual_browser
      command_or_query: "Ativar claude-daemon em vitor, mandar 3 mensagens, trocar mode, mandar +1"
      expected: "todas streamam, sem erros"
  dependsOn: [ZMC-CHAT-005, ZMC-CHAT-008, ZMC-CHAT-009]
  estimateMinutes: 30
  touches: ["(end-to-end test)"]
```

**Total: 11 stories, ~305min (~5h).**
