# PRD — Vitoria, copiloto de Rituais (Cerimônias do Projeto)

**Status:** Draft v1
**Autor:** João Moraes
**Data:** 2026-05-14
**Domínio:** Cerimônias / Planning Ceremony
**Referências:**
- Plano técnico: [`docs/features/meetings/planning-ceremony-plan.md`](../features/meetings/planning-ceremony-plan.md)
- Plano piloto Anthropic SDK: [`docs/agents/vitoria-pilot-plan.md`](../agents/vitoria-pilot-plan.md)
- Memórias: `project_planning_ceremony`, `project_meetings_reorg`

---

## 1. Resumo executivo

**Vitoria é o copiloto de Rituais do PM — irmã do Vitor (design session) e contraparte do Alpha (ops).**

Ela vive **dentro do tab Cerimônias** de cada projeto e conduz as rituais cronológicas do time: **Planning** no MVP, depois Daily e Review. Conversa em chat ao vivo com o PM, lê transcripts curados, propõe composição de sprint, registra notas estruturadas e cria tasks via aprovação humana.

**Diferença de quem:**
- **Vitor** = descoberta (design session, hierarquia de produto)
- **Alpha** = operação contínua (sprint health, alocação, /ops sidebar global)
- **Vitoria** = rituais cronológicos do projeto (planning, daily, review — eventos com começo, meio e fim)

**Decisão técnica de provider:** Vitoria roda em **Anthropic SDK direto** (não OpenRouter) com **modelo `claude-haiku-4-5`**, autenticado via OAuth token (`CLAUDE_CODE_OAUTH_TOKEN` — subscription Claude). É o **primeiro agente do Volund-Perke a usar Anthropic direto**, e funciona como piloto pra possível migração futura. Vitor e Alpha continuam intactos com OpenRouter.

---

## 2. Problema

PM de software house roda **3 rituais por sprint por projeto**:

| Ritual | Hoje | Dor |
|---|---|---|
| **Planning** (segunda) | PM lê transcripts de 1-on-1, reviews, calls da semana, junta com backlog e capacidade do time, propõe sprint manualmente | 2-4h de leitura + síntese. Esquece de cruzar evidência. Tasks que viram caem mal escritas |
| **Daily** (todo dia) | PM revê status, identifica bloqueio | Status fica em conversa, não vira nota estruturada |
| **Review** (fim de sprint) | PM consolida o que entregou, o que não, por quê | Memória do sprint passa rápido; review fica raso |

**Hoje no Perke:** Planning Ceremony tem schema pronto (6 tabelas + 2 colunas), UI em construção, **agente ainda não existe**. Plano técnico assume Alpha como copiloto — mas Alpha é agente global (`/ops`), não está ancorado no ritual. Misturar Alpha + ritual cria dois problemas: (a) escopo de contexto inflado, (b) confusão visual ("quem é quem na UI?").

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
6. Provar que **Anthropic SDK direto + OAuth subscription** é caminho viável pro Perke (alternativa a OpenRouter)

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

> **Segunda 10h.** PM Carolina abre o projeto Zelar, vai pro tab Cerimônias, clica em "Nova Planning" → cria PlanningCeremony em fase `idle`.

```
┌─────────────────────────────────────────────────────────────────┐
│ Tab Cerimônias — Projeto Zelar                                  │
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

**Carolina clica na Planning ativa.** Abre o **Command Center** — tela full do ritual.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Planning — Sprint 12 · Zelar                              [×]         │
│                                                                        │
│  Fase: idle ──→ reading ──→ proposing ──→ approving ──→ closed         │
│         ●                                                              │
│                                                                        │
│  ┌─ Contexto vinculado ─────────────────────────────────────────────┐  │
│  │ 📞 Meetings (0)                                  [+ vincular]   │  │
│  │ 📝 Transcripts (0)                               [+ vincular]   │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌─ Chat com Vitoria ──────────────────────────────────────────────┐  │
│  │                                                                 │  │
│  │ 🟣 Vitoria                                                      │  │
│  │ Oi Carolina. Pra começar, vincula 1-3 transcripts ou meetings  │  │
│  │ da semana — calls 1-on-1, retros, syncs com cliente. Eu leio   │  │
│  │ tudo e te trago um briefing.                                   │  │
│  │                                                                 │  │
│  │ ┌──────────────────────────────────────────────────────────┐   │  │
│  │ │ digite aqui...                                          │   │  │
│  │ └──────────────────────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

**Carolina vincula 3 transcripts** (call cliente + retro + 1-on-1 com dev). Status da Planning vira "1 transcript primary + 2 supporting" via `PlanningTranscriptLink.weight`.

**Carolina:** "vamos lá, lê esses transcripts e me traz o que importa pra sprint"

**Vitoria** (em chat, com indicador "lendo..." enquanto streama):

```
🟣 Vitoria

Lidos 3 transcripts. Aqui o briefing:

📌 Temas centrais
  • Refatoração de pagamentos (cliente pediu na call — bloqueia checkout v2)
  • Tech debt em auth-service (dev mencionou 3x na retro)

