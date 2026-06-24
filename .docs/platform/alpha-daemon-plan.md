# Plano — Alpha completamente no Claude Daemon

> Como levar o **Alpha (ops)** do estado atual (não funciona no daemon) a funcionar por completo. Base arquitetural: [agent-daemon-mcp-architecture.md](agent-daemon-mcp-architecture.md). Última revisão: 2026-06-16.

---

## 1 · Estado atual (grounded)

- **Rota** [api/agents/alpha/chat](../../src/app/api/agents/alpha/chat/route.ts): já tem o branch `AgentMode('alpha')` (default daemon) + fallback OpenRouter. ✅
- **Tool router** [api/agents/tools/[toolName]](../../src/app/api/agents/tools/[toolName]/route.ts): já resolve o ctx do Alpha (thread `agentName='alpha'` → global, sem projectId; `memberId` via `thread.createdBy`). ✅
- **Mas no `zordon-daemon`:** `getToolNamesForAgent('alpha')` retorna `[]` (registry não tem alpha — só comentário "expansão futura"); não existe `agents/alpha/`; o prompt cai no genérico do `buildChatPrompt`. → **Alpha no daemon hoje = chat sem tool nenhuma + prompt fraco. Não funciona.**
- **Volund `TOOL_REGISTRY`:** só as **8 reads globais** registradas via `alphaReadTool` (`ALPHA_READ_TOOL_NAMES`). As route-scoped, as write e o resto **não estão no registry** (só no bundle `assembleAlphaTools` do path OpenRouter).
- **`prepare-turn`** ([…/prepare-turn](../../src/app/api/agents/[slug]/prepare-turn/route.ts)): `AGENTS` = `{vitor, vitoria}` — **sem alpha** → Alpha não consegue o prompt rico.

> Nota histórica: a memória `feedback_agent_chat_daemon_only` cita um "MVP read-only do Alpha" — mas era no daemon **single-repo antigo** (dentro do volund), que **não foi espelhado** no repo `zordon-daemon` atual.

## 2 · Inventário do toolset (4 categorias)

| Categoria | Tools | Depende de | Daemon |
|---|---|---|---|
| **Global read (~11)** | get_sprint_overview, get_tasks, get_alerts, list_sprints, get_backlog, get_allocated_project_members, load_heuristic, get_pending_actions, get_recent_meetings, get_meeting_transcript, ask_meeting | projectId/sprintId como **arg** | ✅ direto |
| **Route-scoped read (7)** | list_modules, list_personas, list_stories, get_story, get_project_capacity, list_unplanned_tasks, verify_sprint_distribution | `routeProjectId` (vem do `currentPath`) | ⚠️ precisa threading do currentPath |
| **Write (~13)** | create_task, update_task, create_sprint, manage_allocation, create_meeting, save_meeting_transcript_text, update_meeting_notes, create_todo + hierarquia (create_user_story, update_user_story, bulk_update_tasks, approve_module, manage_story_ac) | writeTools; hierarquia: route + `currentMemberId` + `alphaHierarchyEnabled` | ⚠️ writeTools ok; route p/ hierarquia |
| **Composio** | GitHub / Google Calendar (merge via `capabilities.composio`) | **token per-user** | ❌ daemon é service_role |

## 3 · Decisões a fixar antes de codar

| # | Decisão | Recomendação |
|---|---|---|
| **A** | Como dar `routeProjectId` ao daemon? (a) threading do `currentPath` no ChatTurn; (b) converter route-scoped tools p/ aceitar `projectId` como arg explícito. | **(a) threading.** O `currentPath` já chega no body do `alpha/chat`. Persistir por-turn → o tool router faz `parseRoute` → `routeProjectId`. Bônus: habilita enriquecimento de prompt route-aware. Não muda contrato de tool. |
| **B** | Onde persistir o `currentPath`? | `ForgeJob.meta.routePath` (já passamos `meta` no enqueue) **ou** coluna `ChatTurn.routePath`. Recomendo `ChatTurn.routePath` (per-turn, o tool router já lê o ChatTurn). |
| **C** | Composio no daemon? | **Adiar pra daemon v2** (precisa auth per-user). Até lá: se o user precisa de GitHub/Calendar via Alpha, usa "Forçar OpenRouter"; o Alpha-daemon avisa que não tem essas tools. |
| **D** | Write tools autônomas no daemon? | Manter o kill-switch `Project.alphaHierarchyEnabled` (mover o check pra dentro do `execute` da factory, já que o `buildTools` não roda no path daemon). Considerar um toggle global de "alpha write no daemon" antes de ligar Fase 3. |
| **E** | Prompt do Alpha no daemon? | **Rico via `prepare-turn`** (como a Vitoria). O `buildAlphaPrompt` (34KB) + `buildOpsContext` com `route` global cobre o caso sem página. Senão o Alpha fica burro (mesma lição do PM Review). |

