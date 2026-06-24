# PRD — Zordon MCP Server: tools dos agentes via MCP

**Reference**: ZMC-SRV
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Depende de**: prd-chat-via-claude-daemon (chat via daemon funcionando pra Vitor)

## §1 Problema

1. Chat via Claude Daemon (PRD anterior) é texto-puro — Vitor não consegue criar PRD, buscar memória, ler tasks. Quem usa OpenRouter ainda tem tools melhores.
2. Vitoria e Alpha dependem fundamentalmente de tools (queries SQL, leitura de meetings, escrita em wiki). Sem MCP, daemon mode pra eles não tem utilidade.
3. Hoje tools vivem dentro do webapp Node como `tool()` do AI SDK — não tem como o Claude CLI chamar elas. Precisa expor como MCP server.

## §2 Solução em uma frase

Empacotar tools dos 3 agentes como MCP server stdio (`zordon-mcp/src/mcp/server.ts`), spawned pelo daemon antes de cada turn, conectado ao Claude CLI via `--mcp-config`.

## §3 Não-objetivos

- Tools novas. Esta PRD apenas **empacota** as que já existem. Adicionar tool nova fica em PRD separada.
- MCP server público (oferecido a terceiros). Por enquanto é interno — só agentes Volund consomem.
- Versionamento independente de tools (cada agente tem seu set fixo nesta PRD).

## §4 Personas e jornada

- **Vitor**: "Preciso criar PRD via `create_prd_skeleton`, buscar contexto em meeting transcripts, atualizar status."
- **Vitoria**: "Preciso ler PM Reviews recentes, consultar Sprint metrics, criar Notes."
- **Alpha**: "Preciso buscar membros, criar tasks, atualizar status de delivery, escrever no Wiki."

## §5 Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | MCP server = stdio (não HTTP/SSE) | Padrão Claude CLI; sem porta exposta. |
| D2 | 1 MCP server por daemon (não por turn) — long-lived | Cold start de servidor MCP custa ~500ms; manter quente evita esse hit por turn. |
| D3 | Tools são roteadas por `agentSlug` (passada via env do MCP server) | Mesma binary roda pros 3 agentes; lista de tools muda. |
| D4 | Tools chamam de volta o Zordon via HTTP (mesmo client da PRD ext) | Single source of truth do DB. MCP server é proxy fino. |
| D5 | Token do daemon herda pro MCP server via env `DAEMON_TOKEN` | MCP não conhece auth do user direto; usa o do daemon. |
| D6 | Schema JSON dos tools = JSON Schema strict (per MCP spec) | Conforma com spec MCP. |
| D7 | Erros de tool retornam `tool_result` com `isError=true` (não throw) | Claude entende o erro e pode tentar abordagem diferente. |
| D8 | Ordem de migração: Vitor → Vitoria → Alpha | Vitor já tá em produção via PRD ext; lower risk. |
| D9 | System prompt + tools list lidos do Zordon DAL (endpoint novo: `GET /api/agents/:slug/capabilities`) | Permite editar prompts no webapp sem deploy do zordon-mcp. |
| D10 | Tools list **fixa por agente** nesta versão (Vitor: 5, Vitoria: 4, Alpha: 6) — extensível depois | Foco no piloto. |
| D11 | Vitoria/Alpha ganham toggle Claude Daemon no chat só após terem tools migradas | Sem tools, agente fica burro — não vale a pena oferecer. |
| D12 | Quando MCP server crasha mid-turn, daemon termina o `claude -p`, marca turn=error, reinicia MCP server pro próximo | Resilience sem cascata. |

## §6 Arquitetura