⚠️ Riscos
  • Eduardo tira 2 dias de férias na próxima semana (1-on-1)
  • Migração Stripe ainda dependente de aprovação legal

🎯 Sinais de capacidade
  • Sprint 11 entregou 28FP de 35FP planejados (80%)
  • Backlog tem 4 stories refined apontando pra pagamento

❓ Perguntas abertas
  • Refatoração de pagamentos é prioridade ou continua o tech debt do auth?

Registrei 5 notas pra essa Planning. Bora pro próximo passo:
quer ver opções de composição de sprint, ou refinar alguma nota?
```

> Fase mudou: `idle → reading → proposing` (transição automática quando Vitoria gera ≥1 summary + ≥3 outras notes).

**Carolina:** "refatoração de pagamentos é prioridade"

**Vitoria:**
```
🟣 Vitoria

Anotado — decisão registrada. Olhando capacidade:

📊 Composição proposta — Sprint 12

  Capacidade: 32 FP (Eduardo 2d off → -5FP do baseline 37)

  ✓ ZRD-S-042: Refatorar PaymentService (12FP)
    └─ origem: call-cliente, retro
  ✓ ZRD-S-043: Migração Stripe — fase 1 (8FP)
    └─ origem: call-cliente
  ✓ ZRD-S-045: Otimizar query orders (5FP)
    └─ origem: retro (Eduardo)
  ✓ ZRD-S-047: Fix race condition checkout (5FP)
    └─ origem: retro
  ⏸ ZRD-S-051: Auth refresh token (2FP) — bumper

  Total: 32FP. 4 stories core + 1 buffer.

Cada item já é proposta de Action — você revisa antes de virar task.
[Revisar 5 actions] [Adicionar item]
```

> Fase: `proposing → approving` (quando Carolina clica "Revisar").

**Carolina abre MeetingTaskActionSheet** (UI já existe), aprova 4, ajusta 1 estimativa, descarta o buffer. Volta pro chat.

**Carolina:** "manda"

**Vitoria:** "Aprovações aplicadas. 4 tasks criadas no backlog: ZRD-S-042, 043, 045, 047. Planning fechada. Vejo você na Daily."

> Fase: `approving → closed`. `briefingGeneratedAt`, `closedAt` stamped.

**Tempo total:** 22 minutos. Carolina vai pra próxima atividade.

### 4.3 Jornadas pós-MVP (Daily, Review)

Mesma identidade visual, contexto diferente:
- **Daily:** Vitoria pergunta "o que aconteceu desde ontem?", lista bloqueios estruturados, escreve note `kind=blocker` por dev mencionado
- **Review:** Vitoria recapitula sprint (tasks done/not done), pede insights da PM, gera summary que vai pro Wiki do projeto

---

## 5. Escopo funcional — MVP (Planning Ceremony)

### 5.1 Identidade

| Atributo | Valor |
|---|---|
| Slug interno | `vitoria` |
| Nome display | "Vitoria" |
| Personalidade | Direta, sintética, cita origem. Não puxa opinião, propõe baseado em evidência. |
| Glifo | **Mesmo SVG do VitorIcon**, exportado como `VitoriaIcon` |
| Cor primária | **Violet-500** (`#8B5CF6`) — combina com a paleta atual sem colidir com Alpha (pink) ou Vitor (cor atual) |
| Token de tema | `text-violet-500 / bg-violet-50 / border-violet-200` + dark variants |
| Modelo | `claude-haiku-4-5` (Anthropic SDK direto, OAuth token) |
| Auth | `CLAUDE_CODE_OAUTH_TOKEN` no `.env` (formato `sk-ant-oat01-...`) |
| Header HTTP | `Authorization: Bearer <token>` + `anthropic-beta: oauth-2025-04-20` |

### 5.2 Onde Vitoria aparece

- **Aparece em:** Command Center da Planning Ceremony (`/projects/[id]/ceremonies/[planningId]` ou modal/sheet)
- **Aparece em:** Lista de Cerimônias quando a planning está "ativa" (badge "Vitoria conduzindo")
- **NÃO aparece em:** `/ops` (Alpha-only), `/design-sessions` (Vitor-only), sidebar global, briefing wizard

### 5.3 Capacidades de chat

| Capacidade | MVP |
|---|---|
| Streaming SSE | ✅ |
| Persistência mensagem por mensagem | ✅ (`ChatThread.agentName = "vitoria"`, `channel = "planning"`) |
| Resume de conversa após F5 | ✅ |
| Thread única por PlanningCeremony | ✅ |
| Tool calls visíveis no UI (chips) | ✅ |
| Cancelamento mid-stream | ✅ |
| Histórico cross-planning (Vitoria lembra de planning anterior) | ❌ — escopo é por planning |

### 5.4 Tools que Vitoria expõe (MVP)

5 tools novas + 3 reusadas do Alpha:

| Tool | Tipo | Origem |
|---|---|---|
| `read_linked_transcripts` | read | nova |
| `add_planning_note` | write | nova |
| `list_planning_notes` | read | nova |
| `propose_task_action` | write | nova (cria `MeetingTaskAction` pending) |
| `get_planning_state` | read | nova (agregado: fase, contexto, notes count) |
| `get_sprint_overview` | read | reusa de Alpha |
| `get_backlog` | read | reusa de Alpha |
| `list_unplanned_tasks` | read | reusa de Alpha |

