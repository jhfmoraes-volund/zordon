# PRD — Vitoria, copiloto de Rituais (Cerimônias do Projeto)

**Status:** Draft v4
**Autor:** João Moraes
**Data:** 2026-05-28
**Domínio:** Cerimônias / Planning Ceremony
**Referências:**
- Plano técnico: [`docs/features/meetings/planning-ceremony-plan.md`](../features/meetings/planning-ceremony-plan.md)
- Memórias: `project_planning_ceremony`, `project_meetings_reorg`

**Changelog v4 (decisão final de provider):**
- Provider: **OpenRouter** (igual Vitor/Alpha) — sem E2B, sem MCP server, sem SDK Anthropic direto
- Model: `anthropic/claude-haiku-4-5` via OpenRouter
- Tools: TypeScript AI SDK ToolSet (mesmo padrão de Vitor/Alpha)
- Stack de execução idêntica ao Vitor — só troca contexto (planning vs design session)
- Cost tracking: OpenRouter já retorna `cost_usd` — sem `pricing.ts` custom
- Removido: `@ai-sdk/anthropic`, E2B, MCP server, `CLAUDE_CODE_OAUTH_TOKEN`

**Changelog v2/v3 (mantidos):**
- URL: `/rituals/[id]` (alinhado com código existente)
- `PlanningContextNoteSource` removida — usa `sourceTranscriptIds uuid[]` no schema
- Actor `"vitoria"` adicionado em `phase.ts`
- `MeetingTaskAction.sourceNoteIds uuid[]` — migration necessária (Fase 2)

---

## 1. Resumo executivo

**Vitoria é o copiloto de Rituais do PM — irmã do Vitor (design session) e contraparte do Alpha (ops).**

Ela vive **dentro do Command Center** de cada ritual e conduz as cerimônias cronológicas do time: **Planning** no MVP, depois Daily e Review. Conversa em chat ao vivo com o PM, lê transcripts curados, propõe composição de sprint, registra notas estruturadas e cria tasks via aprovação humana.

**Diferença de quem:**
- **Vitor** = descoberta (design session, hierarquia de produto)
- **Alpha** = operação contínua (sprint health, alocação, /ops sidebar global)
- **Vitoria** = rituais cronológicos do projeto (planning, daily, review — eventos com começo, meio e fim)

**Decisão técnica de provider:** Vitoria usa **OpenRouter** (igual Vitor e Alpha) com modelo `anthropic/claude-haiku-4-5`. Mesma stack de execução, mesma infra, zero dependências novas. `OPENROUTER_API_KEY` já existe no projeto.

---

## 2. Problema

PM de software house roda **3 rituais por sprint por projeto**:

| Ritual | Hoje | Dor |
|---|---|---|
| **Planning** (segunda) | PM lê transcripts de 1-on-1, reviews, calls da semana, junta com backlog e capacidade do time, propõe sprint manualmente | 2-4h de leitura + síntese. Esquece de cruzar evidência. Tasks que viram caem mal escritas |
| **Daily** (todo dia) | PM revê status, identifica bloqueio | Status fica em conversa, não vira nota estruturada |
| **Review** (fim de sprint) | PM consolida o que entregou, o que não, por quê | Memória do sprint passa rápido; review fica raso |

**Hoje no Zordon:** Planning Ceremony tem schema pronto (6 tabelas + 2 colunas), UI em construção, **agente ainda não existe**. Plano técnico assume Alpha como copiloto — mas Alpha é agente global (`/ops`), não está ancorado no ritual.

**Hipótese de produto:** um agente **dedicado às cerimônias**, com identidade visual própria, com contexto carregado por ritual, **eleva qualidade da síntese e da composição de sprint sem virar mais um chat genérico**.

---

## 3. Objetivos

### 3.1 Objetivos primários (MVP)

1. **PM finaliza Planning em ≤ 30 min** (vs. 2-4h hoje) com Vitoria conduzindo
2. **≥ 80% das tasks que viram da Planning saem com origem rastreável** (cita transcript/note específica)
3. **Vitoria mantém estado entre fases** sem PM precisar relembrar — `phase` é gating real, não decoração
4. **Zero regressão em Vitor + Alpha** durante o piloto

### 3.2 Objetivos secundários (pós-MVP)