```
[zordon-mcp daemon]
       │
       ├─► spawn 1× ao startup: MCP server (stdio, long-lived)
       │   env: DAEMON_TOKEN, ZORDON_URL
       │      │
       │      └─► registra capabilities/tools (list por agentSlug)
       │
       └─► por turn:
           spawn `claude -p "..." \
             --mcp-config /tmp/zordon-mcp-<turn-id>.json \
             --output-format stream-json`
                │
                ├─► claude CLI dispatches tool_use → MCP server (stdio)
                │      │
                │      └─► MCP server resolve tool:
                │          ex: vitor.create_prd_skeleton
                │            │
                │            └─► POST /api/agents/tools/prd-create
                │                   body: { args }
                │                   header: Bearer fdt_...
                │                │
                │                └─► Zordon: cria PRD em ProductRequirement
                │
                ├─► MCP responde tool_result
                ├─► Claude continua geração
                └─► stream-json → daemon → POST /api/daemon/chat-turns/:id/event
```

## §7 Schema

```sql
-- 1. View pra agent capabilities (lookup rápido)
-- Não cria tabela nova: lê do AgentDefinition existente
-- Endpoint /api/agents/:slug/capabilities monta resposta a partir de:
--   AgentDefinition.systemPrompt + tools array (jsonb existente)

-- 2. Audit de tool invocations (debugging + cost analysis)
CREATE TABLE "ToolInvocation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "chatTurnId" uuid REFERENCES "ChatTurn"(id) ON DELETE CASCADE,
  "agentSlug" text NOT NULL,
  "toolName" text NOT NULL,
  "args" jsonb NOT NULL,
  "result" jsonb,
  "isError" boolean NOT NULL DEFAULT false,
  "errorMessage" text,
  "durationMs" int,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ToolInvocation_chatTurnId_idx" ON "ToolInvocation"("chatTurnId");
CREATE INDEX "ToolInvocation_toolName_idx" ON "ToolInvocation"("toolName");

ALTER TABLE "ToolInvocation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tool_invocation_thread_member" ON "ToolInvocation"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "ChatTurn" ct
      JOIN "Thread" t ON t.id = ct."threadId"
      WHERE ct.id = "chatTurnId" AND t."memberId" = auth.uid()
    )
  );
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET | `/api/agents/:slug/capabilities` | Returns: `{systemPrompt, tools: [{name, description, inputSchema}]}` |
| POST | `/api/agents/tools/:toolName` | Body: `{args, chatTurnId, agentSlug}` → Returns: `{result}` ou `{error}` |
| GET | `/api/tool-invocations?turnId=...` | Returns: lista pra debug UI |

Tool endpoints específicos (lista parcial — total 15):

**Vitor (5):**
| Tool | Endpoint |
|------|---------|
| `create_prd_skeleton` | `POST /api/agents/tools/create_prd_skeleton` |
| `update_prd_status` | `POST /api/agents/tools/update_prd_status` |
| `search_memory` | `POST /api/agents/tools/search_memory` |
| `read_meeting_transcript` | `POST /api/agents/tools/read_meeting_transcript` |
| `list_design_sessions` | `POST /api/agents/tools/list_design_sessions` |

**Vitoria (4):**
| Tool | Endpoint |
|------|---------|
| `read_pm_review` | `POST /api/agents/tools/read_pm_review` |
| `create_note` | `POST /api/agents/tools/create_note` |
| `query_sprint_metrics` | `POST /api/agents/tools/query_sprint_metrics` |
| `update_pm_review_report` | `POST /api/agents/tools/update_pm_review_report` |

**Alpha (6):**
| Tool | Endpoint |
|------|---------|
| `list_members` | `POST /api/agents/tools/list_members` |
| `create_task` | `POST /api/agents/tools/create_task` |
| `update_task_status` | `POST /api/agents/tools/update_task_status` |
| `write_to_wiki` | `POST /api/agents/tools/write_to_wiki` |
| `list_squads` | `POST /api/agents/tools/list_squads` |
| `assign_to_squad` | `POST /api/agents/tools/assign_to_squad` |

## §9 UX

Sem mudança visual na UI principal. Side feature: **debug panel** opcional.

### Debug panel (collapsible no chat, dev mode)

```
┌─────────────────────────────────┐
│ ▾ Tools invoked (3)             │
│                                 │
│   create_prd_skeleton           │
│     args: { title: "..." }      │
│     → ok (240ms)                │
│                                 │
│   search_memory                 │
│     args: { query: "wiki" }     │
│     → ok (180ms)                │
│                                 │
│   read_meeting_transcript       │
│     args: { meetingId: "..." }  │
│     → error: not found (45ms)   │
└─────────────────────────────────┘
```

## §10 Integrações

- **zordon-mcp daemon**: novo subprocess MCP server long-lived; precisa wire-up no `daemon.ts`.
- **exec-chat-turn.ts**: passa a gerar `mcp-config-<turnId>.json` apontando pro MCP server local; usa `claude -p ... --mcp-config`.
- **Vitoria/Alpha agent definitions**: gain `mcpAvailable: true` flag (esconde toggle no chat se false).
- **ConversationPanel**: condicional no toggle — só mostra Claude Daemon se `agent.mcpAvailable`.

## §11 Faseamento

Fase 3.1 — Foundation MCP (sem tools ainda):
1. MCP server stdio skeleton + capabilities endpoint
2. Daemon spawn MCP server como child
3. Smoke: `claude -p` lista tools sem usar

Fase 3.2 — Vitor tools:
4. Empacota 5 tools do Vitor (endpoints + MCP wiring)
5. ToolInvocation audit logging
6. Smoke: Vitor cria PRD via tool call

Fase 3.3 — Vitoria tools:
7. Empacota 4 tools da Vitoria
8. Habilita toggle Claude Daemon no chat dela
9. Smoke: Vitoria gera report parcial

Fase 3.4 — Alpha tools:
10. Empacota 6 tools do Alpha
11. Habilita toggle no chat dele
12. Smoke: Alpha cria task via chat

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| MCP server crasha → Claude trava esperando | M | A | Daemon monitora processo; restart on crash; turn vira error |
| Tool endpoint lento (>5s) → Claude timeout | M | M | Endpoints aceitam `?async=true` retornando job; tool resolve depois (TODO) |
| Tool retorna dado sensível (PII) | M | A | Tools sempre filtram via DAL com RLS-equivalent checks; teste por agente |
| Tools com nomes conflitantes entre agentes | B | M | Namespacing: tools são `vitor.create_prd` no MCP, mas roteadas pra endpoint genérico |
| Stream do Claude trava em meio a tool_use | M | M | Daemon timeout de 60s por tool; reporta erro como tool_result isError=true |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Tools chamadas por turn (média) | `SELECT avg(c) FROM (SELECT count(*) c FROM "ToolInvocation" GROUP BY "chatTurnId")` |
| Taxa de tool error | `SELECT count(*) FILTER(WHERE "isError") / count(*) FROM "ToolInvocation"` |
| Latência P50/P95 por tool | `SELECT "toolName", percentile_cont(0.5) WITHIN GROUP(ORDER BY "durationMs"), percentile_cont(0.95) ... GROUP BY "toolName"` |
| % turns claude-daemon que usam ≥1 tool | `SELECT count(DISTINCT ct.id) FILTER(WHERE ti.id IS NOT NULL) / count(DISTINCT ct.id) FROM "ChatTurn" ct LEFT JOIN "ToolInvocation" ti ON ti."chatTurnId"=ct.id WHERE ct.mode='claude-daemon'` |

## §14 Open questions

(vazio — todas resolvidas em §5)

## §15 Referências

- MCP spec: https://spec.modelcontextprotocol.io/specification/
- Memory `project_vitor_mcp_volund_v2.md` — direção decidida.
- Memory `project_agent_ui_parity.md` — UI compartilhada.

## §16 Stories implementáveis

```yaml
- id: ZMC-SRV-001
  title: Migration — tabela ToolInvocation
  description: Cria ToolInvocation conforme §7. RLS thread-member.
  acceptanceCriteria:
    - "Migration aplica sem erro"
    - "Tabela existe com RLS habilitado"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.tables WHERE table_name='ToolInvocation'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: ZMC-SRV-002
  title: Endpoint GET /api/agents/:slug/capabilities
  description: Retorna systemPrompt + tools list de AgentDefinition. Cacheado em-memory por 60s.
  acceptanceCriteria:
    - "GET /api/agents/vitor/capabilities retorna shape {systemPrompt, tools:[]}"
    - "Tools incluem name, description, inputSchema (JSON Schema)"
    - "404 pra slug desconhecido"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
    - kind: http
      command_or_query: "curl -s -H 'Authorization: Bearer fdt_test' https://zordon.volund.com.br/api/agents/vitor/capabilities | jq .tools[0].name"
      expected: "non-empty string"
  dependsOn: [ZMC-SRV-001]
  estimateMinutes: 25
  touches: ["src/app/api/agents/[slug]/capabilities/route.ts"]