**Não expõe** no MVP: `create_task` direto (sempre via Action), `manage_allocation` (escopo Alpha), `update_wiki_section` (Fase 3 — Review).

### 5.5 Máquina de estados — quem dispara o quê

| Transição | Quem dispara | Pré-condição | Side effect |
|---|---|---|---|
| `idle → reading` | PM (botão ou primeira msg no chat) | ≥1 transcript OU meeting linkado | `startedAt` stamped, Vitoria recebe primeiro turn |
| `reading → proposing` | Vitoria (ao terminar briefing) | ≥1 note kind=summary + ≥3 outras notes | `briefingGeneratedAt` stamped, UI revela "Revisar composição" |
| `proposing → approving` | PM (clica Revisar) | ≥1 `MeetingTaskAction` pending | Vitoria trava criação de novas actions; só pode editar/descartar |
| `approving → closed` | PM (aplica todas actions) | 0 actions `pending` | `closedAt` stamped; actions viram tasks; Vitoria recebe turn final de fechamento |
| `reading|proposing → idle` | PM (reset) | — | DELETE notes, DELETE actions pending. Mantém links. |
| `closed → archived` | Cron (30d) ou manual | `closedAt > 30d` | só read-only |

### 5.6 Persistência

| Tabela | Uso pela Vitoria |
|---|---|
| `PlanningCeremony` | Lê fase, escreve `briefingGeneratedAt` indiretamente via note insert |
| `PlanningContextNote` | Insere kinds: `summary`, `theme`, `risk`, `capacity_signal`, `open_question` |
| `PlanningContextNoteSource` | Cita transcript de origem (FK normalizada) |
| `MeetingTaskAction` | Insere via `propose_task_action`, com `planningCeremonyId` populado |
| `ChatThread` | Cria thread por planning (`agentName=vitoria, channel=planning`, metadata jsonb `{ planningCeremonyId }`) |
| `ChatMessage` | Persistência turn-by-turn com `parts[]` (tool-call chips, etc) |
| `Agent` | **Linha nova** com `slug=vitoria, name=Vitoria, modelId=anthropic-direct/claude-haiku-4-5, isActive=true` |
| `AgentUsage` | Cada turn da Vitoria gera 1 row pra rastreio de custo (ver §5.7) |

### 5.7 Sessão de Agentes (`/agents`) — Vitoria como cidadã de 1ª classe

O Perke já tem hub central de agentes em [`src/app/(dashboard)/agents`](../../src/app/(dashboard)/agents):

| Rota | O que mostra | Hoje | Pra Vitoria |
|---|---|---|---|
| `/agents` | Lista todos os agentes ativos (`Agent` table, `isActive=true`) | Mostra Vitor + Alpha | **Inclui Vitoria automaticamente** após INSERT na tabela `Agent` |
| `/agents/[slug]` | Página do agente — descrição + status + ações | Funciona pra qualquer slug | `/agents/vitoria` funciona após INSERT |
| `/agents/[slug]/settings` | Ajuste de parâmetros (system prompt, model, tools enabled) via `AGENT_SETTINGS_REGISTRY` | Vitor + Alpha registrados | **Registrar `vitoria` no `AGENT_SETTINGS_REGISTRY`** |
| `/agents/[slug]/usage` | Métricas de uso — calls, tokens, custo, breakdown por modelo/membro/dia | Lê `AgentUsage` filtrando por `agentName` | **Funciona out-of-the-box** após `AgentUsage` ter rows com `agentName="vitoria"` |

#### 5.7.1 Cadastro inicial no banco

Migration nova `supabase/migrations/<date>_seed_vitoria_agent.sql`:

```sql
INSERT INTO public."Agent" (
  id, slug, name, description, "modelId", "isActive",
  "systemPromptOverride", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text,
  'vitoria',
  'Vitoria',
  'Copiloto de Rituais — conduz Planning, Daily, Review do projeto. Lê transcripts, propõe sprint, registra notas. Anthropic direto (Haiku 4.5).',
  'anthropic-direct/claude-haiku-4-5',
  true,
  null,
  now(), now()
) ON CONFLICT (slug) DO NOTHING;
```

#### 5.7.2 Badge + ícone na sessão de Agentes

Atualizar [`src/app/(dashboard)/agents/page.tsx`](../../src/app/(dashboard)/agents/page.tsx) helper `AgentSlugBadge`:

```ts
function AgentSlugBadge({ slug, name }: { slug: string; name: string }) {
  if (slug === "ops" || slug === "alpha")
    return <AgentBadge agent="alpha" size="md" label={name} />;
  if (slug === "design-session" || slug === "vitor")
    return <AgentBadge agent="vitor" size="md" label={name} />;
  if (slug === "vitoria")
    return <AgentBadge agent="vitoria" size="md" label={name} />;  // ← novo
  return <span className="...">{name}</span>;
}
```

