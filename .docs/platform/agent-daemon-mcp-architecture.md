# Arquitetura — Chat de agente via Claude Daemon + MCP

> Referência canônica de **como o chat dos agentes (Vitor / Vitoria / Alpha) roda no daemon** e **por que** a estrutura é essa. Complementa [zordon-daemon-extraction-plan.md](zordon-daemon-extraction-plan.md). Última revisão: 2026-06-16.
>
> Memórias relacionadas: `feedback_agent_chat_daemon_only`, `project_daemon_v1_v2`, `project_vitoria_daemon_surfaces`, `project_zordon_daemon_extraction`.

---

## 0 · TL;DR

O chat de **todo agente** tem **dois runtimes**:

1. **OpenRouter** (`runAgent` / engine AI SDK) — caminho histórico. Stateless: cada turn remonta contexto + prompt.
2. **Claude Daemon** (Claude Code SDK via `claude -p`/`query()`) — caminho **default** (regra 2026-06). Stateful (resume nativo), BYO auth (`~/.claude`), tools via **MCP**.

A escolha é por usuário+agente (`AgentMode`, default `claude-daemon`); OpenRouter é **fallback automático** quando o daemon está offline. **Forge não muda** (sempre foi Claude Code).

**Deploy hoje (daemon v1):** o daemon roda no **Mac do João**; todos se conectam nele; app+daemon co-locados (`ZORDON_URL=localhost:3333`). Ferramenta interna temporária. v2 (deploy próprio/escalável) fica pra depois. Ver `project_daemon_v1_v2`.

---

## 1 · Os dois runtimes e o switch (`AgentMode`)

| | OpenRouter | Claude Daemon |
|---|---|---|
| Engine | `src/lib/agent/engine.ts` (`runAgent`) | Claude Code SDK (`@anthropic-ai/claude-agent-sdk`), no repo **zordon-daemon** |
| Estado | stateless (remonta todo turn) | **resume** nativo (sessão CC por thread) |
| Auth do modelo | chave OpenRouter | `~/.claude` (subscription/OAuth do host) |
| Tools | AI SDK `tool()` in-process | **MCP** (stdio) → proxy HTTP pro Zordon |
| Prompt | `agent.buildPrompt` inteiro | leve (`prepare-context`) **ou** rico (`prepare-turn`) |
| Custo | fatura OpenRouter | subscription do host |

**`AgentMode`** ([api/agent-mode/route.ts](../../src/app/api/agent-mode/route.ts)): tabela `(userId, agentSlug, mode)`, `mode ∈ {openrouter, claude-daemon}`. **Default = `claude-daemon`** (linha ausente → daemon). UI: [settings/agents](../../src/app/(dashboard)/settings/agents/page.tsx) (card único: status do daemon + runtime efetivo por agente + "Forçar OpenRouter"). Hook [use-agent-mode.ts](../../src/hooks/use-agent-mode.ts).

**Fallback:** cada rota de chat, no branch `claude-daemon`, chama `isDaemonOnline()` ([sse-chat-proxy.ts](../../src/lib/agent/sse-chat-proxy.ts) — conta `ForgeDaemon` com heartbeat < 60s). Offline → cai no connector OpenRouter e seta headers `X-Mode-Fallback: true` + `X-Mode-Fallback-Reason`. O front mostra um chip âmbar (`ConversationPanel`).

---

## 2 · Fluxo ponta-a-ponta (daemon)

