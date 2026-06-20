# Planning Vivo Versionado — o plano que lembra e aprende

**Status:** Desenho fechado · **Fase 1 (Log) IMPLEMENTADA (2026-06-19, ver Rev. 1)** · **Owner:** João · **Criado:** 2026-06-19 · **Atualizado:** 2026-06-19
**Uma frase:** o Release Planning deixa de ser um disparo que evapora ao "Aplicar" e vira um **board vivo versionado** — uma cadeia de versões onde cada nova versão constrói sobre o **board real** (não sobre o snapshot congelado), guarda uma **memória destilada** do raciocínio anterior, e depois acumula **outcome/aprendizado** (planejado vs entregue).

> Runbook (não-Ralph). Capability de plataforma com rationale de design — vive aqui, não em `docs/prd/`. Quando virar execução, as fases viram o checklist do §11. Saiu de uma conversa de design (2026-06-19); memória-âncora: `project_planning_versioned_living`.

> **Para o próximo agente:** leia §11 (HANDOFF) por último, mas comece por ele pra executar. Antes de tocar código, leia as memórias linkadas no §10 e **respeite a working tree** — há mudanças não-commitadas nos arquivos de release planning (local é SSOT; não dê stash/reset). Os números de linha aqui são orientativos: a árvore está viva, **confirme o estado atual** antes de editar.

---

## 1. A dor (o que evapora hoje)

Quando o PM clica **"Aplicar"** numa Release Planning, o canvas da esquerda vira **"Plano vazio"**. A tabela de sprints que a Vitoria montou (FP por sprint) + o briefing "Pontos que precisam da sua mão" **somem da tela**. O plano nunca foi um artefato durável — era saída efêmera de chat.

O dado não é *deletado* (transcript + ações persistem, ver §2), mas a **visão do plano** se perde. E sem visão durável do plano, não dá pra: (a) usar a planning como algo vivo (re-rodar toda semana / todo dia), (b) ver como o plano evoluiu, (c) aprender com o que deu certo.

## 2. Causa raiz (mecânica confirmada no código)

| Camada | O que acontece | Onde |
|---|---|---|
| **Canvas filtra só pendente** | `ReleasePlanningProposals` só renderiza propostas com `execution='pending'`. Ao aplicar, todas viram `execution='accepted'` → o filtro não casa → `hasPlan=false` → "Plano vazio". | `src/components/planning-session/release-planning-proposals.tsx`; empty-state em `src/app/(dashboard)/projects/[id]/planning/page.tsx` |
| **Aplicar consome as propostas** | `POST /api/planning/[id]/complete` → `concludePlanning` → `applyPendingActionsForPlanning`: aprova as ações pendentes, cria os `Task` reais, marca `execution='accepted'`, fecha a companion ceremony (`phase='closed'`). | `src/app/api/planning/[id]/complete/route.ts`; `src/lib/dal/planning.ts`; executor em `src/lib/dal/task-action-executor.ts` |
| **O que sobrevive** | Transcript inteiro (`ChatThread`/`ChatMessage`, `agentName=sessionId`, `channel='release_planning'`) + linhas `MeetingTaskAction` com `execution='accepted'` (trilha de auditoria). | `src/app/api/planning-sessions/[id]/chat/route.ts` |
| **O que NÃO existe** | Nenhum artefato durável e renderizável do *plano* depois do apply. O briefing era um turn de chat; a tabela de FP era texto. | — |

## 3. O modelo (consolidado)

Uma **Planning** é viva (1 por projeto/horizonte). É uma cadeia de **Versões**. Cada versão é:

- **chat fresco** (regenera por versão — bounded, sem thread infinito);
- semeada por uma **memória destilada** da versão anterior (o "como a gente tava pensando");
- aplicada como um **diff sobre o board VIVO** (constrói sobre a realidade);
- e depois acumula **outcome/aprendizado** (como o plano de fato foi).

```
V_n  lê:   board vivo (substrato)
         + memória da última versão (raciocínio)
         + outcomes das versões já decorridas (aprendizado)
   produz: o próximo diff (keyed por taskId)
   grava:  PlanningEvent (snapshot + briefing) + memória destilada
```

Mesma Vitoria, mesmo processo — só com memória. É o **loop de aprendizado fechado** (a filosofia de calibração de agente aplicada ao planejamento, ver `feedback_improve_and_learn_mission`).