E em `AgentBadge` ([`src/components/ui/conversation/agent-badge.tsx`](../../src/components/ui/conversation/agent-badge.tsx) — ou similar):
- Adicionar variant `agent="vitoria"` que renderiza `<VitoriaIcon />` + tema violet (`text-violet-500`, `bg-violet-50/30`, `border-violet-200`)
- Mesma API de `agent="vitor" | "alpha"`

#### 5.7.3 Settings registry

Adicionar entrada em [`src/lib/agent/settings-registry.ts`](../../src/lib/agent/settings-registry.ts):

```ts
export const AGENT_SETTINGS_REGISTRY: Record<string, SettingsSchema> = {
  vitor:   { /* existente */ },
  alpha:   { /* existente */ },
  vitoria: {
    // schema dos parâmetros editáveis: model override, system prompt override,
    // tools enabled, fallback provider, etc.
    fields: [
      { key: "modelId", type: "select",
        options: ["anthropic-direct/claude-haiku-4-5", "anthropic-direct/claude-sonnet-4-6", "anthropic/claude-haiku-4-5"],
        default: "anthropic-direct/claude-haiku-4-5",
        label: "Modelo" },
      { key: "fallbackProvider", type: "boolean",
        default: false,
        label: "Fallback OpenRouter se rate-limited" },
      // ...outros
    ],
  },
};
```

Pra ajustes em runtime sem deploy.

#### 5.7.4 Cost tracking — o ponto crítico

**Problema:** OpenRouter devolve `cost_usd` em `providerMetadata.openrouter.usage`. Anthropic SDK direto **não devolve custo**. Só `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`.

**Solução:** tabela de pricing local + cálculo em `recordAgentUsage`.

```ts
// src/lib/ai/pricing.ts (novo arquivo, ~30 linhas)
type ModelPricing = {
  inputPerMTok: number;       // USD per 1M input tokens
  outputPerMTok: number;
  cacheWritePerMTok: number;  // criação de cache
  cacheReadPerMTok: number;   // hit
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "anthropic-direct/claude-haiku-4-5": {
    inputPerMTok: 1.00,
    outputPerMTok: 5.00,
    cacheWritePerMTok: 1.25,    // +25% sobre input
    cacheReadPerMTok: 0.10,     // 10% do input
  },
  "anthropic-direct/claude-sonnet-4-6": {
    inputPerMTok: 3.00,
    outputPerMTok: 15.00,
    cacheWritePerMTok: 3.75,
    cacheReadPerMTok: 0.30,
  },
  "anthropic-direct/claude-opus-4-7": {
    inputPerMTok: 15.00,
    outputPerMTok: 75.00,
    cacheWritePerMTok: 18.75,
    cacheReadPerMTok: 1.50,
  },
};

export function calculateCost(
  modelId: string,
  usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number }
): number {
  const p = MODEL_PRICING[modelId];
  if (!p) return 0; // model desconhecido → 0, log warning
  return (
    (usage.inputTokens / 1_000_000) * p.inputPerMTok +
    (usage.outputTokens / 1_000_000) * p.outputPerMTok +
    ((usage.cacheCreationInputTokens ?? 0) / 1_000_000) * p.cacheWritePerMTok +
    ((usage.cacheReadInputTokens ?? 0) / 1_000_000) * p.cacheReadPerMTok
  );
}
```

**Ajuste em [`src/lib/agent/usage.ts`](../../src/lib/agent/usage.ts):**

```ts
import { calculateCost, MODEL_PRICING } from "@/lib/ai/pricing";

export async function recordAgentUsage(input) {
  // ... lógica existente

  const isAnthropicDirect = input.modelId.startsWith("anthropic-direct/");

  // OpenRouter devolve cost; Anthropic direto requer cálculo local
  const costUsd = isAnthropicDirect
    ? calculateCost(input.modelId, {
        inputTokens: input.totalUsage.inputTokens,
        outputTokens: input.totalUsage.outputTokens,
        cacheCreationInputTokens: input.totalUsage.cacheCreationInputTokens,
        cacheReadInputTokens: input.totalUsage.cacheReadInputTokens,
      })
    : extractCostFromOpenRouter(input.steps); // lógica existente

  await db().from("AgentUsage").insert({
    agentName: input.agentName,
    threadId: input.threadId,
    memberId: input.memberId,
    modelId: input.modelId,
    promptTokens: input.totalUsage.inputTokens,
    completionTokens: input.totalUsage.outputTokens,
    totalTokens: input.totalUsage.inputTokens + input.totalUsage.outputTokens,
    cachedPromptTokens: input.totalUsage.cacheReadInputTokens ?? null,
    costUsd,
    generationId: input.generationId,
    rawUsage: input.totalUsage,  // jsonb pra debug
  });
}
```

**Reflexo em `/agents/vitoria/usage`:** a página já funciona — só precisa que `costUsd` esteja preenchido. Tabela hoje agrega:
- Total: `calls`, `promptTokens`, `completionTokens`, `totalTokens`, `costUsd`
- Por modelo, por membro, por dia, recent rows
- **Filtros existentes:** 7d / 30d / all