## 4 · Fases

### FASE 1 — Reads globais + prompt rico `[MVP — entrega valor sozinha]`
**Objetivo:** Alpha responde ops (sprint/tasks/alertas/backlog/reuniões) no daemon, com o prompt bom.
- **volund:** estender `ALPHA_READ_TOOL_NAMES` pras ~11 reads globais (faltam get_recent_meetings, get_meeting_transcript, ask_meeting). `alphaReadTool` já cobre o resto.
- **volund `prepare-turn`:** adicionar `alpha: alphaAgent` em `AGENTS` + `resolveAgentParams('alpha')` → `{ route: parseRoute(undefined) }` (global) + projectId null.
- **zordon-daemon:** criar `src/lib/agent/agents/alpha/tools.ts` (schema-stubs das ~11 reads) + registrar no `TOOL_REGISTRY` + `getToolNamesForAgent('alpha')` retorna o set.
- **zordon-daemon `exec-chat-turn`:** estender a condição de prompt rico pra incluir `alpha` (chama `prepare-turn`).
- **Gates:** `tsc` 2 repos · smoke `getToolNamesForAgent('alpha').length >= 11` sem throw · vivo: "como está a sprint do projeto X?" responde via daemon (sem `X-Mode-Fallback`).
- **Não entra:** route-scoped, write, Composio.

### FASE 2 — Threading do `currentPath` + route-scoped reads `[OPEN]`
**Objetivo:** Alpha sabe "onde o PM está" e ganha as 7 reads de projeto.
- **Schema:** coluna `ChatTurn.routePath text` (migration atômica).
- **volund:** `alpha/chat` (e o `streamViaClaudeDaemon`) gravam `routePath` no ChatTurn; tool router faz `parseRoute(turn.routePath)` → injeta `routeProjectId`/`routeSprintId` no ctx; registrar as 7 route-scoped reads no `TOOL_REGISTRY` (resolvem route do ctx).
- **volund `prepare-turn`:** `resolveAgentParams('alpha')` usa o `routePath` do ChatTurn → enriquecimento route-aware.
- **zordon-daemon:** stubs das 7 reads + adicionar ao set.
- **Gates:** `tsc` · smoke · vivo: estando em `/projects/<id>`, "lista os módulos" funciona sem o PM citar o id.
- **Não entra:** write, Composio.

### FASE 3 — Write tools `[OPEN]`
**Objetivo:** Alpha cria/edita task, sprint, alocação, hierarquia — no daemon.
- **volund:** registrar as ~13 write tools no `TOOL_REGISTRY`; mover o gate `alphaHierarchyEnabled` pra dentro do `execute` das hierarquia-writes (lê `Project.alphaHierarchyEnabled` por `routeProjectId`). `currentMemberId` já resolve via tool router.
- **zordon-daemon:** stubs + set; tirar `disallowedTools`/whitelist só-leitura se houver.
- **Guard:** decisão **D** — toggle global antes de ligar write autônomo.
- **Gates:** `tsc` · `http` (create_task aplica + respeita kill-switch) · vivo.
- **Não entra:** Composio.

### FASE 4 — Composio (GitHub/Calendar) `[BLOCKED → daemon v2]`
**Objetivo:** Alpha usa integrações per-user no daemon.
- **Bloqueio:** token per-user vs daemon service_role. Precisa de **auth per-user no daemon** (daemon v2). Até lá, Composio fica no path OpenRouter.
- Quando v2 existir: o daemon resolve o token Composio do `ownerId` do job e injeta como hoje o `buildTools` faz.

## 5 · Resumo dos blockers reais

1. **Mirror cross-repo** do toolset (todo Fase ganha stub no zordon-daemon). Risco de drift — `safeParse` no router cobre.
2. **`currentPath` não chega ao daemon** → route-scoped/hierarquia precisam do threading (Fase 2). Decisão **A/B**.
3. **Composio per-user** → bloqueado até daemon v2 (auth per-user). Decisão **C**.
4. **Write autônomo** → manter kill-switch + toggle (Decisão **D**).

## 6 · Recomendação de sequência

Fase 1 já entrega um Alpha-daemon útil (ops read + prompt bom) sem tocar em schema nem em writes — **fazer primeiro**. Fase 2 (currentPath) destrava o route-scoping e é pré-requisito da hierarquia. Fase 3 atrás de toggle. Fase 4 só com daemon v2.