5. Cobrir Daily (Fase 2) e Review (Fase 3) com a mesma identidade Vitoria
6. Cobrir Daily (Fase 2) e Review (Fase 3) com a mesma identidade Vitoria

### 3.3 Não-objetivos

- ❌ Substituir Alpha — Alpha continua sendo o agente de operação contínua
- ❌ Substituir Vitor — Vitor continua sendo o agente de design session
- ❌ Multi-tenant (cada user paga sua subscription) — usa o token da org no MVP
- ❌ Conduzir reuniões síncronas (Vitoria é assíncrona, lê transcript depois do call)
- ❌ Geração automática de tasks (todas passam por aprovação via `MeetingTaskAction`)

---

## 4. Personas e jornadas

### 4.1 Persona principal: PM (Product Manager / Tech Lead de squad)

- Conduz 2-4 projetos em paralelo
- Roda Planning toda segunda; Daily curta diária; Review na sexta
- Tem `access_level` `manager` ou superior; lead em pelo menos 1 projeto

### 4.2 Jornada — Planning Ritual (MVP)

> **Segunda 10h.** PM Carolina abre o projeto Zelar, vai pro tab Rituais (ex-Cerimônias), clica em "Nova Planning" → cria PlanningCeremony em fase `idle`.

```
┌─────────────────────────────────────────────────────────────────┐
│ Tab Rituais — Projeto Zelar                                     │
│                                                                 │
│ [Filtro: Planning ▼]  [+ Nova Planning]                         │
│                                                                 │
│ ◉ Planning — Sprint 12 · idle · agendada pra 2026-05-19         │
│   Facilitador: Carolina                                         │
│   0 transcripts · 0 meetings · sem briefing                     │
│                                                                 │
│ ◯ Planning — Sprint 11 · closed · 2026-05-12                    │
│   8 tasks aprovadas · 0 pendentes                               │
└─────────────────────────────────────────────────────────────────┘
```

**Carolina clica na Planning ativa.** Navega para `/rituals/[id]` — Command Center do ritual.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Planning — Sprint 12 · Zelar                                          │
│                                                                        │
│  Fase: idle ──→ reading ──→ proposing ──→ approving ──→ closed         │
│         ●                                                              │
│                                                                        │
│  ┌─ Contexto vinculado ─────────────────────────────────┐  ┌─ Vitoria ─┐  │
│  │ 📞 Meetings (0)                        [+ vincular] │  │          │  │
│  │ 📝 Transcripts (0)                     [+ vincular] │  │  chat    │  │
│  └─────────────────────────────────────────────────────┘  │  panel   │  │
│                                                            │          │  │
│  ┌─ Briefing / Notes ───────────────────────────────────┐  │ ──────── │  │
│  │ (visível após reading)                               │  │ input   │  │
│  └─────────────────────────────────────────────────────┘  └──────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

**Carolina vincula 3 transcripts.** **Carolina:** "vamos lá, lê esses transcripts e me traz o que importa pra sprint"

> Fase muda: `idle → reading` (ao enviar primeira msg com ≥1 transcript vinculado).

**Vitoria** (streaming, chip de ferramenta visível):

```
🟣 Vitoria

Lidos 3 transcripts. Aqui o briefing:

📌 Temas centrais
  • Refatoração de pagamentos (cliente pediu — bloqueia checkout v2)
  • Tech debt em auth-service (dev mencionou 3x na retro)

⚠️ Riscos
  • Eduardo tira 2 dias de férias na próxima semana

🎯 Sinais de capacidade
  • Sprint 11 entregou 28FP de 35FP planejados (80%)

Registrei 5 notas. Quer ver composição de sprint ou refinar alguma nota?
```

> Fase muda: `reading → proposing` (Vitoria transiciona ao gerar ≥1 summary + ≥3 outras notes).

**Carolina:** "refatoração de pagamentos é prioridade"  
**Vitoria** propõe composição, cria MeetingTaskActions pending.

> Fase: `proposing → approving` (PM clica "Revisar").

**Carolina** abre `MeetingTaskActionSheet`, aprova 4, descarta 1. Volta pro chat.  
**Carolina:** "manda"

**Vitoria:** "4 tasks criadas. Planning fechada. Vejo você na Daily."