Tudo isso passa a funcionar pra Vitoria sem mudança no UI.

#### 5.7.5 Dashboard de custos consolidado (pós-MVP, opcional)

Hoje `/agents/[slug]/usage` é per-agent. Se quiser ver custos de **todos os agentes lado a lado** (compare Vitor vs Alpha vs Vitoria), criar `/agents/usage` (sem slug) que agrega.

**Não no MVP** — `/agents/[slug]/usage` resolve.

#### 5.7.6 Hard cap / alertas (decisão de §11)

Opções pra controle de custo:

| Opção | Quando | Como |
|---|---|---|
| **A. Só monitoramento** | MVP padrão | `/agents/vitoria/usage` mostra; alerta manual via Slack/email se passar de $X/dia |
| **B. Soft cap por planning** | Se piloto subir | `recordAgentUsage` soma turn-by-turn por `threadId`; se passar de $0.50/thread, próximo turn injeta warning no prompt |
| **C. Hard cap mensal por agente** | Pós-MVP | Cron diário lê `AgentUsage` mês corrente; se > $X, set `Agent.isActive=false` (Vitoria fica indisponível até reset) |

**Recomendação:** A no MVP, B na primeira iteração pós-lançamento.

---

## 6. Critérios de aceite (MVP)

### 6.1 Funcional

- [ ] **F1.** PM cria PlanningCeremony, abre Command Center, vê Vitoria pronta no chat
- [ ] **F2.** Vincula ≥1 transcript → fase `idle → reading` automática
- [ ] **F3.** Vitoria chama `read_linked_transcripts` no primeiro turn (ferramenta visível no chip)
- [ ] **F4.** Vitoria gera ≥1 summary + ≥3 notes em ≤2 minutos pra 3 transcripts pequenos (≤2k tokens cada)
- [ ] **F5.** Fase muda pra `proposing` quando critério de notes é atingido
- [ ] **F6.** PM pede "propõe sprint", Vitoria chama `get_sprint_overview`, `get_backlog`, `propose_task_action` x N
- [ ] **F7.** Cada `MeetingTaskAction` criada tem `planningCeremonyId` populado E `sourceNoteIds[]` ligando à note de origem
- [ ] **F8.** PM revê em `MeetingTaskActionSheet` (UI existente), aprova/edita/descarta
- [ ] **F9.** Tudo aprovado → fase `closed`, tasks criadas no backlog do projeto, Vitoria emite turn de fechamento

### 6.2 Visual/UX

- [ ] **V1.** Avatar/badge da Vitoria usa `VitoriaIcon` + tema violet em todos os 4 lugares (chat header, message bubble, lista cerimônias, MeetingTaskActionSheet origem)
- [ ] **V2.** Cor violet **não conflita** com Alpha (pink) ou estados do sistema (verde/amarelo/vermelho)
- [ ] **V3.** Tool calls aparecem como chip enxuto (não dump de JSON), expandível
- [ ] **V4.** Indicador de fase muda visualmente (progress bar / breadcrumb na top bar do Command Center)

### 6.3 Técnico

- [ ] **T1.** Anthropic SDK direto funciona — chamadas vão pra Anthropic, **não** pra OpenRouter (verificável via Network tab + logs)
- [ ] **T2.** `OPENROUTER_API_KEY` continua funcionando — Vitor + Alpha não regridem (smoke test antes e depois)
- [ ] **T3.** Streaming SSE end-to-end (text-delta, tool-call, tool-result, finish) renderiza correto
- [ ] **T4.** Resume de conversa: F5 no Command Center recarrega últimas N mensagens
- [ ] **T5.** Cache control funciona (Anthropic SDK aceita `providerOptions.anthropic.cacheControl`) — input_tokens cache-hit visível em `usage` log
- [ ] **T6.** Usage log inclui custo (Anthropic não retorna custo; calcular local via tabela fixa Haiku 4.5)

### 6.5 Sessão de Agentes (`/agents`)

- [ ] **AG1.** Linha `Agent { slug: "vitoria", isActive: true }` existe no banco após migration de seed
- [ ] **AG2.** `/agents` lista Vitoria entre Vitor e Alpha com badge violet + ícone Vitoria
- [ ] **AG3.** `/agents/vitoria` carrega página com descrição correta e link pra usage/settings
- [ ] **AG4.** `/agents/vitoria/usage` mostra calls/tokens/custo após Vitoria rodar 3+ plannings — tabela populada
- [ ] **AG5.** Custo em `AgentUsage.costUsd` calculado via `MODEL_PRICING` (≠ 0 quando há tokens registrados)
- [ ] **AG6.** Filtros 7d / 30d / all funcionam na página de usage
- [ ] **AG7.** Breakdown por modelo mostra `anthropic-direct/claude-haiku-4-5`
- [ ] **AG8.** Breakdown por membro lista o PM que rodou a Planning
- [ ] **AG9.** `/agents/vitoria/settings` lista campos do `AGENT_SETTINGS_REGISTRY.vitoria` (model, fallback, etc)
- [ ] **AG10.** Mudança de modelo em settings (ex: Haiku → Sonnet) reflete em `Agent.modelId` e próximo turn já usa o novo (sem deploy)