- id: ZMC-SRV-003
  title: MCP server stdio skeleton no zordon-mcp
  description: src/mcp/server.ts implementando spec MCP stdio. Lê env DAEMON_TOKEN, AGENT_SLUG. Connects to Zordon. Lista tools via capabilities endpoint.
  acceptanceCriteria:
    - "Server arranca com node src/mcp/server.ts"
    - "Responde initialize handshake conforme spec"
    - "list_tools retorna tools do agente (Vitor)"
    - "tools/call routado pra POST /api/agents/tools/<name>"
  verifiable:
    - kind: manual_browser
      command_or_query: "cd ~/zordon-mcp && AGENT_SLUG=vitor DAEMON_TOKEN=test node src/mcp/server.ts < tests/initialize-handshake.json"
      expected: "responde com capabilities válidas"
  dependsOn: [ZMC-SRV-002]
  estimateMinutes: 30
  touches: ["zordon-mcp/src/mcp/server.ts", "zordon-mcp/src/mcp/client.ts"]

- id: ZMC-SRV-004
  title: Daemon spawn MCP server long-lived
  description: scripts/daemon.ts startup spawna 1 MCP server stdio (child process). exec-chat-turn.ts passa --mcp-config apontando pra ele.
  acceptanceCriteria:
    - "Daemon log mostra 'MCP server up' ao startup"
    - "MCP server restart on crash (max 5 tentativas)"
    - "exec-chat-turn gera mcp-config-<turnId>.json correto"
  verifiable:
    - kind: typecheck
      command_or_query: "cd ~/zordon-mcp && npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-SRV-003]
  estimateMinutes: 25
  touches: ["zordon-mcp/scripts/daemon.ts", "zordon-mcp/scripts/exec-chat-turn.ts"]