> Fase: `approving → closed`. Total: ~22 minutos.

### 4.3 Jornadas pós-MVP (Daily, Review)

Mesma identidade visual, contexto diferente:
- **Daily:** Vitoria lista bloqueios estruturados por dev mencionado
- **Review:** Vitoria recapitula sprint e gera summary pro Wiki do projeto

---

## 5. Escopo funcional — MVP (Planning Ceremony)

### 5.1 Identidade

| Atributo | Valor |
|---|---|
| Slug interno | `vitoria` |
| Nome display | "Vitoria" |
| Personalidade | Direta, sintética, cita origem. Propõe baseado em evidência. |
| Ícone | `VitoriaIcon` — mesmo SVG do VitorIcon, exportado com novo nome |
| Cor primária | **Violet-500** (`oklch(0.606 0.25 292)`) — sem conflito com Alpha (pink) ou Vitor |
| Token de tema | `text-violet-500 / bg-violet-50 / border-violet-200` + dark variants |
| Execução | **Vercel AI SDK** + OpenRouter — idêntico ao Vitor/Alpha |
| Modelo | `anthropic/claude-haiku-4-5` via OpenRouter |
| Auth | `OPENROUTER_API_KEY` (já existe no projeto) |
| Tools | TypeScript AI SDK `ToolSet` — mesmo padrão do Vitor/Alpha |

### 5.2 Onde Vitoria aparece

- **Command Center da Planning:** `/rituals/[id]` — rota já criada em `src/app/(dashboard)/rituals/[id]/` (sem page.tsx ainda)
- **Lista de Rituais:** badge "Vitoria conduzindo" quando planning está ativa
- **NÃO aparece em:** `/ops` (Alpha-only), `/design-sessions` (Vitor-only), sidebar global

### 5.3 Capacidades de chat

| Capacidade | MVP |
|---|---|
| Streaming SSE | ✅ |
| Persistência mensagem por mensagem | ✅ (`ChatThread.agentName = "vitoria"`, `channel = "planning"`) |
| Resume de conversa após F5 | ✅ |
| Thread única por PlanningCeremony | ✅ (lookup: `metadata->>'planningCeremonyId' = :id`) |
| Tool calls visíveis no UI (chips) | ✅ (via `ToolCallChip` existente) |
| Cancelamento mid-stream | ✅ |
| Histórico cross-planning | ❌ — escopo é por planning |

### 5.4 Tools que Vitoria expõe (MVP)

5 tools novas + 3 reusadas do Alpha:

| Tool | Tipo | Origem |
|---|---|---|
| `read_linked_transcripts` | read | nova |
| `add_planning_note` | write | nova — insere em `PlanningContextNote`, cita `sourceTranscriptIds[]` |
| `list_planning_notes` | read | nova |
| `propose_task_action` | write | nova — cria `MeetingTaskAction` pending com `planningCeremonyId` + `sourceNoteIds[]` |
| `get_planning_state` | read | nova (agregado: fase, contexto, notes count) |
| `get_sprint_overview` | read | reusa de Alpha |
| `get_backlog` | read | reusa de Alpha |
| `list_unplanned_tasks` | read | reusa de Alpha |

**Não expõe** no MVP: `create_task` direto (sempre via Action), `manage_allocation`, `update_wiki_section`.

### 5.5 Máquina de estados — quem dispara o quê

| Transição | Actor | Pré-condição | Side effect |
|---|---|---|---|
| `idle → reading` | `"pm"` (botão ou primeira msg) | ≥1 transcript OU meeting linkado | `startedAt` stamped; Vitoria recebe primeiro turn |
| `reading → proposing` | `"vitoria"` | ≥1 note `kind=summary` + ≥3 outras notes | `briefingGeneratedAt` stamped; UI revela "Revisar composição" |
| `proposing → approving` | `"pm"` (clica Revisar) | ≥1 `MeetingTaskAction` pending | Vitoria trava criação de novas actions |
| `approving → closed` | `"pm"` (aplica todas actions) | 0 actions `pending` | `closedAt` stamped; actions viram tasks; Vitoria emite turn final |
| `reading\|proposing → idle` | `"pm"` (reset) | — | DELETE notes; DELETE actions pending; mantém links |
| `closed → archived` | cron (30d) ou manual | `closedAt > 30d` | só read-only |