### 6.4 Adversarial

- [ ] **A1.** PM tenta entrar em `proposing` sem vincular transcript → Vitoria recusa, explica o que falta
- [ ] **A2.** PM pede pra criar task fora do contexto (sem note de origem) → Vitoria propõe com flag "assumption" ou abre `open_question`
- [ ] **A3.** PM faz reset mid-Planning → notes/actions deletadas, fase volta pra `idle`, chat continua mas sem contexto antigo
- [ ] **A4.** Rate limit (Haiku tem cota da subscription) → mensagem clara pro PM, sem crash do UI

---

## 7. Métricas de sucesso

### 7.1 Métricas primárias

| Métrica | Baseline (estimado) | Meta MVP |
|---|---|---|
| **Tempo médio de Planning** | 2-4h (PM faz manual) | **≤ 30 min** |
| **% de tasks com origem rastreável** | <20% (PM esquece de citar) | **≥ 80%** |
| **% de Plannings que chegam em `closed`** | n/a (feature nova) | **≥ 90%** |
| **NPS PM** ("Vitoria me ajudou?") | n/a | **≥ 8/10** após 10 plannings |

### 7.2 Métricas técnicas

| Métrica | Meta |
|---|---|
| **Latência primeiro token** | ≤ 2s (Haiku 4.5 é rápido) |
| **Custo médio por Planning** | ≤ $0.10 (estimado: ~30k tokens input + 3k output via cache, valor cobre rate da subscription) |
| **Taxa de retry por rate limit** | ≤ 5% das requests |
| **Audit Vitoria** (pós-MVP, similar ao Vitor) | **≥ 70% correto** em baseline V1..V10 |

### 7.3 Métricas de validação do provider (piloto)

| Métrica | Pergunta a responder |
|---|---|
| Anthropic direto funciona estável? | Uptime ≥ 99% durante 2 semanas piloto |
| Custo direto vs OpenRouter (Haiku) | Diferença em $/M tokens — vale migrar ou não? |
| OAuth token aguenta? | Sem reauthenticate forçado em 30 dias |
| Cache control funciona? | input_tokens_cache_read > 0 após segundo turn |

---

## 8. Riscos e mitigações

### 8.1 Risco — rate limit Haiku via OAuth

OAuth da subscription Claude pode bater limite. Confirmado em testes: Sonnet/Opus já saturados, Haiku livre **agora**.

**Mitigação:**
- Mensagem clara no chat em 429 ("Vitoria está descansando — tenta de novo em alguns minutos")
- Fallback automático pra OpenRouter Haiku (1 linha — `modelId` muda) com feature flag `VITORIA_FALLBACK_OPENROUTER=true`
- Monitor de 429/hora — alarme em ≥10/h

### 8.2 Risco — Haiku 4.5 não dá conta de Planning complexa

Haiku é menor que Sonnet/Opus. Pra raciocínio sobre sprint composition (capacidade + skills + deps), pode ser raso.

**Mitigação:**
- **Compensar via prompt** — instruções explícitas (cite origem, peça confirmação, não invente)
- **Tools fazem o trabalho pesado** — Vitoria não calcula capacidade na cabeça; chama `get_sprint_overview` que retorna numbers
- **Upgrade fácil** — `vitoriaAgent.model = "anthropic-direct/claude-sonnet-4-6"` quando subscription liberar Sonnet

### 8.3 Risco — engine compartilhado com Vitor + Alpha

Mudança em `engine.ts` (cache key dinâmica) pode regredir Vitor/Alpha.

**Mitigação:**
- Feature flag `USE_ANTHROPIC_DIRECT_FOR_VITORIA=true` controla se o roteamento entra em ação
- Smoke test Vitor + Alpha antes E depois do merge
- Rollback de 1 linha (feature flag) se algo quebrar

### 8.4 Risco — Carolina (PM) não confia em Vitoria

Adoção falha se PM achar que perde controle.

**Mitigação:**
- **Toda escrita é proposta**, não final (Action, não Task direto)
- **Origem sempre visível** (chip de note de origem na tela de Action)
- **Reset zero-fricção** ("voltar ao começo" deleta notes/actions, mantém transcripts)
- **PM tem override** em qualquer step (fechar Planning sem aplicar todas Actions é permitido)

### 8.5 Risco — confusão Vitoria vs Alpha vs Vitor

Três agentes diferentes no mesmo app pode confundir.

**Mitigação:**
- **Cor diferente** pra cada (violet, pink, atual) — leitura visual instantânea
- **Escopo claro** na UI ("Vitoria conduz esta Planning", "Alpha está no /ops")
- **Documentação interna** (CLAUDE.md / AGENTS.md) com quem-faz-o-quê

---

## 9. Cronograma — entregáveis incrementais

> Cada fase é commitable e gera valor. Sem big-bang.

### Fase 0 — Infra do provider (1 dia)