```
UI (useChat) → POST /api/<surface>/chat
   │  resolve member + AgentMode(agentSlug)  [default claude-daemon]
   │  daemon online? ── não ─→ connector OpenRouter (runAgent) + X-Mode-Fallback
   │       sim
   ▼
streamViaClaudeDaemon({threadId, userMessageId, agentSlug, ownerId})   [sse-chat-proxy.ts]
   │  1. INSERT ChatTurn(status=queued, mode=claude-daemon)
   │  2. SUBSCRIBE broadcast `chat-turn-<id>`  (antes de enfileirar)
   │  3. enqueue ForgeJob(kind=chat, assignToAnyone=true, meta.chatTurnId)
   │  4. forward deltas do broadcast → SSE UIMessage stream (mesma UX do OpenRouter)
   ▼
DAEMON (zordon-daemon) claima o ForgeJob via claim_next_job
   exec-chat-turn.ts:
     a. markChatTurnRunning
     b. POST /api/agents/<slug>/prepare-context  → JSON leve de fatos vivos + `surface`
     c. PROMPT:
          - Vitoria → POST /api/agents/<slug>/prepare-turn  (PROMPT RICO = agent.buildPrompt)
          - Vitor/Alpha → buildChatPrompt(ctx)  (prompt leve ~600 tokens, chat-prompts.ts)
     d. spawn mcp-server.ts (stdio) com env AGENT_SLUG + AGENT_SURFACE + CHAT_TURN_ID
     e. Claude SDK query({
          resume: ccSessionId?,                 // continuidade
          allowedTools: getToolNamesForAgent(slug, surface).map(n => `mcp__zordon__${n}`),
          mcpServers: { zordon: stdio mcp-server }, permissionMode: bypassPermissions
        })
   │  Claude chama tool → mcp-server registra schema + proxia:
   ▼
POST /api/agents/tools/<toolName>  { args, chatTurnId }     [tool router, Zordon]
   │  resolve ctx do chatTurnId → thread → (sessionId | pmReviewId | planningId) + projectId + memberId
   │  TOOL_REGISTRY[toolName](ctx).execute(args)   ← lógica + DB REAIS aqui (service_role)
   ▼
deltas (text/thinking) → ChatTurnEvent + broadcast `chat-turn-<id>` → UI
completeChatTurn → ChatMessage(assistant) + status=done
```

**Ponto-chave:** o **contexto de execução das tools não vem do daemon** — é resolvido **server-side** a partir do `chatTurnId` → `thread`. O daemon só carrega schemas e faz proxy.

---

## 3 · Modelo de thread → surface → agente

Tudo dispatcha por **`ChatThread.channel`** (+ `agentName`/`sessionId`):

| Agente / superfície | `channel` | chave | entidade | contexto |
|---|---|---|---|---|
| Vitor (Design Session) | `web` / `briefing` | `sessionId` | DesignSession | DS steps, decisões, PRDs |
| Vitoria — PM Review | `pm_review` | `agentName`=pmReviewId | PMReview | review + notas + **sprint profile** |
| Vitoria — Planning | `planning` | `agentName`=planningId | PlanningCeremony | sprint + staging de tasks |
| Vitoria — Release Planning | `release_planning` | `agentName`=sessionId | PlanningSession | roadmap |
| Alpha (ops) | `web` | `agentName`=`alpha` | — (global) | ops, route-scoped |

`prepare-context` ([api/agents/[slug]/prepare-context](../../src/app/api/agents/[slug]/prepare-context/route.ts)) e `prepare-turn` ([…/prepare-turn](../../src/app/api/agents/[slug]/prepare-turn/route.ts)) resolvem a surface a partir do channel e devolvem `surface` no payload — o daemon usa pra escolher prompt + toolset.

**Vitoria = UMA agente, vários rituais** (não bifurca por surface). Núcleo de *situational awareness* (sprint/tasks/velocity) é **compartilhado**; só os **writes** + a entidade diferem. Ver `project_vitoria_daemon_surfaces`.

---

## 4 · Duas estratégias de prompt

| | `prepare-context` (leve) | `prepare-turn` (rico) |
|---|---|---|
| Saída | JSON de fatos (~1-2KB) → `buildChatPrompt` monta ~600 tokens | `agent.loadContext`+`buildPrompt` inteiro (~5-20KB) |
| Quem usa | Vitor, Alpha | **Vitoria (todas surfaces)** |
| Por quê | prompt enxuto + tools puxam estado | a qualidade do output depende das regras (SDD, procedência, FP, tool-routing) |