> **Actor `"vitoria"` é novo em `src/lib/planning/phase.ts`** — atual tem `"pm" | "alpha"`. Adicionar `"vitoria"` e rodar `npm run gen:phase-sql` pra regenerar o trigger SQL.

### 5.6 Persistência

| Tabela | Uso pela Vitoria |
|---|---|
| `PlanningCeremony` | Lê fase; escrita de `briefingGeneratedAt` via note insert |
| `PlanningContextNote` | Insere kinds: `summary`, `theme`, `risk`, `capacity_signal`, `open_question`. Campo `sourceTranscriptIds uuid[]` cita as origens (array já no schema — **sem tabela join separada**) |
| `MeetingTaskAction` | Insere via `propose_task_action`; campos `planningCeremonyId` + `sourceNoteIds uuid[]` (ver §10.1) |
| `ChatThread` | Cria thread por planning (`agentName="vitoria"`, `channel="planning"`, `metadata jsonb { planningCeremonyId }`) |
| `ChatMessage` | Persistência turn-by-turn com `parts[]` (tool-call chips, etc) |
| `Agent` | Linha nova com `slug=vitoria, modelId=anthropic/claude-haiku-4-5, isActive=true` |
| `AgentUsage` | 1 row por turn, `costUsd` via OpenRouter (automático) |

**Nota:** `PlanningContextNoteSource` **não existe e não será criada**. A referência de origem usa `PlanningContextNote.sourceTranscriptIds uuid[]` (array column, já no schema desde a migration inicial).

### 5.7 Sessão de Agentes (`/agents`) — Vitoria como cidadã de 1ª classe

| Rota | Status hoje | Pra Vitoria |
|---|---|---|
| `/agents` | Mostra Vitor + Alpha | Inclui Vitoria após migration seed |
| `/agents/[slug]` | Funciona pra qualquer slug | `/agents/vitoria` funciona após INSERT |
| `/agents/[slug]/settings` | Vitor + Alpha registrados | Registrar `vitoria` no `AGENT_SETTINGS_REGISTRY` |
| `/agents/[slug]/usage` | Lê `AgentUsage` por `agentName` | Funciona out-of-the-box após rows com `agentName="vitoria"` |

#### 5.7.1 Seed migration

`supabase/migrations/<date>_seed_vitoria_agent.sql`:

```sql
INSERT INTO public."Agent" (
  id, slug, name, description, "modelId", "isActive", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'vitoria',
  'Vitoria',
  'Copiloto de Rituais — Planning, Daily, Review. Lê transcripts, propõe sprint, registra notas. Anthropic direto (Haiku 4.5).',
  'anthropic/claude-haiku-4-5',
  true,
  now(), now()
) ON CONFLICT (slug) DO NOTHING;
```

#### 5.7.2 AgentBadge + agent-themes

Adicionar variant `vitoria` em dois lugares:

**`src/components/ui/conversation/agent-themes.ts`:**
```ts
vitoria: {
  id: "vitoria",
  label: "Vitoria",
  icon: VitoriaIcon,
  accent: "oklch(0.606 0.25 292)",     // violet-500
  accentRaw: "0.606 0.25 292",
  tileBgRaw: "0.97 0.02 292",
  accentSoft: "oklch(0.95 0.04 292)",
  glow: "oklch(0.606 0.25 292 / 0.25)",
  emptyHint: "Olá. Vamos montar a melhor planning da semana.",
  collapseThreshold: 6,
  planEventName: "vitoria:plan-mode",
  planStorageKey: "vitoria:plan-mode",
},
```

**`src/components/ui/conversation/agent-badge.tsx`** (ou onde `AgentBadge` aceita variants): adicionar `"vitoria"` ao union type e ao switch/map de renderização.

#### 5.7.3 Settings registry

`src/lib/agent/settings-registry.ts`:

```ts
vitoria: {
  fields: [
    { key: "modelId", type: "select",
      options: ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-6"],
      default: "anthropic/claude-haiku-4-5",
      label: "Modelo" },
    { key: "fallbackProvider", type: "boolean",
      default: false,
      label: "Fallback OpenRouter se rate-limited" },
  ],
},
```