**Analogia git, com uma torção:** HEAD = última versão; working tree = board vivo; nova versão = stage um diff e commita. A torção que **não** é git: a working tree **muda sozinha entre commits** porque os builders executam. Então uma nova versão não é "resetar pro último plano + meus edits" — é "**absorver o que a realidade fez, e então sobrepor minhas mudanças**". Esse drift é o *input*, não ruído.

## 4. Invariante central + decisões fixadas

> **Invariante (tatuar):** **build on the live board, remember the plan, learn from the outcome.** A memória/snapshot informa; **nunca** vira o estado a restaurar (senão ressuscita task fechada/deletada e atropela o builder).

| # | Decisão | Por quê |
|---|---|---|
| D1 | Planning vira **artefato durável versionado**. Cada "Aplicar" grava um `PlanningEvent` (append-only). | O canvas nunca mais fica "Plano vazio" após aplicar. Padrão de precedente: `ProjectPhaseEvent` (log append-only de fase). |
| D2 | **Base = board vivo; memória = referência.** A nova versão constrói sobre os `Task` reais (status/posição atuais); o snapshot anterior é contexto, nunca substrato a restaurar. | Ignorar o drift = reabrir trabalho fechado e atropelar builder. Restaurar versão é ação **explícita e separada**. |
| D3 | **Versão = diff keyed por `taskId`** (create + update/move/delete), não proposta do zero. | Mata o duplicador: re-propor "a mesma task" sem taskId hoje cria duplicata (§7). |
| D4 | **Trabalho em curso é congelado ao re-planning.** Task `in_progress`/`done` é read-only ao agente (ou só vira sugestão sinalizada). | O executor hoje **não tem guard de status** — move/sobrescreve/deleta qualquer task (§7). |
| D5 | **Chat regenera por versão** (thread por-versão). | Bounded context (briga recorrente: ver `project_structured_context_sources`). Hoje é 1 `ChatThread` infinito por `sessionId`. |
| D6 | **Memória destilada por versão**, autorada de **ground-truth** (chat da própria versão + board + outcome), **não da memória anterior**. | Destilar da destilação = fotocópia da fotocópia → drift composto. A nova sessão *lê* as últimas 1–2 memórias, mas não destila delas. |
| D7 | **Outcome = planejado-vs-entregue POR SPRINT** (instrumento SQL); **learning = padrão cross-version**. | "Como foi" precisa de instrumento ou vira achismo. Feed natural pro Metrics Registry (`project_metrics_registry`). |
| D8 | Snapshot **sem jsonb** — child table `PlanningEventSprint` denormalizada (`sprintLabel` sobrevive a delete/rename de sprint). | Padrão SQL-first do projeto (ver `project_planning_ceremony`). |
| D9 | **Reaproveitar a `Regua`** como strip: sprint vira **régua de fundo**, versão vira **chip sobre a régua** (eixo = calendário). | Sprint é *intervalo*, versão é *ponto*; uso diário gera N versões/sprint → não cabe "1 chip = 1 sprint". Reconcilia o visual sem brigar com o modelo. |
| D10 | **NÃO mergear Sprint Planning na Fase 1.** `PlanningCeremony` fica como está. | Reduz risco. O merge (absorver a ceremony per-sprint como filtro) é Fase 2 — o Log é pré-requisito dele. |
| D11 | **Apply valida contra o estado atual** (version guard / 409). | Vivo + diário + cron (`project_vitoria_weekly_planning`) → dois escritores (humano + cron) contra board que andou no meio = clobber. |

## 5. Pontos de atenção (os guardrails que mordem)

1. **Duas memórias, dois relógios.** *Rationale* ("por que planejei assim") é capturável no apply, na hora. *Outcome* ("como foi") só existe **depois da sprint rodar**. A versão que você acabou de criar **não sabe** seu próprio outcome. As learnings que alimentam V_n são os outcomes das versões cujo horizonte **já decorreu**.
2. **Atribuição do outcome.** Como a planning é viva, várias versões miram a mesma sprint. Meça **outcome por-sprint** (essa sprint planejou X FP, entregou Y); o **learning** é o padrão cross-version ("subestimamos task de integração ~30%").
3. **Snapshot congelado vs board vivo são naturezas diferentes.** Chip histórico = texto/contagens denormalizados (imutável). Chip *corrente* = computado ao vivo dos `Task`. Não misture: se o histórico apontar pra FK viva, ele "muda o passado".
4. **Identidade da task é load-bearing.** Todo o modelo apoia na continuidade de `taskId`. Se uma task sumiu do board vivo, ela morreu — o agente **não** a ressuscita da memória antiga.
5. **Ruído de versão.** Aplicar todo dia = um chip por apply. Logue só versão **com mudança real** (colapsa no-op). O "Ver mais/Ver menos" da `Regua` resolve densidade.
6. **Custo da leitura diária.** "Ler o que existe" tem que ser query estruturada barata do board atual, não re-ler todas as fontes a cada sessão.
7. **Reversibilidade.** Board vivo que o agente muta precisa de undo. O snapshot destrava "restaurar/diffar versão N" — rede de segurança quando um re-plano sai ruim.