**Resume congela o prompt no 1º turn** (depois a sessão CC tem memória nativa). Por isso estado **mutável** (propostas pendentes, sprint) não pode viver só no prompt → o agente puxa via tool (`get_planning_state`, reads de sprint). É o que torna o "prompt rico congelado" correto no daemon.

---

## 5 · Arquitetura de tools (o coração do MCP)

### 5.1 Registry único, dois consumidores

`TOOL_REGISTRY: Record<string, (ctx) => Tool>` ([tools-registry.ts](../../src/lib/agent/tools-registry.ts)) — mapa nome→factory. Dois consumidores:

- **Tool router (volund, [api/agents/tools/[toolName]](../../src/app/api/agents/tools/[toolName]/route.ts)):** EXECUTA. `factory(ctx).execute(args)` com a lógica + DB reais.
- **MCP server (zordon-daemon, `scripts/daemon/mcp-server.ts`):** só lê `factory(FAKE_CTX).inputSchema` pra registrar a tool via MCP. **Nunca executa** — proxia por HTTP pro tool router.

### 5.2 Seleção surface-aware

`getToolNamesForAgent(slug, surface)` filtra o registry. Vitoria: `planning` → toolset de staging; `pm_review` → PM Review; **núcleo READ compartilhado** entre as duas. O `allowedTools` do `exec-chat-turn` é **derivado dessa função** (não mais lista estática) → daemon e MCP ficam em sincronia.

### 5.3 Split por dependência de `ctx`

As factories exigem só o que a tool usa (senão `requireX` lança):

- `requireSessionId` (DS), `requirePMReviewId` (PM Review), `requirePlanningId` (Planning ceremony).
- **projectId-only** (`ctx.planningId ?? ""`) → reads de sprint que servem PM Review **e** Planning.

### 5.4 O padrão schema-stub (mirror cross-repo)

`tools-registry.ts`, `tools/context-source.ts`, `dal/chat-turn.ts` são **espelhados** volund ↔ zordon-daemon. Como o MCP server só precisa do **schema** (execução é no volund), as tools "pesadas" no daemon são **stubs**: mesmo `description` + `inputSchema` Zod, **sem `execute`** (ex.: [zordon-daemon `agents/vitoria/tools.ts`]). Isso evita arrastar a cadeia de DAL/DB pro daemon.

> **Drift é risco de correção, não higiene.** Se os schemas divergirem, o que o modelo vê (daemon) descasa do que valida/executa (volund). Mitigação: o tool router faz `inputSchema.safeParse(args)` **antes** de executar (rede de segurança). Mantenha os stubs em sincronia.

---

## 6 · Continuidade de sessão (resume)

`ChatThread` guarda `ccSessionId`, `turnsSinceCompact`, `lastSummary` ([dal/chat-turn.ts](../../src/lib/dal/chat-turn.ts)).

- 1º turn: fresh (system prompt + history bootstrap). Captura `session_id` da SDK → salva.
- Turns seguintes: `resume: ccSessionId` → manda só a msg nova (Claude tem memória nativa).
- **cwd gotcha:** o resume é sensível ao `cwd`; o daemon usa `cwd=repoRoot` ESTÁVEL (nunca `workspacePath`), senão "No conversation found". Ver `project_daemon_chat_resume_cwd`.
- Compact: a cada N turns salva `lastSummary`, zera sessão.

---

## 7 · Decisões fixadas (o PORQUÊ)

