# VITORIA — SUPERFÍCIE DE AÇÃO COMPLETA EM PLANNING — Runbook

> Não-Ralph. Capacidade evolutiva com julgamento + human-in-the-loop — iterada por humano + Claude, não por loop autônomo. Mesmo regime do [vitoria-weekly-planning-runbook.md](vitoria-weekly-planning-runbook.md).
>
> Substrato: a Vitoria já roda planning no daemon na surface `release_planning` ([vitoria-daemon-surfaces](../../src/lib/agent/agents/vitoria/index.ts)). Este runbook **fecha a lacuna de ação** do toolset dela — não inventa surface nova, não muda o modelo de aprovação.
>
> Origem: calibração real da Vitoria na surface `release_planning` via daemon, 2026-06-21 (capture `e853c860` + leitura do toolset). Achados de schema verificados lendo `src/lib/agent/agents/vitoria/tools.ts`, `src/lib/agent/tools-registry.ts`, `src/lib/meetings/task-action-executor.ts` e a migration `20260427_meetings_daily_super_planning.sql`.
>
> Data de abertura: 2026-06-21.

---

## 0 · NORTH STAR — O QUE FICA PRONTO

A Vitoria vira a **interface principal e inteligente de planning**: usando áudios do Granola curados + mais contexto, ela vai **mudando a sprint** (PFV, status, comentários), **criando e atualizando continuamente** — sem o PM precisar abrir sprint na mão nem mexer task por task.

Uma frase: **fechar a lacuna entre o que a Vitoria entende e o que ela consegue fazer no board — dando sprint-CRUD, bulk-update, comentário e Granola curado, tudo dentro do modelo de aprovação que já existe.**

---

## 1 · A DOR

A inteligência da Vitoria em planning é forte — ela lê contexto, aterra (NÃO alucina), segue convenção quando instruída. O **gargalo é a superfície de ação**: o que ela consegue _fazer_ no board é menor do que o que ela consegue _entender_. Três problemas concretos, todos confirmados lendo `src/lib/agent/agents/vitoria/tools.ts` + `src/lib/agent/tools-registry.ts`:

1. **Não cria nem edita Sprint.** Ela só lê (`list_project_sprints`). Em planning multi-sprint (visão "Planning = planner geral", [[project_planning_as_general_planner]]) ela precisa pedir ao PM pra abrir cada sprint na mão antes de poder distribuir trabalho. O `move` (`propose_task_action type=move`) exige um `targetSprintId` que talvez ainda não exista.
2. **Edição de tasks em escala é 1-a-1.** `propose_task_action(type=update)` muta uma task por chamada. Reordenar/repriorizar PFV ou status de 20 tasks = 20 tool calls = 20 round-trips, estourando o orçamento de output de um turno (um turno medido gerou ~30k tokens out / 346s). Não há bulk-update.
3. **Não comenta em task e Granola fica fora da surface.** Não existe tool de comentário, embora a tabela `TaskComment` (`body`/`authorMemberId`/`mentionedMemberIds`/`taskId`, soft-delete) **já exista no schema**. E `read_transcript_content` (leitura curada de Granola/transcript) só está no toolset de PM Review (`VITORIA_PMREVIEW_TOOLS`) — em planning ela só lê transcript se ele for um `ContextSource`, perdendo o áudio curado como insumo de planejamento.

Efeito composto: a visão do dono (§0) não é alcançável com o toolset atual. A planning fecha e o board sai pela metade — o PM ainda precisa abrir sprint, arrastar task e anotar o porquê na mão.

---

## 2 · O QUE A VITORIA QUER (jornada)

- **PM (humano, ex.: Vitória/João):** _"Eu quero descrever a sprint em voz alta no Granola e ver a Vitoria já abrir a Sprint N+1, distribuir as tasks com PFV, e me deixar só revisar e aplicar — não quero abrir sprint na mão nem mexer task por task."_
- **Vitoria (agente PM):** _"Eu entendo o que precisa acontecer — leio o transcript curado, vejo a capacidade, sei a ordem. Mas hoje eu travo: não consigo criar a sprint que preciso, nem repriorizar 15 tasks de uma vez, nem deixar um comentário pra explicar uma decisão na própria task."_
- **Builder (consome o board):** _"Quando a planning fecha, eu quero ver a task na sprint certa, com PFV e um comentário da Vitoria explicando o porquê — não um board vazio que o PM ainda vai arrumar depois."_

---

## 3 · DECISÕES TRAVADAS (imutáveis — não rediscutir no meio da fase)