## 6. Arquitetura de dados — Fase 1 (Log)

Duas migrations atômicas (1 tabela por arquivo), via `psql "$DIRECT_URL" -f ...`, com RLS explícita por operação, e `database.types.ts` atualizado depois.

**`PlanningEvent`** (append-only, 1 linha por "Aplicar"):

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK | |
| `planningSessionId` | uuid FK → PlanningSession | |
| `createdAt` | timestamptz default now() | |
| `createdById` | uuid FK → Member | quem aplicou (`me.id` no complete route) |
| `appliedCount` / `failedCount` / `skippedCount` | int | resultado do executor (já retornado por `concludePlanning`) |
| `briefingMarkdown` | text | **cópia** do último turn `assistant` do thread no apply (auto-contido) |
| `chatMessageId` | uuid null | âncora pro turn original |

**`PlanningEventSprint`** (snapshot de FP por sprint — child table, sem jsonb):

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK | |
| `planningEventId` | uuid FK → PlanningEvent | ON DELETE CASCADE |
| `sprintId` | uuid FK → Sprint, null | null = backlog/não-agendado |
| `sprintLabel` | text | denormalizado (sobrevive a delete/rename) |
| `fpTotal` | int | soma de FP das tasks do sprint no instante do apply |
| `taskCount` | int | |

> **Snapshot = cumulativo, não delta.** No apply, depois das tasks criadas, agrupe os `Task` do projeto por `sprintId` e some FP (= o estado do plano naquele instante, o "Sprint 1 ~87 FP" que o briefing mostra). Confirme o nome da coluna de FP da `Task` no `database.types.ts`.

## 7. O gap do motor (pra o target state, não Fase 1)

A capability nova que o modelo vivo exige (Fase ≥ 2): **batch reconcile**.

- `propose_tasks` (lote) hoje **só faz `create`** — `src/lib/agent/agents/vitoria/tools.ts`.
- `propose_task_action` faz `update/move/delete` mas **exige `taskId` explícito** e é 1-a-1.
- **Não há dedup por conteúdo.** A idempotência atual (`reopen → re-conclude`) só funciona porque `applyPendingActionsForPlanning` filtra `execution='pending'` — protege *dentro de um ciclo*, **não entre re-leituras** de uma planning vivendo por semanas.
- O executor **não checa status** (D4): atualiza/move/deleta task `in_progress`/`done` sem guarda.

**Capability alvo:** o agente propõe o **estado-fim desejado referenciando taskIds existentes** (ou deltas), e o sistema computa/valida o conjunto de ações (create + update/move/delete), recusando tocar trabalho em curso. Essa é a **única** peça de plumbing genuinamente nova.

## 8. Reaproveitar a `Regua` (a strip "STATS")

- Componente: `Regua` (+ `SprintTimeline`, toggle "Ver mais/Ver menos") em `src/components/overview/projetos-board.tsx`. Hoje cada chip = 1 sprint; segmento = `{kind: closed|hole|current|future, monday, deliveryPct, sprintId}`. Estados "corrente" (filled ring) / "desligada" (dashed).
- **Reaproveitar o visual, trocar o dataset** (D9): sprints viram a régua de fundo (gridlines/labels por data); **versões de planning viram os chips**, posicionados pela data do apply. Clicar num chip → abre o snapshot daquela versão (briefing + chips de FP por sprint). É `git log` + `git show`.

## 9. Faseamento

| Fase | Entrega | Estado |
|---|---|---|
| **1 — Log** | `PlanningEvent` + `PlanningEventSprint`; gancho no apply; `GET /events`; **timeline visível** no canvas (substitui "Plano vazio"). Para o sangramento. | ✅ **Implementada (2026-06-19, Rev. 1)** |
| **2 — Versionado vivo** | Versão = diff sobre board vivo (motor batch-reconcile §7); guard de trabalho-em-curso (D4); chat por-versão (D5); strip de versões via `Regua` (D9). | Desenho fechado |
| **3 — Memória + aprendizado** | Memória destilada por versão (D6); outcome planned-vs-delivered por-sprint (D7) → Metrics Registry. | Desenho fechado |
| **4 — Merge Sprint Planning** | Absorver `PlanningCeremony` per-sprint como filtro da Planning viva. Taxonomia cai de 3 → 2 rituais (PM Review + Planning). | Adiado (D10) |