#### 5.7.4 Cost tracking

OpenRouter já retorna `cost_usd` em `providerMetadata.openrouter.usage` — mesmo mecanismo do Vitor/Alpha. `recordAgentUsage` em `src/lib/agent/usage.ts` funciona **sem modificação**. Nenhum arquivo novo necessário.

### 5.8 Arquitetura — igual Vitor (v4)

Vitoria usa **exatamente o mesmo stack** de Vitor/Alpha. A única diferença é o contexto carregado (planning vs design session) e as tools.

#### Stack

```
Browser (ConversationPanel — reuso total)
    ↓ DefaultChatTransport → SSE
POST /api/planning/[id]/chat
    ↓
src/lib/agent/connectors/planning-chat.ts  (novo, espelha web.ts)
    ↓ runAgent(vitoriaAgent, req)
src/lib/agent/engine.ts  (sem modificação)
    ↓ streamText()
OpenRouter → anthropic/claude-haiku-4-5
```

#### Reuso completo

| Camada | Componente | Status |
|---|---|---|
| UI | `ConversationPanel` | ✅ sem modificação |
| Transport | `DefaultChatTransport` + `useChat` | ✅ sem modificação |
| Engine | `engine.ts` + `runAgent()` | ✅ sem modificação |
| Thread | `ensureThread` / `buildMessageHistory` / `persistUserMessage` | ✅ sem modificação |
| Cost | `recordAgentUsage` (OpenRouter retorna `cost_usd`) | ✅ sem modificação |
| Tema | `agent-themes.ts` entry `vitoria` | ➕ adicionar (Fase 0) |

#### Conector planning-chat.ts (espelha web.ts)

```
web.ts                                planning-chat.ts
────────────────────────────────────  ────────────────────────────────────
requireSessionAccessApi(sessionId)    requireProjectViewApi(planning.projectId)
ensureThread(sessionId, "web", …)     ensureThread(planningId, "planning", …)
vitorAgent.run(req)                   vitoriaAgent.run(req)
X-Thread-Id header                    X-Thread-Id header (mesmo)
UIMessageStreamResponse               UIMessageStreamResponse (mesmo)
```

#### Lookup de thread

`GET /api/planning/[id]/chat`:
```ts
db().from("ChatThread")
  .eq("agentName", "vitoria")
  .eq("channel", "planning")
  .contains("metadata", { planningCeremonyId: id })
  .maybeSingle()
```

---

## 6. Critérios de aceite (MVP)

### 6.1 Funcional

- [ ] **F1.** PM cria PlanningCeremony, abre `/rituals/[id]`, vê Vitoria pronta no chat
- [ ] **F2.** Vincula ≥1 transcript → primeira msg dispara `idle → reading` (actor `"pm"`)
- [ ] **F3.** Vitoria chama `read_linked_transcripts` no primeiro turn (chip visível)
- [ ] **F4.** Vitoria gera ≥1 summary + ≥3 notes em ≤2 min pra 3 transcripts pequenos (≤2k tokens cada)
- [ ] **F5.** Fase muda pra `proposing` quando Vitoria atinge critério de notes (actor `"vitoria"`)
- [ ] **F6.** PM pede "propõe sprint", Vitoria chama `get_sprint_overview`, `get_backlog`, `propose_task_action` × N
- [ ] **F7.** Cada `MeetingTaskAction` criada tem `planningCeremonyId` + `sourceNoteIds uuid[]` populados
- [ ] **F8.** PM revê em `MeetingTaskActionSheet`, aprova/edita/descarta
- [ ] **F9.** Tudo aprovado → `closed`, tasks criadas no backlog, Vitoria emite turn de fechamento

### 6.2 Visual/UX

- [ ] **V1.** `VitoriaIcon` + tema violet em todos os pontos (chat header, message bubble, lista rituais, action sheet)
- [ ] **V2.** Cor violet não conflita com Alpha (pink) ou estados do sistema (verde/amarelo/vermelho)
- [ ] **V3.** Tool calls aparecem como `ToolCallChip` enxuto, expandível
- [ ] **V4.** Phase ribbon muda visualmente (breadcrumb/progress bar no header do Command Center)

### 6.3 Técnico