| Dn | Decisão | Por quê |
|----|---------|---------|
| **D1** | Mantém o modelo **staging-proposal** (`MeetingTaskAction` → PM aplica ao Concluir) como default pra mutação de **task**. Fast-apply lane pra ops de baixo risco (move/status) é fase ≥2, fora deste runbook. | Human-in-loop é o invariante de confiança atual ([task-action-executor.ts](../../src/lib/meetings/task-action-executor.ts)). Não quebrar antes de ter telemetria de qualidade (`AgentProposalOutcome`). |
| **D2** | Toda tool nova de escrita injeta `projectId`/`planningId`/`memberId` via **closure no tool router** (`buildVitoriaTools(planningId, projectId, …)`), nunca como arg do modelo. | Espelha `propose_task_action`/`propose_story`. Expor `projectId` ao modelo era footgun (FK violation / projeto errado) — comentado no próprio schema atual. |
| **D3** | Toda tool nova é **espelhada nos DOIS repos**: monorepo `src/lib/agent` (com `execute` real) + `zordon-daemon/src/lib/agent` (schema-stub sem `execute`, registrado nas mesmas `VITORIA_*` arrays + surface sets). | Daemon anuncia o schema da própria cópia e proxia execução pro tool router do app ([[project_daemon_tool_advertisement]]). Drift = modelo vê schema errado. |
| **D4** | Granola entra na surface planning via **`read_transcript_content`** (mesma tool curada do PM Review), paginada por `offset` — NÃO despejo cru. | Anti-bloat ([[project_structured_context_sources]]): leitura em janela, modelo extrai antes de propor. Reusa a tool existente, não cria nova lógica de leitura. |
| **D5** | Escala de planning longa: **(1)** compaction já existente (`AgentSession.turnsSinceCompact`/`lastSummary`); **(2)** decompor lotes grandes via `describe_structured_source`/`query_structured_source` (querying SQL, não leitura crua) ANTES de cogitar subagente. **Subagente = fase ≥2.** | Daemon hoje **bloqueia `Task`/`Read`/`Grep`** (`disallowedTools` em [exec-chat-turn.ts](../../../zordon-daemon/scripts/daemon/exec-chat-turn.ts)). Reabrir isso é mudança de arquitetura do daemon, não de toolset. Ataca-se primeiro o que cabe no toolset. |
| **D6** | **Sprint create/update** NÃO usa o staging `MeetingTaskAction`. Vira **write direto** ao confirmar em chat — espelhando `propose_story`, que cria a story NA HORA (live no board) enquanto as tasks ficam staged. | O `MeetingTaskAction.type` é `CHECK IN ('create','update','delete','move','review')` e é **task-scoped** (migration `20260427_meetings_daily_super_planning.sql`). Adicionar `type='sprint_*'` quebraria o executor (`ORDER` map, guards) e o contrato do apply. Sprint é container, não item — mesma semântica de `propose_story` (live container, staged items). |
| **D7** | **Comentário** reusa a tabela `TaskComment` existente (write direto, `authorMemberId` = membro do thread, `body` + `mentionedMemberIds`). Sem nova entidade, sem staging. | Tabela **já existe e modela exatamente isto**. Comentário é anotação de baixo risco, não muta o estado planejável da task (PFV/status/sprint) — não precisa do staging do D1. |
| **D8** | **Datas/config do projeto (`Project.startDate`/`endDate`)** ficam admin-only (UI). NENHUMA tool de mutação de projeto entra no toolset da Vitoria. | Mutação de janela do projeto é decisão comercial, não de planning. Risco alto, frequência baixa — não vale o footgun. Fase ≥2 se provar valor. |
| **D9** | **Bulk-update** é UM `propose_task_action`-equivalente em lote: tool `propose_task_bulk_update` que recebe `updates: [{ taskId, patch }]` e cria N `MeetingTaskAction(type='update')` numa inserção (espelha `propose_tasks`). NÃO muda o executor (cada row continua um update individual no apply). | Reusa o caminho de apply já validado (`writeUpdate`). O ganho é no write (1 tool call → N rows) e no orçamento de output do turno, não na semântica de apply. |
| **D10** | **`acceptanceCriteria` vira campo opcional** em cada linha de `propose_tasks`. O executor **já lê** `payload.acceptanceCriteria` via `coerceAcTexts` — só falta expor no schema do batch. Continua opcional (backfill/kickoff dispensam SDD; create prospectivo single segue exigindo via `propose_task_action`). | Fecha o gap da capture `e853c860` (batch não tinha AC) sem endurecer o batch — manter a assimetria intencional (single = cerimônia dura; batch = forma + integridade). |
| **D11** | **Convenção de título** (sprints "Sprint N", [[feedback_sprint_naming]]) é instruída no **system prompt** da surface planning, não enforçada por schema. | Schema strictness > prompt strictness só vale pra invariantes de integridade; naming é convenção mole, e o prompt já é onde a Vitoria recebe convenções. Default ao criar via tool = "Sprint N" auto-numerado. |
| **D12** | Todo write novo que cria/muta entidade da IA grava **procedência**: sprint create cita a(s) nota(s)/transcript de origem no `goal` ou num `add_context_note`; comentário cita a fonte no `body`; bulk-update exige `sourceNoteIds` (≥1) como o single. | Invariante anti-alucinação do projeto ([[feedback_grounded_no_hallucination]]): conteúdo gerado por LLM sempre rastreia a fonte. |