> **Regra de ouro do faseamento (AGENTS.md):** Fase 1 entrega **mais** que o sistema atual (o canvas vazio vira histórico navegável), nunca menos.

## 10. Referências de código vivo + memórias

**Código (confirmado nesta investigação — confirme linhas, árvore viva):**
- Canvas / empty-state: `src/app/(dashboard)/projects/[id]/planning/page.tsx` · `src/components/planning-session/release-planning-proposals.tsx`
- Apply: `src/app/api/planning/[id]/complete/route.ts` → `concludePlanning` (`src/lib/dal/planning.ts`) → `applyPendingActionsForPlanning` (`src/lib/dal/task-action-executor.ts`)
- Propostas (staging): `src/app/api/planning/[id]/actions/route.ts` · modelo `MeetingTaskAction`
- Chat: `src/app/api/planning-sessions/[id]/chat/route.ts` (thread `agentName=sessionId`, `channel='release_planning'`)
- Agente: `src/lib/agent/agents/vitoria/release-planning.ts` · tools `src/lib/agent/agents/vitoria/tools.ts` · companion ceremony `ensureReleasePlanningCeremony` em `src/lib/dal/planning-session.ts`
- Schema base: `supabase/migrations/20260601a_planning_session.sql` · `src/lib/supabase/database.types.ts`
- Strip: `src/components/overview/projetos-board.tsx` (`Regua`/`SprintTimeline`)

**Memórias (ler antes de executar):** `project_planning_versioned_living` (âncora), `project_planning_as_general_planner`, `project_sprint_planning_living_model`, `project_rituals_taxonomy`, `project_planning_session`, `project_vitoria_weekly_planning`, `project_metrics_registry`, `project_member_allocation`, `feedback_local_ssot`, `project_planning_ceremony`.

---

## 11. HANDOFF — próximo agente começa aqui (Fase 1)

**Missão:** parar o sangramento — fazer o canvas mostrar um **Log/timeline** das versões aplicadas em vez de "Plano vazio". Sem mergear Sprint Planning (D10), sem o motor batch-reconcile (Fase 2). Cravar o invariante do §4 em comentário no código que escrever.

**Pré-voo:** leia §1–§6 + as memórias do §10. `git status` primeiro — há mudanças não-commitadas nos arquivos de release planning; **não** dê stash/reset (local é SSOT). Confirme nomes de coluna/linha no `database.types.ts` (árvore viva).

**Passos:**

1. **Migration A** — `supabase/migrations/20260619a_planning_event.sql`: `CREATE TABLE "PlanningEvent"` (§6) + `ENABLE ROW LEVEL SECURITY` + policies (espelhe as de `PlanningSession`). Rodar: `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f supabase/migrations/20260619a_planning_event.sql`.
2. **Migration B** — `supabase/migrations/20260619b_planning_event_sprint.sql`: `CREATE TABLE "PlanningEventSprint"` (§6, FK CASCADE) + RLS. Rodar via psql idem.
3. **`database.types.ts`** — atualizar com as duas tabelas novas.
4. **Gancho no apply** — em `src/app/api/planning/[id]/complete/route.ts`, depois de `concludePlanning` retornar sucesso: (a) buscar o último `ChatMessage` `role='assistant'` do thread (`channel='release_planning'`, `agentName=sessionId`) → `briefingMarkdown` + `chatMessageId`; (b) agrupar `Task` do projeto por `sprintId`, somar FP → linhas `PlanningEventSprint`; (c) inserir o `PlanningEvent` com os counts já retornados. Idealmente numa transação/RPC.
5. **Endpoint de leitura** — `GET /api/planning/[id]/events`: lista `PlanningEvent` + seus `PlanningEventSprint`, `createdAt DESC`. Auth = mesma do `/actions` (`requireProjectEditTasksApi` ou equivalente já usado na pasta).
6. **Canvas** — em `planning/page.tsx`: render = **propostas pendentes (topo, como hoje)** + **timeline de Log (abaixo)**, cada entrada expansível (data · quem · chips de FP por sprint · briefing full). "Plano vazio" **só** quando 0 eventos **e** 0 pendências.