- [ ] **T1.** Vitor + Alpha não regridem (smoke test antes e depois do merge)
- [ ] **T2.** Streaming SSE end-to-end renderiza correto (text-delta, tool-call, tool-result, finish)
- [ ] **T3.** F5 no Command Center recarrega últimas N mensagens (resume de conversa)
- [ ] **T4.** `AgentUsage.costUsd > 0` após planning (OpenRouter retorna `cost_usd` automaticamente)

### 6.4 Sessão de Agentes (`/agents`)

- [ ] **AG1.** Linha `Agent { slug: "vitoria", isActive: true }` em prod após migration seed
- [ ] **AG2.** `/agents` lista Vitoria com badge violet + `VitoriaIcon`
- [ ] **AG3.** `/agents/vitoria` carrega página com descrição correta
- [ ] **AG4.** `/agents/vitoria/usage` mostra calls/tokens/custo após 3+ plannings
- [ ] **AG5.** `costUsd > 0` via OpenRouter (sem código extra)
- [ ] **AG6.** Filtros 7d / 30d / all funcionam
- [ ] **AG7.** Breakdown por modelo mostra `anthropic/claude-haiku-4-5`
- [ ] **AG8.** `/agents/vitoria/settings` lista campos do registry (model override)

### 6.5 Adversarial

- [ ] **A1.** PM tenta entrar em `proposing` sem transcript → Vitoria recusa
- [ ] **A2.** PM pede task fora de contexto → Vitoria propõe com flag `"assumption"` ou abre `open_question`
- [ ] **A3.** Reset mid-Planning → notes/actions deletadas, fase volta pra `idle`
- [ ] **A4.** Rate limit Haiku → mensagem clara pro PM, sem crash do UI

---

## 7. Métricas de sucesso

### 7.1 Métricas primárias

| Métrica | Baseline (estimado) | Meta MVP |
|---|---|---|
| Tempo médio de Planning | 2-4h | **≤ 30 min** |
| % tasks com origem rastreável | <20% | **≥ 80%** |
| % Plannings que chegam em `closed` | n/a | **≥ 90%** |
| NPS PM | n/a | **≥ 8/10** após 10 plannings |

### 7.2 Métricas técnicas

| Métrica | Meta |
|---|---|
| Latência primeiro token | ≤ 2s |
| Custo médio por Planning | ≤ $0.10 |
| Taxa de retry por rate limit | ≤ 5% |


---

## 8. Riscos e mitigações

### 8.1 Haiku não dá conta de Planning complexa

**Mitigação:**
- Prompt explícito (cite origem, não invente)
- Tools fazem o trabalho pesado (Vitoria chama `get_sprint_overview`, não calcula na cabeça)
- Upgrade fácil: `model = "anthropic/claude-sonnet-4-6"` via settings sem deploy

### 8.2 Regressão Vitor + Alpha

**Mitigação:**
- Stack compartilhada — mudança em `engine.ts` afeta todos; testar Vitor + Alpha antes e depois do merge

### 8.4 PM não confia em Vitoria

**Mitigação:**
- Toda escrita é proposta — nada direto no banco sem aprovação
- Origem sempre visível no chip de action
- Reset zero-fricção
- PM pode fechar Planning sem aplicar todas as Actions

### 8.5 Confusão Vitoria vs Alpha vs Vitor

**Mitigação:**
- Cor diferente (violet / pink / atual) — leitura visual imediata
- Escopo claro na UI por contexto de rota
- Documentação AGENTS.md

---

## 9. Cronograma — entregáveis incrementais

> Cada fase é commitable. Sem big-bang.

### Fase 0 — Agent definition + tema (1 dia)

- Criar `src/components/icons/vitoria-icon.tsx` (copy do VitorIcon)
- Adicionar entrada `vitoria` em `src/components/ui/conversation/agent-themes.ts` (violet)
- Adicionar variant `"vitoria"` em `AgentBadge`
- Criar `src/lib/agent/agents/vitoria/index.ts` — `vitoriaAgent: AgentDefinition`
  - `model: "anthropic/claude-haiku-4-5"`
  - `loadContext(req)` — carrega PlanningCeremony + notes + linkedTranscripts
  - `buildPrompt()` — prompt de planning (stable/volatile para cache)
  - `buildTools()` — tools de planning (Fase 1)