---

## 4 · ARQUITETURA & CONTRATOS

### 4.1 — Mapa de execução (2 repos, 1 caminho)

```
                 ┌─────────────────────────── zordon-daemon (Mac do João) ──────────────────────────┐
  PM no chat ──▶ │  exec-chat-turn.ts                                                                │
  (surface=      │   allowedTools = getToolNamesForAgent("vitoria","release_planning")               │
   release_      │                   .map(n => `mcp__zordon__${n}`)                                   │
   planning)     │   disallowedTools = [Task, Read, Grep, …]  (subagente bloqueado — D5)              │
                 │   mcpServers.zordon → mcp-server (lê SÓ .inputSchema dos stubs)                    │
                 │                                                                                    │
                 │   tools-registry.ts (STUBS, sem execute)                                          │
                 │     VITORIA_RELEASE_PLANNING_TOOLS ⊃ { …shared_read, propose_*,                    │
                 │       + propose_sprint, update_sprint, propose_task_bulk_update,                   │
                 │       + add_task_comment, read_transcript_content }                                │
                 │     agents/vitoria/tools.ts → buildVitoriaTools() stubs                            │
                 └────────────────────────────────────┬───────────────────────────────────────────-─┘
                                                       │ HTTP (execução proxiada)
                                                       ▼
                 ┌──────────────────────── monorepo (app — execução real) ───────────────────────────┐
                 │  /api/agents/tools/<name>  → TOOL_REGISTRY[name](ctx)                              │
                 │  src/lib/agent/tools-registry.ts                                                   │
                 │    VITORIA_RELEASE_PLANNING_TOOLS (mesmo set + as 5 novas)                          │
                 │  src/lib/agent/agents/vitoria/tools.ts  (buildVitoriaTools — execute real)         │
                 │    propose_sprint ─────────▶ INSERT Sprint (live, D6)                              │
                 │    update_sprint ──────────▶ UPDATE Sprint (live, D6)                              │
                 │    propose_task_bulk_update ▶ INSERT N×MeetingTaskAction(type=update) (staged, D9) │
                 │    add_task_comment ───────▶ INSERT TaskComment (live, D7)                         │
                 │    propose_tasks (+ AC opcional, D10)                                              │
                 │    read_transcript_content (rebind p/ planning sem pmReviewId, D4)                 │
                 │                                                                                    │
                 │  Apply (PM Conclui): applyPendingActionsForPlanning → task-action-executor.ts      │
                 │    (inalterado — bulk-update vira N writeUpdate)                                    │
                 └────────────────────────────────────────────────────────────────────────────────-─┘
```

Cada caixa nova = uma factory em `buildVitoriaTools` (app) + um stub em `buildVitoriaTools` (daemon) + uma entrada nos sets de surface dos DOIS `tools-registry.ts`. **A regra das 2 cópias é não-negociável** ([[project_daemon_tool_advertisement]]) — drift entre os repos faz o modelo ver schema stale.

### 4.2 — Contrato das 5 capacidades novas

Não há endpoint HTTP novo de produto. As tools rodam pelo tool router genérico já existente: `POST /api/agents/tools/<name>` resolve `ctx` do `chatTurnId` e roda `TOOL_REGISTRY[name](ctx).execute(args)`. O contrato é o protocolo MCP/tool, não REST.

| Tool (MCP) | Args (do modelo) | Efeito | Modelo de mutação |
|------------|------------------|--------|-------------------|
| `propose_sprint` | `{ name?, startDate?, goal? }` (endDate derivado seg→dom) | INSERT Sprint (datas auto via sprint-dates se omitidas; status→`upcoming`) | **live** (D6) — retorna `{ sprintId, name, startDate, endDate, status }` |
| `update_sprint` | `{ sprintId, name?, startDate?, goal?(null limpa), status? (upcoming\|active\|completed) }` | UPDATE Sprint (merge shallow) | **live** (D6) — retorna `{ sprintId, fieldsUpdated, sprint }` |
| `propose_task_bulk_update` | `{ updates: [{ taskId, patch }], reasoning, sourceNoteIds[], aiConfidence? }` | N× INSERT MeetingTaskAction(type=update) | **staged** (D9) — retorna `{ created, errors[] }` |
| `add_task_comment` | `{ taskId, body, mentionedMemberIds? }` | INSERT TaskComment | **live** (D7) |
| `read_transcript_content` | `{ transcriptRefId, offset? }` | leitura paginada de transcript curado | read-only (D4) |
| `propose_tasks` (alterada) | linha agora aceita `acceptanceCriteria?: string[]` | — | staged (inalterado) |