- id: ZMC-SRV-005
  title: Endpoint genérico POST /api/agents/tools/:toolName
  description: Router que recebe toolName, valida args via schema do AgentDefinition, dispatch pra handler interno. Grava ToolInvocation.
  acceptanceCriteria:
    - "Args inválidos → 400 + erro de schema"
    - "Tool desconhecido → 404"
    - "Sucesso grava ToolInvocation com isError=false e durationMs"
    - "Erro grava com isError=true + errorMessage"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-SRV-001]
  estimateMinutes: 30
  touches: ["src/app/api/agents/tools/[toolName]/route.ts", "src/lib/dal/tool-invocation.ts"]

- id: ZMC-SRV-006
  title: Vitor tools — 5 endpoints específicos
  description: create_prd_skeleton, update_prd_status, search_memory, read_meeting_transcript, list_design_sessions. Cada um valida acesso (thread member tem permissão sobre PRD/meeting/etc).
  acceptanceCriteria:
    - "Os 5 endpoints existem e validam input via Zod"
    - "create_prd_skeleton cria ProductRequirement em backlog status"
    - "search_memory faz busca em DesignSessionMemory por keywords"
    - "RLS-equivalent checks: user precisa pertencer ao projeto do recurso"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-SRV-005]
  estimateMinutes: 30
  touches: ["src/lib/agent/tools/vitor/"]