- Smoke script `scripts/vitoria-cli.ts`
- **Critério:** `tsx scripts/vitoria-cli.ts --planning <id> --message "olá"` streama resposta

### Fase 1 — Tools de Planning + migration (2-3 dias)

- Migration `sourceNoteIds uuid[]` em `MeetingTaskAction`
- Tool `read_linked_transcripts` — lê `TranscriptRef.fullText` por ID
- Tool `add_planning_note` — INSERT `PlanningContextNote`, popula `sourceTranscriptIds[]`
- Tool `list_planning_notes` — SELECT por kind/dismissed
- Tool `propose_task_action` — INSERT `MeetingTaskAction` com `planningCeremonyId` + `sourceNoteIds[]`
- Tool `get_planning_state` — fase + counts
- Reusar do Alpha: `get_sprint_overview`, `get_backlog`, `list_unplanned_tasks`
- **Critério:** jornada §4.2 ponta a ponta no CLI sem intervenção manual

### Fase 2 — Endpoint + connector (1 dia)

- `src/app/api/planning/[id]/chat/route.ts` (GET history + POST message)
- `src/lib/agent/connectors/planning-chat.ts` (espelha `web.ts`, ver §5.8)
- Lookup de thread por `metadata->>'planningCeremonyId'`
- **Critério:** `curl -X POST /api/planning/<id>/chat` retorna SSE com resposta da Vitoria

### Fase 2.5 — Cidadania no /agents (1 dia)

- Migration `<date>_seed_vitoria_agent.sql`
- Registrar `vitoria` em `AGENT_SETTINGS_REGISTRY`
- Adicionar Actor `"vitoria"` em `src/lib/planning/phase.ts` + `npm run gen:phase-sql`
- **Critério:** `/agents` lista Vitoria; `/agents/vitoria/usage` mostra ≥1 row com `costUsd > 0`

### Fase 3 — Tools de Planning (2-3 dias)

- `add_planning_note` — insere `PlanningContextNote`, popula `sourceTranscriptIds[]`
- `list_planning_notes`
- `read_linked_transcripts`
- `propose_task_action` — insere `MeetingTaskAction` com `planningCeremonyId` + `sourceNoteIds[]`
  - Depende de migration `sourceNoteIds uuid[]` em `MeetingTaskAction` (ver §10.1)
- `get_planning_state`
- Reusar de Alpha: `get_sprint_overview`, `get_backlog`, `list_unplanned_tasks`
- **Critério:** jornada §4.2 ponta a ponta sem intervenção manual

### Fase 4 — UI Command Center (3-4 dias)

- `src/app/(dashboard)/rituals/[id]/page.tsx` — layout 2 colunas
  - Coluna esquerda: phase ribbon + context pane (links) + notes pane + actions pane
  - Coluna direita: `<ConversationPanel agent="vitoria" variant="desktop" .../>` (direto — sem componente customizado de chat)
- `src/components/planning/` — sub-componentes: `phase-ribbon.tsx`, `context-pane.tsx`, `notes-pane.tsx`
- Hook `usePlanningChat(planningId)` análogo ao `useDesignSessionChat` — wrappa `useChat` + thread lookup + history
- Integração com `MeetingTaskActionSheet` (já existe) passando `planningCeremonyId`
- **Critério:** PM real executa jornada §4.2 ponta a ponta em browser

### Fase 5 — Audit (1-2 dias)

- `docs/vitoria-audit.md` — 10-12 cenários (F1..F9 + A1..A4)
- Rodar baseline, medir % correto
- **Critério:** ≥ 70% correto + gaps priorizados

### Fase 6 — Hardening e métricas (1 dia)

- Alertas de rate limit
- Fallback OpenRouter feature flag
- **Critério:** métricas §7 funcionando em produção

**Total estimado: 10-14 dias.**

---

## 10. Dependências e pré-requisitos

### 10.1 Schema (Planning Ceremony)

Status atual (verificar em `supabase/migrations/`):