Todas resolvem `projectId`/`planningId`/`memberId` do `ctx` (D2). Async não se aplica (tools são síncronas sob 1s; leitura de transcript pagina, não bloqueia).

### 4.3 — Fluxo-alvo (a surface é o chat de planning que já existe)

```
┌─ Chat: Planning (Projeto X) ───────────────────────────────────────────────┐
│ PM:  "ouvi o granola de hoje, abre a Sprint 12 e joga o backlog de cobrança │
│       lá com PFV; comenta na VLD-204 que o cliente mudou o escopo"          │
│                                                                             │
│ Vitoria: [read_transcript_content tref_abc offset=0]  ← lê Granola curado   │
│          [propose_sprint name="Sprint 12"]            → Sprint criada (live)│
│          [propose_task_bulk_update 8 tasks → Sprint 12] → 8 propostas       │
│          [add_task_comment VLD-204 "cliente mudou escopo: …"] (live)        │
│                                                                             │
│  ┌─ Staging (8 propostas pendentes) ──────────────────────────────────┐    │
│  │ ⤷ mover/atualizar 8 tasks → Sprint 12                               │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│  [ Concluir planning ]  ← PM aplica o staging (D1)                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

Sprints criadas e comentários aparecem **ao vivo** no board (não esperam o Concluir); bulk-updates ficam no staging riscado até o PM aplicar — exatamente o padrão `propose_story` (live) vs `propose_task_action` (staged).

---

## 5 · SCHEMA — o que muda: ~nada

**Nenhuma migration de tabela nova.** A Fase 1 reusa o schema existente. Achados verificados no banco/migrations:

- **`TaskComment` já existe** (`body`/`authorMemberId`/`mentionedMemberIds`/`taskId`, soft-delete) e modela exatamente o comentário (D7) → **comentário sem migration**, write direto.
- **`MeetingTaskAction.type` é `CHECK IN ('create','update','delete','move','review')`** e task-scoped (migration `20260427_meetings_daily_super_planning.sql`) → **sprint-CRUD NÃO cabe no staging**; vira write direto live (D6). Adicionar `type='sprint_*'` quebraria o executor.
- **`propose_tasks` não tem campo AC hoje**, mas o executor **já chama `coerceAcTexts`** sobre `payload.acceptanceCriteria` → AC no batch é **só expor no schema** (D10), zero código no executor.
- **`read_transcript_content` está bound a PM Review** (resolve via `pmReviewId`) → precisa de **rebind** pra resolver `pmReviewId ?? planningId/projectId` sem sair do PM Review (D4).
- **`propose_sprint`/`update_sprint`** → `INSERT`/`UPDATE` em `Sprint` (`name`, `startDate`, `endDate`, `goal`, `status`, `projectId`). Já tem `Sprint_projectId_fkey` + RLS de projeto. CHECK de semana (seg→dom, [[project_sprint_week_model]]) já vive no DB — `propose_sprint` deriva datas via `src/lib/sprint-dates.ts` (`getNextSprintDefaults`) pra nunca violar.
- **`propose_task_bulk_update`** → N× `INSERT MeetingTaskAction` (`type='update'`, `decision='pending'`, `execution='pending'`, `source='ai'`, `projectId`/`planningCeremonyId` do closure). Nenhuma coluna nova — `payload` (jsonb) carrega o patch por task. CHECK `type IN (...)` já admite `'update'`.

> **Dívida RLS (OQ-1, §10):** se `Sprint` não tiver policy de INSERT/UPDATE pro membro do thread (só `service_role`), vira migration atômica extra. Hoje daemon roda `service_role` ([[project_daemon_v1_v2]]) então o write passa; a RLS é defesa pro daemon v2 (token de usuário). **Não-bloqueante pra Fase 1.**

---

## 6 · PASSOS DE IMPLEMENTAÇÃO (Fase 1)

Sete passos. Cada um lista **arquivos tocados** + **critério de pronto**. Todo passo que adiciona/altera tool **espelha no `zordon-daemon`** ([[project_daemon_tool_advertisement]]) e **reinicia o daemon** depois (ele carrega o registry no boot). Verificação base de todos: `tsc --noEmit` limpo nos dois repos.

Os passos sem dependência entre si (P1–P5) podem ser pegos em qualquer ordem; **P6 depende de P5** (update precisa do create) e **P7 depende de P2+P4+P5** (o prompt referencia as tools já existentes).

### P1 — AC opcional no `propose_tasks` (batch)

Adiciona `acceptanceCriteria?: string[]` em cada linha do array `tasks` do schema de `propose_tasks`. O executor já lê `payload.acceptanceCriteria` via `coerceAcTexts` — só passar o campo pro payload da row.

- **Toca:** `src/lib/agent/agents/vitoria/tools.ts` · `../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts`
- **Pronto quando:** o Zod de `tasks[]` aceita `acceptanceCriteria` opcional (`z.array(z.string()).optional()`); o `execute` inclui `acceptanceCriteria` no payload da row quando presente; o stub do daemon tem o mesmo campo; `tsc` passa nos dois repos.
- **Check:** `grep -c 'acceptanceCriteria' src/lib/agent/agents/vitoria/tools.ts` ≥ 2 e ≥ 1 no stub do daemon.

### P2 — `read_transcript_content` na surface `release_planning`

Rebind da tool pra funcionar sem `pmReviewId` (resolve `pmReviewId ?? planningId/projectId`) e adiciona-a ao set `VITORIA_RELEASE_PLANNING_TOOLS` nos DOIS `tools-registry.ts`. **Não pode remover a tool do PM Review.**

- **Toca:** `src/lib/agent/tools-registry.ts` · `src/lib/agent/agents/vitoria/pm-review.ts` · `../zordon-daemon/src/lib/agent/tools-registry.ts`
- **Pronto quando:** `read_transcript_content` aparece em `VITORIA_RELEASE_PLANNING_TOOLS` E continua em `VITORIA_PMREVIEW_TOOLS` (não removida); a factory resolve a tool sem exigir `pmReviewId` quando `surface=release_planning`; mesma adição no set do daemon; `tsc` nos dois repos.
- **Check:** a tool consta nos dois sets (`VITORIA_RELEASE_PLANNING_TOOLS` e `VITORIA_PMREVIEW_TOOLS`) em `tools-registry.ts`.

### P3 — `add_task_comment` (TaskComment, write direto)

Tool nova em `buildVitoriaTools`: INSERT em `TaskComment` (`taskId`, `body`, `authorMemberId=ctx.memberId`, `mentionedMemberIds` default `[]`). Valida que a task pertence ao projeto. Write direto (D7). `memberId` precisa ser threadado pro closure (`buildVitoriaTools` ganha `memberId` opcional).

- **Toca:** `src/lib/agent/agents/vitoria/tools.ts` · `src/lib/agent/tools-registry.ts` · `../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts` · `../zordon-daemon/src/lib/agent/tools-registry.ts`
- **Pronto quando:** `buildVitoriaTools` expõe `add_task_comment` que insere em `TaskComment`; valida `task.projectId === projectId` antes de inserir (rejeita cross-project); a tool está em `VITORIA_PLANNING_TOOLS` + `VITORIA_RELEASE_PLANNING_TOOLS` nos dois registries; stub no daemon; `tsc` nos dois repos.
- **Check:** `grep -c add_task_comment` ≥ 1 em `tools.ts`, ≥ 2 em `tools-registry.ts`, ≥ 1 no stub do daemon.

### P4 — `propose_task_bulk_update` (N×MeetingTaskAction type=update)

Tool nova: recebe `updates:[{taskId, patch}]`, `reasoning`, `sourceNoteIds(≥1)`, `aiConfidence`. Valida cada linha (taskId existe no projeto, patch não-vazio) e insere N `MeetingTaskAction(type='update', decision/execution=pending, source=ai)` numa inserção. Devolve `{created, errors:[{index,msg}]}`. **Reusa o caminho de apply existente** (D9) — não toca o executor.

- **Toca:** `src/lib/agent/agents/vitoria/tools.ts` · `src/lib/agent/tools-registry.ts` · `../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts` · `../zordon-daemon/src/lib/agent/tools-registry.ts`
- **Pronto quando:** insere uma `MeetingTaskAction(type=update)` por linha de `updates[]` com `payload=patch`; exige `sourceNoteIds ≥1` (espelha `propose_task_action`) e `reasoning`; retorna `{created, errors}` com validação por-index (taskId inexistente vira erro na linha, não derruba o lote); presente nos dois sets dos dois registries; stub no daemon; `tsc` nos dois repos.
- **Check:** `grep -c propose_task_bulk_update` ≥ 1 em `tools.ts`, ≥ 2 em `tools-registry.ts`, ≥ 1 no stub do daemon.

### P5 — `propose_sprint` (INSERT Sprint live)

Tool nova: cria Sprint (live, D6). Args `{name?, startDate?, goal?}` (NÃO expõe `endDate` — é derivado do `startDate` pelo CHECK seg→dom de 7d; expor seria footgun). Datas omitidas → deriva via `src/lib/sprint-dates.ts` `getNextSprintDefaults` (seg→dom). `name` omitido → auto-numera "Sprint N" (D11). **`status` omitido → default do DB `'upcoming'`** (lifecycle 3-estados `upcoming|active|completed`, migration `20260504_sprint_lifecycle_3_states.sql` — `'planned'` é valor LEGADO, não usar). Retorna `{sprintId, name, startDate, endDate, status}`. Grava procedência no `goal` quando relevante (D12). Conflitos `23505` (semana/nome duplicado) viram erro legível pro modelo se corrigir.

- **Toca:** `src/lib/agent/agents/vitoria/tools.ts` · `src/lib/agent/tools-registry.ts` · `../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts` · `../zordon-daemon/src/lib/agent/tools-registry.ts`
- **Pronto quando:** `propose_sprint` faz INSERT em `Sprint`; datas omitidas derivadas via `getNextSprintDefaults` (não viola o CHECK seg→dom); `name` omitido auto-numera "Sprint N"; retorna `{sprintId, name}`; write é **live** (não cria `MeetingTaskAction`); presente nos dois sets dos dois registries; stub no daemon; `tsc` nos dois repos.
- **Check:** `grep -cE 'propose_sprint|getNextSprintDefaults'` ≥ 2 em `tools.ts`; `propose_sprint` ≥ 1 no stub do daemon.

### P6 — `update_sprint` (UPDATE Sprint live) — depende de P5

Tool nova: edita Sprint existente (live, D6). Args `{sprintId, name?, startDate?, goal?(nullable), status?}` — `status` é enum `upcoming|active|completed` (NÃO `'planned'`); `startDate` re-ancora a janela seg→dom (endDate derivado, não exposto). Valida `sprint.projectId === projectId`. Merge shallow: só campos passados, seta `updatedAt`. Retorna `{sprintId, fieldsUpdated, sprint}`. Conflito `23505` em `sprint_one_active_per_project` (2ª active) vira erro legível.

- **Toca:** `src/lib/agent/agents/vitoria/tools.ts` · `src/lib/agent/tools-registry.ts` · `../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts` · `../zordon-daemon/src/lib/agent/tools-registry.ts`
- **Pronto quando:** `update_sprint` faz UPDATE em `Sprint`; valida sprint pertence ao projeto (rejeita cross-project); atualiza só os campos passados (merge shallow), seta `updatedAt`; presente nos dois sets dos dois registries; stub no daemon; `tsc` nos dois repos.
- **Check:** `grep -c update_sprint` ≥ 1 em `tools.ts`, ≥ 2 em `tools-registry.ts`, ≥ 1 no stub do daemon.

### P7 — Convenção de naming + novas tools no prompt — depende de P2+P4+P5

Atualiza `buildReleasePlanningPrompt` instruindo: (a) sprints nomeadas "Sprint N" via `propose_sprint` (D11); (b) ler Granola curado via `read_transcript_content` antes de propor (D4); (c) gravar procedência (nota/transcript) em writes live de sprint/comentário (D12); (d) preferir `propose_task_bulk_update` a N× `propose_task_action`. **O prompt é build app-side** (prepare-turn proxia pro daemon), então **NÃO há cópia no daemon** — só este arquivo muda.

- **Toca:** `src/lib/agent/agents/vitoria/release-planning.ts` (apenas monorepo)
- **Pronto quando:** o prompt menciona a convenção "Sprint N" + `propose_sprint`, `read_transcript_content` como insumo, e `propose_task_bulk_update` pra edição em escala + gravar procedência; `tsc`/build passa.
- **Check:** `grep -cE 'Sprint N|propose_sprint|read_transcript_content|propose_task_bulk_update' src/lib/agent/agents/vitoria/release-planning.ts` ≥ 3.

### Definição de pronto da Fase 1

Os 7 passos mergeados, `tsc` limpo nos dois repos, daemon reiniciado, e um smoke no chat de planning: PM pede "abre Sprint N e joga essas tasks com PFV, comenta na X" → Vitoria chama `read_transcript_content` → `propose_sprint` (sprint aparece live no board) → `propose_task_bulk_update` (staging riscado) → `add_task_comment` (comentário live) → PM Conclui → bulk vira N `writeUpdate`. **Nenhuma capacidade existente removida.**

---

## 7 · FASEAMENTO (1→3 · cada fase entrega mais que o sistema atual)

| Fase | Entrega | Toca |
|------|---------|------|
| **1 — Superfície de ação completa** | sprint create/update (live), bulk-update de tasks (staged), comentário (live), AC opcional no batch, Granola curado na surface planning, prompt atualizado. Entrega **mais** que hoje (a Vitoria não faz nenhuma dessas) e roda em paralelo — nada existente é removido. | tools nos 2 repos + prompt app-side. **Não** toca schema, **não** toca o executor de apply, **não** reabre `Task` no daemon. |
| **2 — Autonomia controlada** | fast-apply lane pra ops de baixo risco (D1); subagente/fan-out reabrindo `Task` no daemon (D5) — **mudança de arquitetura do daemon, 2 repos + restart**; mutação de datas de projeto se a operação provar valor (D8). | daemon (arquitetura) + executor (lane nova) + toolset. |
| **3 — Loop de aprendizado** | planning versionada ([[project_planning_versioned_living]]) consumindo os outcomes das novas tools (bulk-update gera N `AgentProposalOutcome`; sprint/comentário live não geram — são containers/anotações). | leitura nova sobre dados existentes. |

A Fase 1 entrega ≥ o que existe hoje **sem regressão** — só amplia.

---

## 8 · INTEGRAÇÕES (quem encosta nisso)

- **Daemon (`zordon-daemon`):** toda tool nova precisa do stub espelhado + entrada no set de surface (D3). **Reiniciar o daemon após o mirror** (ele carrega o registry no boot). Os 4 arquivos que toda tool nova toca: 2× `tools.ts` + 2× `tools-registry.ts`.
- **PM Review:** `read_transcript_content` passa a ser **compartilhada** entre PM Review e Planning. O rebind (D4/P2) não pode quebrar o PM Review — a factory resolve `pmReviewId` OU `planningId`/`projectId`. Verifiable: `VITORIA_PMREVIEW_TOOLS` ainda contém a tool.
- **Planning Vivo / `propose_story`:** sprints live + comentários live convivem com o staging de tasks; o anti-duplicador do executor não é afetado (sprint não passa pelo executor).
- **Métricas (`AgentProposalOutcome`):** bulk-update gera N rows → N outcomes no apply (já coberto por `recordProposalOutcome`). Sprint/comentário live **não** geram outcome (não passam pelo executor) — aceitável (containers/anotações, não propostas de trabalho).

---

## 9 · RISCOS

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Drift de schema entre app e daemon (stub desatualizado) | Médio | Médio | D3 + o tool router faz `safeParse` na execução (rede de segurança existente). Todo passo de tool toca os 4 arquivos (2 `tools.ts` + 2 `tools-registry.ts`). |
| `read_transcript_content` rebind quebra PM Review | Médio | Alto | Factory resolve `pmReviewId ?? planningId` (não troca a assinatura do PM Review). `tsc` + check de que `VITORIA_PMREVIEW_TOOLS` ainda contém a tool. |
| Sprint live cria lixo (Vitoria abre sprint errada, sem staging pra reverter) | Médio | Médio | D11 (naming auto "Sprint N") + D12 (procedência no `goal`) + `update_sprint` permite corrigir. PM vê a sprint ao vivo e edita/exclui na UI. |
| Bulk-update muta task congelada | Baixo | Baixo | Nenhuma mitigação nova: o guard `FROZEN_STATUSES` do `task-action-executor.ts` já pula `in_progress/review/done` no apply. Bulk-update reusa o mesmo apply. |
| Comentário live sem rate-limit (Vitoria spammando) | Baixo | Baixo | Comentário só por instrução explícita do PM (prompt); `add_task_comment` não roda em loop autônomo. Monitorar via `TaskComment.authorMemberId`. |
| Output do turno ainda estoura mesmo com bulk-update | Baixo | Médio | D5: compaction + querying estruturado. Bulk-update já corta o nº de tool calls em ~N×. |

---

## 10 · MÉTRICAS DE SUCESSO

| Métrica | Instrumento |
|---------|-------------|
| Vitoria cria ≥1 sprint por planning sem PM abrir na mão | `SELECT count(*) FROM "Sprint" WHERE "createdAt" > <planning.start> AND "projectId"=<p>` correlacionado ao thread; ou flag `createdByAgent` se adicionada (opcional) |
| Bulk-update reduz tool calls/turno | `AgentUsage` (`20260529_agent_usage_telemetry.sql`): tokens-out e nº de tool calls por `chatTurnId` antes/depois |
| Comentários da Vitoria aplicados | `SELECT count(*) FROM "TaskComment" WHERE "authorMemberId"=<vitoria_member> AND "createdAt" > <date>` |
| AC presente em tasks de batch | `SELECT count(*) FROM "AcceptanceCriterion" ac JOIN "Task" t ON t.id=ac."taskId" WHERE t."createdByAgent" AND t."createdAt" > <date>` |
| Outcomes de bulk-update | `SELECT decision, count(*) FROM "AgentProposalOutcome" WHERE "agentName"='vitoria' AND "callKind"='turn' GROUP BY decision` |

---

## 11 · FRONTIER / O QUE FALTA (open questions)

- **OQ-1 (Fase 1, não-bloqueante):** RLS de `Sprint` cobre INSERT/UPDATE pelo membro do thread (não só `service_role`)? Se não, vira migration atômica extra. Hoje daemon = `service_role` então não bloqueia; é dívida pro daemon v2 ([[project_daemon_v1_v2]]).
- **OQ-2 (Fase ≥2):** comentário deve virar `add_context_note` + `TaskComment` (duplo registro pra rastrear na planning) ou só `TaskComment`? Decidido D7 = só `TaskComment` por ora; revisitar se a planning versionada precisar do comentário na sua timeline.
- **OQ-3 (Fase ≥2):** fast-apply lane (D1) — quais ops são "baixo risco" o suficiente pra aplicar sem PM (move/status)? Atrás de toggle por projeto, e só depois de `AgentProposalOutcome` mostrar qualidade alta.

---

## 12 · FORA DE ESCOPO (não deixe a sessão derivar)

- **Stories (#6).** A geração/refino de UserStory pela Vitoria tem runbook próprio. Aqui só task/sprint/comentário/transcript. `propose_story` (que já existe) não muda.
- **Fast-apply lane / auto-aplicação sem PM.** Human-in-loop permanece (D1). Lane direta = fase ≥2.
- **Subagentes (Claude `Task` tool) na Fase 1.** O daemon bloqueia `Task`/`Read`/`Grep` por design (D5). Fan-out via subagente = fase ≥2.
- **Mutação de config/datas do projeto por LLM** (D8) — admin-only (UI), fora do toolset da Vitoria.
- **PRD↔sprint board.** Saiu da surface em 2026-06-19 (a planning lê PRDs e produz tasks). Não reabrir.

---

## 13 · REFERÊNCIAS DE CÓDIGO (vivo)

- **Toolset atual:** [src/lib/agent/agents/vitoria/tools.ts](../../src/lib/agent/agents/vitoria/tools.ts) · [src/lib/agent/tools-registry.ts](../../src/lib/agent/tools-registry.ts) (`VITORIA_RELEASE_PLANNING_TOOLS`, `getToolNamesForAgent`)
- **Executor de staging:** [src/lib/meetings/task-action-executor.ts](../../src/lib/meetings/task-action-executor.ts) (`applyPendingActionsForPlanning`, `writeUpdate`, `coerceAcTexts`, `FROZEN_STATUSES`)
- **Prompt da surface:** [src/lib/agent/agents/vitoria/release-planning.ts](../../src/lib/agent/agents/vitoria/release-planning.ts) (`buildReleasePlanningPrompt`)
- **PM Review transcript tool:** [src/lib/agent/agents/vitoria/pm-review.ts](../../src/lib/agent/agents/vitoria/pm-review.ts) (`read_transcript_content`)
- **Sprint dates:** [src/lib/sprint-dates.ts](../../src/lib/sprint-dates.ts) (`getNextSprintDefaults`) · Sprint CHECK + `MeetingTaskAction.type` CHECK: [supabase/migrations/20260427_meetings_daily_super_planning.sql](../../supabase/migrations/20260427_meetings_daily_super_planning.sql)
- **Daemon mirror:** `zordon-daemon/src/lib/agent/agents/vitoria/tools.ts` (stubs) · `zordon-daemon/src/lib/agent/tools-registry.ts` · `zordon-daemon/scripts/daemon/exec-chat-turn.ts` (allowed/disallowedTools)
- **Telemetria:** `supabase/migrations/20260529_agent_usage_telemetry.sql` (`AgentUsage`)
- **Runbooks irmãos:** [vitoria-weekly-planning-runbook.md](vitoria-weekly-planning-runbook.md) · [pm-review-unified-app-runbook.md](pm-review-unified-app-runbook.md)
- **Memories:** [[project_daemon_tool_advertisement]] · [[project_planning_as_general_planner]] · [[project_vitoria_daemon_surfaces]] · [[feedback_sprint_naming]] · [[feedback_grounded_no_hallucination]] · [[project_structured_context_sources]] · [[project_sprint_week_model]] · [[project_daemon_v1_v2]] · [[project_planning_versioned_living]]

---

## 14 · HANDOFF: o que NÃO tocar

Para o próximo agente que implementar a Fase 1:

1. **NÃO** crie migration de tabela. A Fase 1 reusa `TaskComment`, `Sprint`, `MeetingTaskAction` como estão.
2. **NÃO** adicione `type='sprint_*'` ao CHECK de `MeetingTaskAction` (D6). Sprint é write direto live, fora do staging.
3. **NÃO** mude o `task-action-executor.ts`. Bulk-update reusa `writeUpdate` (D9); AC já é materializado por `coerceAcTexts` (D10).
4. **NÃO** remova `read_transcript_content` do `VITORIA_PMREVIEW_TOOLS` ao adicioná-la em planning (D4/P2). A factory resolve `pmReviewId ?? planningId`.
5. **NÃO** exponha `projectId`/`memberId` como arg do modelo. Vem do closure no router (D2).
6. **SEMPRE** espelhe a tool nos 4 arquivos (2× `tools.ts` + 2× `tools-registry.ts`) e **reinicie o daemon** depois (D3 / [[project_daemon_tool_advertisement]]).
7. **NÃO** reabra `Task`/`Read`/`Grep` no daemon na Fase 1 (D5). Subagente é Fase 2 (mudança de arquitetura).
8. **VERIFIQUE** depois: PM Review continua chamando `read_transcript_content` sem erro (smoke no PM Review além do Planning).