- Adicionar `@ai-sdk/anthropic` ao `package.json`
- Editar `src/lib/ai/provider.ts` — prefix routing `anthropic-direct/`
- Editar `src/lib/agent/engine.ts` — cache key dinâmica
- Editar `src/lib/agent/usage.ts` — fallback de providerMetadata
- Renomear `.env`: `ANTHROPIC_API_KEY` → `CLAUDE_CODE_OAUTH_TOKEN` (clareza de propósito)
- Provider injeta header `Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20`
- **Critério:** chamar `getModel("anthropic-direct/claude-haiku-4-5")` num script standalone retorna stream válido

### Fase 1 — Vitoria agent definition (1 dia)

- Criar `src/components/icons/vitoria-icon.tsx` (copy do VitorIcon, novo export name)
- Criar `src/lib/agents/vitoria-theme.ts` (tokens violet)
- Criar `src/lib/agent/agents/vitoria/{index,prompt,tools,context}.ts`
- `vitoriaAgent.model = "anthropic-direct/claude-haiku-4-5"`
- Smoke script `scripts/vitoria-cli.ts`
- **Critério:** `tsx scripts/vitoria-cli.ts --planning <id> --message "olá"` streama resposta em violet (no terminal, ANSI roxo)

### Fase 2 — Endpoint + connector (1 dia)

- Route `src/app/api/planning/[id]/chat/route.ts` (POST + GET history)
- Connector `src/lib/agent/connectors/planning-chat.ts`
- Auth: `requirePlanningAccessApi` (criar se não existir; baseado em `can_view_project`)
- Persistência: thread `agentName="vitoria"`, `channel="planning"`, metadata `{ planningCeremonyId }`
- **Critério:** `curl -X POST /api/planning/<id>/chat` com body válido retorna SSE

### Fase 2.5 — Cidadania no /agents + cost tracking (1 dia)

- Migration `<date>_seed_vitoria_agent.sql` — INSERT em `Agent` (slug=vitoria, active=true)
- Update `AgentSlugBadge` em [`/agents/page.tsx`](../../src/app/(dashboard)/agents/page.tsx)
- Adicionar variant `vitoria` em `AgentBadge` component (violet + VitoriaIcon)
- Registrar `vitoria` em `AGENT_SETTINGS_REGISTRY` (model, fallback, prompt override)
- Criar `src/lib/ai/pricing.ts` — tabela `MODEL_PRICING` + função `calculateCost`
- Adaptar `src/lib/agent/usage.ts` — branch Anthropic direto chama `calculateCost`
- Verificar `AgentUsage` insert popula `costUsd` corretamente
- **Critério:** `/agents` lista Vitoria; `/agents/vitoria` carrega; após rodar Vitoria 1x, `/agents/vitoria/usage` mostra ≥1 row com `costUsd > 0`

### Fase 3 — Tools de Planning (2-3 dias)

- Tool `add_planning_note` — insert `PlanningContextNote` + `PlanningContextNoteSource`
- Tool `list_planning_notes` — read filtered por kind/dismissed
- Tool `read_linked_transcripts` — lazy load full `TranscriptRef.fullText` por id
- Tool `propose_task_action` — insert `MeetingTaskAction` com `planningCeremonyId` + `sourceNoteIds`
- Tool `get_planning_state` — agregado (fase, counts, ultima_atividade)
- Reusar de Alpha: `get_sprint_overview`, `get_backlog`, `list_unplanned_tasks`
- **Critério:** rodar conversa real ponta a ponta (jornada §4.2) sem intervenção manual

### Fase 4 — UI Command Center (3-4 dias)

- Componente `src/components/planning/command-center.tsx`
- Sub-componentes: `vitoria-chat.tsx` (adaptado de `alpha-chat/panel.tsx` com tema violet), `phase-progress.tsx`, `context-pane.tsx`, `notes-pane.tsx`
- Integração com `MeetingTaskActionSheet` (já existe — só passar `planningCeremonyId` no contexto)
- Rota: provavelmente `src/app/(dashboard)/projects/[id]/ceremonies/[ceremonyId]/page.tsx` (verificar branch da Planning Ceremony UI)
- **Critério:** Carolina (PM real ou simulado) executa jornada §4.2 ponta a ponta em uma sessão

### Fase 5 — Audit (1-2 dias)

- Adaptar `docs/vitor-audit.md` pra Vitoria → `docs/vitoria-audit.md`
- 10-12 cenários: F1..F9 + adversarial A1..A4
- Rodar baseline, medir % correto
- **Critério:** ≥70% correto + lista de gaps priorizados

### Fase 6 — Hardening e métricas (1 dia)

- Dashboard interno de métricas (count plannings, tempo médio, custo)
- Alertas de rate limit
- Fallback OpenRouter feature flag
- **Critério:** métricas §7 funcionando em produção

**Total estimado: 10-14 dias.** Solo dev, sem bloqueios. (+1 dia da Fase 2.5)

---

## 10. Dependências e pré-requisitos

### 10.1 Schema (Planning Ceremony)

Pré-requisito: **as 6 tabelas + 2 colunas do plano [`docs/features/meetings/planning-ceremony-plan.md`](../features/meetings/planning-ceremony-plan.md) precisam estar em prod.**