| # | Decisão | Por quê |
|---|---|---|
| **D1** | Daemon é o **default**; OpenRouter é fallback. | Unifica runtime com a Forge (mesma stack Claude Code), BYO auth (sem chave OpenRouter), e mantém a rede de segurança. |
| **D2** | Tool router usa **service_role, sem Bearer** (MVP local). | Daemon roda local/trusted; o ctx (member/session/project) é resolvido server-side do `chatTurnId`, não confiado do cliente. Simplifica o MVP. |
| **D3** | MCP server só carrega **schema**; execução proxia pro volund. | Single source of truth da lógica (volund); o daemon não duplica DAL/DB; tool nova = registrar no volund + stub no daemon. |
| **D4** | Tools pesadas no daemon são **schema-stubs** (sem execute). | Evita portar a cadeia de deps; `safeParse` no router cobre o risco de drift. |
| **D5** | Vitoria usa **prompt rico** (`prepare-turn`); Vitor/Alpha usam leve. | A qualidade da Vitoria (propostas no backlog) depende das regras; Vitor/Alpha puxam estado por tool. |
| **D6** | Estado mutável vem de **tool**, não do prompt. | Resume congela o prompt no 1º turn → `get_planning_state` etc. mantêm frescor. |
| **D7** | `allowedTools` **derivado** de `getToolNamesForAgent`. | Mata a whitelist estática frágil; escopa por agente+surface; sincroniza daemon↔registry. |
| **D8** | Jobs de chat são **`assignToAnyone=true`**. | Qualquer daemon online claima (não precisa identidade per-user); habilita o host always-on compartilhado. |
| **D9** | `permissionMode: bypassPermissions` + `disallowedTools` (Bash/Read/Edit nativos). | Sem humano no loop; só `mcp__zordon__*` autorizadas; tools nativas do CC que varrem o disco ficam bloqueadas (workspace lê via `mcp__zordon__*_workspace` que valida o prefixo). |

---

## 8 · Matriz de capacidade por agente (daemon)

| Agente / surface | Prompt no daemon | Tools no daemon | Status |
|---|---|---|---|
| Vitor (DS) | leve (`buildChatPrompt`) | DS entities + memória + PRD + workspace | ✅ |
| Vitoria — PM Review | **rico** (`prepare-turn`) | PM Review + **núcleo READ de sprint** | ✅ |
| Vitoria — Planning | **rico** (`prepare-turn`) | staging (17 tools) + reads | ✅ |
| Vitoria — Release Planning | rico | — (sem toolset dedicado ainda) | 🟡 parcial |
| **Alpha (ops)** | genérico (thin) | **NENHUMA no zordon-daemon** | ❌ ver [alpha-daemon-plan.md](alpha-daemon-plan.md) |

---

## 9 · Limitações conhecidas / dívidas

- **Composio (GitHub/Calendar)** exige token **per-user**; o daemon é service_role → não carrega. Fica no path OpenRouter (ou espera daemon v2 com auth per-user).
- **`currentPath` / route-scoping** não chega ao daemon (o ChatTurn não carrega a página atual). Tools route-scoped (Alpha) precisam de threading do `currentPath` ou de `projectId` explícito.
- **Mirror manual** volund↔zordon-daemon — drift latente (mitigado por `safeParse`). Candidato a script de verificação de paridade.
- **Release Planning** no daemon: sem toolset dedicado.
- **Auth per-user no daemon:** hoje shared/service_role (v1). Per-user (necessário p/ Composio + isolamento) é tema de daemon v2.

---

## 10 · Como plugar um agente/surface/tool novo no daemon

1. **Tool nova:** registrar a factory em `TOOL_REGISTRY` (volund, com `execute` real) → mirror schema-stub no `zordon-daemon` → incluir o nome no set do `getToolNamesForAgent`.
2. **Surface nova de agente existente:** dispatch por `thread.channel` em `prepare-context` + `prepare-turn` (`resolveAgentParams`) + tool router (resolver a chave do ctx) + um set em `getToolNamesForAgent`.
3. **Agente novo:** adicionar em `AGENTS` (prepare-turn) + `prepare-context` branch + `buildChatPrompt` (zordon-daemon) + `SUPPORTED_AGENTS` (mcp-server) + sets/factories no registry (2 repos) + branch `AgentMode` na rota de chat dele.
4. **Gate sempre:** `tsc` nos 2 repos + smoke `getToolNamesForAgent(slug, surface)` resolve sem throw com o ctx da surface.