- id: ZMC-SRV-007
  title: Smoke Vitor — gera PRD via chat claude-daemon
  description: PM diz "crie PRD pra feature X" no chat Vitor (mode=claude-daemon). Vitor chama create_prd_skeleton. PRD aparece em docs/prd/backlog ou ProductRequirement table.
  acceptanceCriteria:
    - "Mensagem do user dispara tool_use"
    - "ToolInvocation row criada com isError=false"
    - "ProductRequirement aparece com status=draft"
    - "Resposta do Vitor referencia o PRD criado"
  verifiable:
    - kind: manual_browser
      command_or_query: "Chat com Vitor: 'crie PRD pra notificações push'"
      expected: "PRD criado, link visível na resposta"
  dependsOn: [ZMC-SRV-004, ZMC-SRV-006]
  estimateMinutes: 25
  touches: ["(end-to-end test)"]

- id: ZMC-SRV-008
  title: Vitoria tools — 4 endpoints
  description: read_pm_review, create_note, query_sprint_metrics, update_pm_review_report.
  acceptanceCriteria:
    - "Os 4 endpoints existem"
    - "query_sprint_metrics retorna stats do sprint atual"
    - "create_note grava em PMReviewNote"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-SRV-005]
  estimateMinutes: 30
  touches: ["src/lib/agent/tools/vitoria/"]

- id: ZMC-SRV-009
  title: AgentDefinition.mcpAvailable + condicional toggle
  description: ConversationPanel só mostra toggle Claude Daemon se agent.mcpAvailable=true. Vitor true (já); Vitoria/Alpha ganham após tools migradas.
  acceptanceCriteria:
    - "Vitoria's chat mostra toggle (mcpAvailable=true após ZMC-SRV-008)"
    - "Alpha's chat ainda esconde toggle até ZMC-SRV-010"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-SRV-008]
  estimateMinutes: 15
  touches: ["src/components/ui/conversation/conversation-panel.tsx", "src/lib/agent/agents/"]

- id: ZMC-SRV-010
  title: Alpha tools — 6 endpoints
  description: list_members, create_task, update_task_status, write_to_wiki, list_squads, assign_to_squad.
  acceptanceCriteria:
    - "Os 6 endpoints existem"
    - "create_task valida squad existe; respeita RLS"
    - "write_to_wiki upsert por path; gera version"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-SRV-005]
  estimateMinutes: 30
  touches: ["src/lib/agent/tools/alpha/"]

- id: ZMC-SRV-011
  title: Debug panel — tools invoked collapsible
  description: Collapsible no chat (dev mode env flag) listando ToolInvocation do turn. Mostra args, result, duration.
  acceptanceCriteria:
    - "Componente DebugToolsPanel renderiza lista"
    - "Apenas visível se VITE_DEBUG_TOOLS=true ou role=admin"
    - "Atualiza em realtime conforme tools são invocadas"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-SRV-006]
  estimateMinutes: 25
  touches: ["src/components/agent/chat/debug-tools-panel.tsx"]

- id: ZMC-SRV-012
  title: Smoke Vitoria + Alpha
  description: Mesma estrutura do ZMC-SRV-007 mas pros 2 agentes restantes. Vitoria gera nota; Alpha cria task.
  acceptanceCriteria:
    - "Vitoria via claude-daemon cria PMReviewNote"
    - "Alpha via claude-daemon cria Task assignada a squad"
    - "Ambos retornam mensagens com referência ao recurso criado"
  verifiable:
    - kind: manual_browser
      command_or_query: "Chat com Vitoria: 'anote: equipe está bloqueada na Forge'; Chat com Alpha: 'crie task de revisar staging'"
      expected: "ambos criam recursos visíveis no DB"
  dependsOn: [ZMC-SRV-008, ZMC-SRV-010, ZMC-SRV-009]
  estimateMinutes: 30
  touches: ["(end-to-end test)"]
```

**Total: 12 stories, ~310min (~5h10).**