Status atual (verificar em `supabase/migrations/`):
- [ ] `PlanningCeremony`
- [ ] `TranscriptRef`
- [ ] `PlanningMeetingLink`
- [ ] `PlanningTranscriptLink`
- [ ] `PlanningContextNote`
- [ ] `PlanningContextNoteSource` (7ª tabela, decisão de 2026-05-28)
- [ ] `MeetingTaskAction.planningCeremonyId` (coluna adicional)
- [ ] `Project.planningCadence` + `Project.planningActive` (2 colunas inline)
- [ ] State machine helper `src/lib/planning/phase.ts`

### 10.2 UI base de Cerimônias

- [ ] Tab "Cerimônias" em `/projects/[id]` existe (Fase 1 de [`project_meetings_reorg`])
- [ ] Listagem de PlanningCeremony por projeto
- [ ] Botão "+ Nova Planning"

### 10.2-bis Sessão de Agentes (`/agents`)

- [x] Rotas `/agents`, `/agents/[slug]`, `/agents/[slug]/usage`, `/agents/[slug]/settings` existem
- [x] Tabela `Agent` em prod com Vitor + Alpha ativos
- [x] Tabela `AgentUsage` com schema completo (migration `20260426_agent_usage.sql`)
- [x] `AGENT_SETTINGS_REGISTRY` carregando Vitor + Alpha
- [x] Componente `AgentBadge` aceitando variants
- [ ] **Falta:** seed de Vitoria (migration Fase 2.5)
- [ ] **Falta:** variant `vitoria` em `AgentBadge` + entrada no `AGENT_SETTINGS_REGISTRY` (código Fase 2.5)
- [ ] **Falta:** `src/lib/ai/pricing.ts` (não existe — código Fase 2.5)

### 10.3 Auth e env

- [ ] `CLAUDE_CODE_OAUTH_TOKEN` no `.env` local
- [ ] Mesmo token (ou outro válido) no `.env.production` da Vercel
- [ ] `.env` confirmado no `.gitignore` (já está via `.env*`)

### 10.4 Subscription

- [ ] Claude subscription ativa com cota Haiku 4.5 disponível (verificado em testes — funciona)
- [ ] Documentar tier atual (Pro? Max?) e cota mensal estimada
- [ ] Plano B documentado: fallback OpenRouter Haiku ($0.80/M input, $4/M output) — calcular crossover

---

## 11. Decisões abertas (precisa de você)

1. **Fallback OpenRouter no MVP** — implementar agora ou só se rate limit virar problema real?
2. **Cobrança/limite custo** — colocar hard cap por planning ($X) ou só monitorar?
3. **Vitoria participa da Daily/Review no MVP** — não (foco Planning), ou tipo "stub" pronto pra ativar depois?
4. **Audit baseline antes ou depois** — rodar audit em ambiente staging antes de soltar pra PMs reais, ou learning by doing?
5. **Localização** — "Vitoria" é nome PT-BR. Prompt e respostas em português? Em inglês? Toggle?
6. **Notificação** — Vitoria emite notificação quando termina briefing (push/toast no Volund)? Ou PM precisa olhar a Planning?

---

## 12. Out of scope (deliberadamente)

- MCP (Vitoria não consome MCP no MVP — Anthropic SDK suporta, mas escopo cresce)
- Volund OS integration (totalmente isolado — este é independente)
- BYO OAuth per-user (usa key da org)
- Migrar Vitor pro Anthropic direto (Vitor mantém OpenRouter)
- Multi-language UI (PT-BR only no MVP)
- Audit completo tipo Vitor (`vitor-audit.md` tem 14 cenários — Vitoria começa com 10-12)
- Mobile-first Command Center (responsive, mas otimizado pra desktop primeiro)

---

## 13. Glossário

| Termo | Definição |
|---|---|
| **Ritual** | Cerimônia recorrente do projeto (Planning, Daily, Review) — diferente de reunião pontual |
| **Cerimônia** | Sinônimo de Ritual no schema (`PlanningCeremony` etc) |
| **Phase** | Estado da PlanningCeremony — `idle/reading/proposing/approving/closed/archived` |
| **Action** | `MeetingTaskAction` — proposta de criar/editar task, sempre passa por aprovação humana |
| **Note** | `PlanningContextNote` — registro estruturado de algo que Vitoria leu/observou |
| **TranscriptRef** | Transcrição (de call, retro, sync) como entidade independente de Meeting |
| **OAuth token** | Token long-lived (1y) da subscription Claude, formato `sk-ant-oat01-...` |
| **Command Center** | Tela full-screen do ritual (chat + contexto + actions) |

---

## 14. Próximo passo concreto

1. **Validar pré-requisitos §10** — quantas das tabelas da Planning Ceremony já estão em prod? Verificar `supabase/migrations/`.
2. **Decidir as 6 perguntas de §11.**
3. **Aprovar PRD ou pedir ajustes.**
4. **Começar Fase 0** (provider infra) — depois 1, 2, 3 em sequência.

Quando pré-requisitos confirmados + PRD aprovado, total ~10 dias até PM real conseguir conduzir Planning real com Vitoria.