- [ ] `PlanningCeremony`
- [ ] `TranscriptRef`
- [ ] `PlanningMeetingLink`
- [ ] `PlanningTranscriptLink`
- [ ] `PlanningContextNote` (com `sourceTranscriptIds uuid[]` — **sem** `PlanningContextNoteSource`)
- [ ] `MeetingTaskAction.planningCeremonyId`
- [ ] `MeetingTaskAction.sourceNoteIds uuid[]` — **migration nova necessária** (Fase 3)
- [ ] `Project.planningCadence` + `Project.planningActive`
- [ ] `src/lib/planning/phase.ts` com Actor `"vitoria"` adicionado

### 10.2 UI base de Rituais

- [ ] Tab "Rituais" em `/projects/[id]` existe (Fase 1 de `project_meetings_reorg`)
- [ ] Listagem de PlanningCeremony por projeto em `src/components/project-ceremonies-tab.tsx` ✅ (já existe)
- [ ] Botão "+ Nova Planning" ✅ (já existe)
- [ ] Click navega pra `/rituals/[id]` ✅ (já existe)

### 10.3 Sistema de chat

- [x] `ConversationPanel` + `MessageList` + `ChatComposer` (`src/components/ui/conversation/`)
- [x] `DefaultChatTransport` + `useChat` (`@ai-sdk/react`)
- [x] `useChatPlanMode` + `readPlanMode` hooks
- [x] `ensureThread` + `buildMessageHistory` + `persistUserMessage` (`src/lib/agent/context.ts`)
- [x] `ChatThread` + `ChatMessage` com schema correto
- [ ] Entrada `vitoria` em `agent-themes.ts` (Fase 1)
- [ ] Variant `"vitoria"` em `AgentBadge` (Fase 1)

### 10.4 Auth e env

- [x] `OPENROUTER_API_KEY` no `.env` (já existe)
- [x] `.env` no `.gitignore` (já está)

### 10.5 /agents hub

- [x] Rotas `/agents`, `/agents/[slug]`, `/agents/[slug]/usage`, `/agents/[slug]/settings`
- [x] Tabela `Agent` em prod com Vitor + Alpha
- [x] `AgentUsage` com schema completo
- [ ] Seed migration Vitoria (Fase 2.5)
- [x] `AgentUsage.costUsd` via OpenRouter — funciona out-of-the-box

---

## 11. Decisões abertas

1. **Fallback OpenRouter no MVP** — implementar agora ou só se rate limit virar problema real?
2. **Hard cap por planning** — colocar `$0.50/thread` soft cap ou só monitorar?
3. **Daily/Review stub** — no MVP: não (foco Planning), ou stub `"em breve"` no tipo de ritual?
4. **Audit antes ou depois do lançamento** — staging antes de PMs reais, ou learning by doing?
5. **Notificação de briefing pronto** — Vitoria emite notificação quando termina briefing, ou PM precisa olhar?

---

## 12. Out of scope

- MCP (Vitoria não consome MCP no MVP)
- Volund OS integration
- BYO OAuth per-user
- Migrar Vitor pro Anthropic direto
- Multi-language UI (PT-BR only)
- Mobile-first Command Center
- Histórico cross-planning

---

## 13. Glossário

| Termo | Definição |
|---|---|
| **Ritual** | Cerimônia recorrente do projeto (Planning, Daily, Review) |
| **Command Center** | Tela full-screen do ritual: `/rituals/[id]` |
| **Phase** | Estado da PlanningCeremony — `idle/reading/proposing/approving/closed/archived` |
| **Actor** | Quem disparou uma transição de fase — `"pm" | "vitoria"` (novo; `"alpha"` não usado aqui) |
| **Action** | `MeetingTaskAction` — proposta de criar/editar task, sempre passa por aprovação humana |
| **Note** | `PlanningContextNote` — registro estruturado do que Vitoria leu/observou |
| **sourceTranscriptIds** | Array `uuid[]` em `PlanningContextNote` que cita as transcrições de origem |
| **sourceNoteIds** | Array `uuid[]` em `MeetingTaskAction` que liga a action às notes que a geraram |
| **TranscriptRef** | Transcrição (call, retro, sync) como entidade independente de Meeting |

---

## 14. Próximo passo concreto

1. **Verificar pré-requisitos §10.1** — confirmar quais migrations já estão em prod.
2. **Decidir as 5 perguntas de §11.**
3. **Começar Fase 0** — `vitoriaAgent: AgentDefinition` + tema violet.