**Verifiable (rode antes de fechar):**
- `kind: typecheck` — `npx tsc --noEmit` → 0 erros.
- `kind: sql` — após um apply de teste: `SELECT count(*) FROM "PlanningEvent" WHERE "planningSessionId"='<id>'` → ≥ 1; e `SELECT sum("fpTotal") FROM "PlanningEventSprint" WHERE "planningEventId"='<...>'` bate com a tabela do briefing.
- `kind: http` — `GET /api/planning/[id]/events` → 200 com array não-vazio após apply.
- `kind: manual_browser` — aplicar uma planning → canvas mostra a **timeline**, não "Plano vazio"; expandir um chip mostra o briefing.

**Fora de escopo (não faça agora):** mexer no motor (`propose_tasks`/batch reconcile), guard de status no executor, chat por-versão, merge de Sprint Planning, strip de versões na `Regua`. Tudo isso é Fase ≥ 2 — deixa o Log de pé primeiro.

**Ao terminar:** commit via `bash scripts/sync-main.sh -m "..."`; atualize o **Status** no topo deste runbook (Fase 1 → done) e registre achados/surpresas numa nota de revisão (estilo "Rev. N" dos outros runbooks).

---

## 12. Rev. 1 — Fase 1 (Log) implementada (2026-06-19)

Entregue. O canvas do Release Planning não fica mais "Plano vazio" depois do "Aplicar" — passa a mostrar um **Histórico do plano** (timeline de versões aplicadas, cada uma expansível com chips de FP por sprint + briefing).

**Arquivos:**
- `supabase/migrations/20260619a_planning_event.sql` · `20260619b_planning_event_sprint.sql` (rodadas via psql; RLS via join à `PlanningSession`; append-only — sem policy de UPDATE/DELETE).
- `src/lib/dal/planning-event.ts` — `recordPlanningEventFromCeremony` (write) + `listPlanningEventsForSession` (read) + `snapshotFpBySprint` (agregação) + `loadLatestBriefing`.
- `src/app/api/planning/[id]/complete/route.ts` — gancho best-effort pós-`concludePlanning`.
- `src/app/api/planning-sessions/[id]/events/route.ts` — GET (ver desvio abaixo).
- `src/components/planning-session/planning-event-log.tsx` + wiring em `…/planning/page.tsx` (empty-state agora gateado por `eventCount`).
- `src/lib/date-utils.ts` — `fmtDateTime` (timeline com vários eventos/dia).

**Desvios conscientes do §11 (e por quê):**
1. **`PlanningEvent` é keyed por `planningSessionId`, NÃO por `PlanningCeremony`.** Descoberta load-bearing: a companion ceremony é **reciclada a cada apply** (`ensureReleasePlanningCeremony` cria uma fresca quando a anterior fica `closed`). Logar por ceremony fragmentaria a cadeia de versões — uma versão por ceremony morta. A sessão é o eixo estável. Isso *confirma* D1/D5 na prática.
2. **Endpoint = `GET /api/planning-sessions/[id]/events`** (keyed por session id), não `GET /api/planning/[id]/events` (que seria keyed pela ceremony reciclada — não acharia o histórico). O write resolve `ceremony → session` (confiável no instante do conclude, antes da reciclagem); o read vai direto por session id (a página já tem `session.id`).
3. **Escopo automático a Release Planning:** se a ceremony do `/complete` não for companion de nenhuma `PlanningSession` (= é uma Sprint Planning real), o gancho é no-op. Respeita D10 sem branch explícito.

**Limitações conhecidas (follow-up, não bloqueiam Fase 1):**
- **Write não-atômico.** `concludePlanning` não tem transação (Supabase JS), e o gancho é best-effort (try/catch, não derruba o apply). Se o insert do `PlanningEvent` passar mas o dos `PlanningEventSprint` falhar, fica um evento com briefing+counts e **sem chips de FP** (degradado, não quebrado). Atomizar = mover pra RPC (junto do batch-reconcile da Fase 2).
- **Snapshot inclui todo o board do projeto** (todas as tasks não-dismissed agrupadas por sprint), não só o que essa planning tocou — fiel ao "estado do plano naquele instante" (§6), mas quando a atribuição companion↔session ficar fina (Fase 2), reavaliar.
- **`manual_browser` não verificado por agente** (auth-walled). Os outros verifiables passaram: `tsc` 0 erros; eslint limpo; tabelas+RLS no banco; write→read provado transacionalmente (insert+select+ROLLBACK); agregação de FP bateu com dados reais (SILFAE: 180 FP/38 tasks em 5 sprints); `GET /events` responde 401 sem auth (rota viva e gateada). **Falta:** aplicar uma planning pela UI e ver a timeline render.
