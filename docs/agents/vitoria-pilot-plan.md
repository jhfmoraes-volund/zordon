# Plano — Vitoria (piloto Anthropic SDK direto, Opus 4.7)

**Repo:** este (`Perke/volund`)
**Branch sugerida:** `feat/vitoria-pilot`
**Escopo:** novo agente isolado em Cerimônias/Planning, sem tocar Vitor nem Alpha existentes.
**Data:** 2026-05-14

---

## 0. TL;DR

Cria agente novo **Vitoria** — irmã do Vitor, mesmo glifo, cor roxa. Roda no copiloto da Planning Ceremony (`src/components/project-ceremonies-tab.tsx` + Planning command center que está em desenvolvimento). Usa **Anthropic SDK direto via `@ai-sdk/anthropic`** com modelo **Opus 4.7** — OpenRouter sai do caminho **só nesse agente**. Alpha + Vitor seguem em OpenRouter inalterados (zero regressão).

**Por que aqui:** Planning é greenfield (memory `project_planning_ceremony`, plan em [`docs/features/meetings/planning-ceremony-plan.md`](../features/meetings/planning-ceremony-plan.md) — copiloto, sem usuários em prod, command center "escrever do zero"). Risco isolado, aprendizado real.

---

## 1. Identidade visual + textual

| Atributo | Vitor (referência) | Vitoria (novo) |
|---|---|---|
| Slug interno | `vitor` | `vitoria` |
| Nome display | "Vitor" | "Vitoria" |
| Glifo | VitorIcon (já existe) | **mesmo arquivo**, exportado como `VitoriaIcon` |
| Cor | (atual do Vitor) | **Roxo** — `violet-500` (#8B5CF6) na luz, `violet-400` no escuro. Match com estética dos chips/badges (já usa violet em vários lugares). |
| Domínio | Design session | Planning ceremony (copiloto PM) |
| Modelo | claude-sonnet-4.6 (via OpenRouter) | **claude-opus-4-7 (via Anthropic direto)** |

### Arquivos visuais a criar

- [`src/components/icons/vitoria-icon.tsx`](../../src/components/icons/vitoria-icon.tsx) — copy-paste do `VitorIcon`, troca `forwardRef` name e export pra `VitoriaIcon`. Mesmo glifo, mesmo viewBox, mesmo stroke. **A cor sempre vem via `text-violet-500` no parent** — ícone não hardcoda.

### Tokens de cor

Decisão pragmática: usar Tailwind `violet-*` (mesma família que já aparece em `feedback_chat_ui` e nos badges atuais). Convenção:

```ts
// src/lib/agents/vitoria-theme.ts (novo, pequeno)
export const VITORIA_THEME = {
  primary: "text-violet-500 dark:text-violet-400",
  bgSubtle: "bg-violet-50 dark:bg-violet-950/30",
  border: "border-violet-200 dark:border-violet-800",
  dot: "bg-violet-500",
} as const;
```

Reuso em qualquer chip/avatar/header da UI de Planning.

---

## 2. Arquitetura — onde Vitoria vive

```
src/app/api/planning/[id]/chat/route.ts        ← novo endpoint (POST + GET pra history)
   ↓
src/lib/agent/connectors/planning-chat.ts      ← novo connector (mesmo padrão do web.ts, mais simples)
   ↓
runAgent(req)  ← reusa engine existente
   ↓
vitoriaAgent (AgentDefinition)
   ↓
streamText() com getModel("anthropic/claude-opus-4-7")
                       ↑
                ESSE caminho usa Anthropic SDK direto
```

### O que **muda** no engine

`src/lib/ai/provider.ts` ganha **um segundo provider**, sem remover OpenRouter:

```ts
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createAnthropic } from "@ai-sdk/anthropic";

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export function getModel(modelId: string) {
  if (modelId.startsWith("anthropic-direct/")) {
    const id = modelId.replace("anthropic-direct/", "");
    return anthropic(id);
  }
  return openrouter(modelId, { usage: { include: true } });
}

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
export const VITORIA_MODEL = "anthropic-direct/claude-opus-4-7";
```

**Por que prefixo `anthropic-direct/`:** discrimina sem ambiguidade. Strings `anthropic/claude-*` continuam roteando pra OpenRouter (compat com Vitor + Alpha). Strings `anthropic-direct/claude-*` vão pra Anthropic SDK direto. Engine não precisa saber qual é qual — só chama `getModel(modelId)`.

### Cache strategy

OpenRouter usa `providerOptions.openrouter.cacheControl`. Anthropic direto usa `providerOptions.anthropic.cacheControl`. **Mesma idéia, key diferente**. O engine precisa adaptar:

```ts
// src/lib/agent/engine.ts (mudança cirúrgica)
const cacheKey = modelId.startsWith("anthropic-direct/") ? "anthropic" : "openrouter";

systemMessages.push({
  role: "system",
  content: stable,
  providerOptions: {
    [cacheKey]: { cacheControl: { type: "ephemeral" } },
  },
});
```

Trivial, mas precisa testar — `@ai-sdk/anthropic` v2 aceita `cacheControl` em providerOptions sim, mas confirmar antes (Context7 ou doc oficial).

### Usage tracking

`recordAgentUsage` hoje lê `event.steps[].providerMetadata.openrouter.usage`. Com Anthropic direto, a chave é `event.steps[].providerMetadata.anthropic.usage`. Adaptar:

```ts
// src/lib/agent/usage.ts
const usage = step.providerMetadata?.anthropic?.usage
            ?? step.providerMetadata?.openrouter?.usage;
```

Custo: Anthropic SDK não devolve `cost_usd` (OpenRouter devolve). Pra Vitoria, calcular custo localmente via `@/lib/ai/pricing` (já existe? — checar) ou tabela fixa de preços Opus 4.7. Pode ficar `null` no MVP — só métrica de adoção/qualidade conta no piloto.

---

## 3. AgentDefinition — `vitoriaAgent`

Arquivo: `src/lib/agent/agents/vitoria/index.ts` (novo).

```ts
import { buildVitoriaPrompt } from "./prompt";
import { assembleVitoriaTools } from "./tools";
import { buildPlanningContext } from "./context";
import type { AgentDefinition, AgentRunRequest } from "../../types";

export const vitoriaAgent: AgentDefinition = {
  name: "vitoria",
  model: "anthropic-direct/claude-opus-4-7",

  async loadContext(req: AgentRunRequest) {
    const planningId = req.params?.planningId as string;
    return buildPlanningContext(planningId);
  },

  buildPrompt(ctx) {
    return buildVitoriaPrompt(ctx);
  },

  async buildTools(ctx) {
    return assembleVitoriaTools(ctx);
  },
};
```

### 3.1 `context.ts` — o que Vitoria sabe

A Planning Ceremony tem 6 tabelas + 2 colunas (memory `project_planning_ceremony`). Vitoria precisa de:

```ts
export async function buildPlanningContext(planningId: string) {
  const [planning, project, sprint, transcripts, notes, meetings, actions, backlog] = await Promise.all([
    // planning row (phase, scheduledFor, facilitator, etc)
    // project meta
    // sprint corrente vinculado (se houver)
    // PlanningTranscript[] linkados
    // PlanningContextNote[] (kind, weight, content)
    // MeetingTaskAction[] pending de tasks pra criar
    // backlog do projeto (resumo, não conteúdo full)
  ]);

  return {
    planningId,
    phase: planning.phase,
    project, sprint,
    transcripts: transcripts ?? [],
    notes: notes ?? [],
    pendingActions: actions ?? [],
    backlogSummary: backlog,
  };
}
```

Verbosity baseada em `phase`:
- `idle` / `reading` → contexto enxuto, foco em explicar próximos passos
- `proposing` → contexto completo (todas notas + backlog + pending actions)
- `approving` → contexto + lista detalhada de actions pendentes
- `closed` / `archived` → modo read-only narrativo

### 3.2 `prompt.ts` — personalidade e regras

**Personalidade Vitoria** (diferente do Vitor):
- Vitor é **conduzir design session** (descoberta, hierarquia, refinamento)
- Vitoria é **copilotar planning de sprint** (consolidar, propor, aprovar)

Estrutura proposta (~400 linhas iniciais, evolui com uso real):

```
1. Identidade — Vitoria, copiloto do PM na Planning Ceremony, age em fases
2. Fases — descrição de cada (idle/reading/proposing/approving/closed/archived)
3. Princípios:
   - "Múltiplas reuniões viram contexto via link manual (PM curou — não invente relevância)"
   - "Cada task proposta tem base em evidência: cite o transcript/note de origem"
   - "Aprovação humana antes de magia"
4. Tools disponíveis (lista + quando chamar)
5. Heurísticas de qualidade de task (princípio de [`alpha/prompt.ts`])
6. Formatos de resposta (resumo, proposta, confirmação)
7. Anti-padrões (não inventar prioridade, não pular reading→proposing sem briefing)
```

Reusa **princípios** de [`alpha/prompt.ts`](../../src/lib/agent/agents/alpha/prompt.ts) (heurísticas de task naming, sprint composition) sem copiar tudo — Vitoria é fase-específica.

### 3.3 `tools.ts` — quais tools

Subset cirúrgico (reusar `alpha-planner.ts` quando faz sentido, criar específicas pra planning):

| Tool | De onde | Por quê |
|---|---|---|
| `add_planning_note` | **nova** | Vitoria registra summary/insight/risk durante reading |
| `list_planning_notes` | **nova** | relê o que já capturou |
| `propose_task_action` | **nova** | propõe MeetingTaskAction pra aprovação (cria pending, não final) |
| `get_planning_state` | **nova** | leitura agregada (substitui várias gets) |
| `read_transcript` | **nova** | conteúdo full de um transcript específico (lazy) |
| `get_sprint_overview` | alpha/tools.ts | reusa: sprint atual, FP allocation |
| `get_backlog` | alpha/tools.ts | reusa: backlog pra propor composição |
| `list_unplanned_tasks` | alpha/tools.ts | reusa: candidatos a entrar na sprint |

**NÃO expõe** (deliberadamente, no MVP):
- `create_task` direto — Vitoria propõe via `propose_task_action`, PM aprova, **action** vira task
- `manage_allocation` — fora do escopo de planning copiloto
- `bulk_update_tasks` — escopo Alpha global

---

## 4. Endpoint + connector

### 4.1 Route `src/app/api/planning/[id]/chat/route.ts`

Shape espelha `/api/agents/alpha/chat/route.ts` (já existe, é um bom template):

```ts
export const maxDuration = 300;

const VITORIA_CAPABILITIES: Capabilities = {
  maxSteps: 30,
  writeTools: true,
  readTools: true,
};

export async function GET(req, { params }) {
  // history loading — mesma lógica do alpha/chat/route GET, escopo planningId
}

export async function POST(req, { params }) {
  const { id: planningId } = await params;
  const denied = await requirePlanningAccessApi(planningId);
  if (denied) return denied;
  return planningChatConnector.handle(req, planningId);
}
```

### 4.2 Connector `src/lib/agent/connectors/planning-chat.ts`

Espelha `web.ts` mas mais simples (sem briefing scope marker, sem sub-phases — Planning tem seu próprio modelo de phase no DB).

```ts
export const planningChatConnector = {
  name: "planning" as const,
  capabilities: VITORIA_CAPABILITIES,

  async handle(req, planningId) {
    const user = await getUser();
    if (!user) return new Response("Unauthorized", { status: 401 });

    const body = await req.json();
    const { messages, threadId: requestedThreadId } = body;
    const message = extractLastUserText(messages);

    const member = await getCurrentMember();
    const threadId = requestedThreadId ?? await ensureAgentThread("vitoria", "planning", member?.id, { planningId });

    await persistUserMessage(threadId, message);

    const result = await runAgent({
      agent: vitoriaAgent,
      thread: { id: threadId },
      capabilities: VITORIA_CAPABILITIES,
      userMessage: message,
      memberId: member?.id ?? null,
      params: { planningId },
    });

    return result.streamText.toUIMessageStreamResponse({
      onFinish: async (event) => {
        await persistResponseMessage(threadId, event);
      },
    });
  },
};
```

### 4.3 Threading

`ChatThread` já suporta `agentName` discriminator. Vitoria usa `agentName: "vitoria"`, `channel: "planning"`. Adicionar coluna `planningId` ou usar `meetingId`/jsonb metadata? Olhar schema atual de `ChatThread` na hora de implementar — provavelmente metadata jsonb (`{ planningId }`) já basta.

---

## 5. UI — onde Vitoria aparece

### 5.1 No MVP, **só no command center da Planning**

Conforme [planning-ceremony-plan.md:254](../features/meetings/planning-ceremony-plan.md):
> Tela "command center da planning" (chat + ribbon próprios — **escrever do zero**)

Componente novo: `src/components/planning/vitoria-chat.tsx`. Reusa primitivas `Message`, `MessageList`, `ChatInput` que já existem em [`src/components/alpha-chat/`](../../src/components/alpha-chat/) — adapta com tema violet em vez do tema Alpha.

### 5.2 Onde **não** aparece

- Sidebar global (`/ops`) — exclusivo do Alpha
- Design session wizard — exclusivo do Vitor
- Listagem de cerimônias (`project-ceremonies-tab.tsx`) — só mostra item; chat é em rota nova `/projects/:id/planning/:planningId`

---

## 6. Variáveis de ambiente

```bash
# .env (novo)
ANTHROPIC_API_KEY=sk-ant-...   # sua key direta da Anthropic
```

Mantém `OPENROUTER_API_KEY` (Vitor + Alpha continuam usando).

**Confirmar antes:** sua subscription Claude Code permite uso programático via API key? Se for Claude Pro/Max **sem** API access incluído, vai precisar de uma key de developer/pay-as-you-go separada. Opus 4.7 é caro — defina budget mensal antes de subir.

---

## 7. Estrutura de arquivos final

```
src/
├── app/api/planning/[id]/chat/
│   └── route.ts                              ← novo
├── components/
│   ├── icons/
│   │   └── vitoria-icon.tsx                  ← novo (copy do VitorIcon)
│   └── planning/
│       └── vitoria-chat.tsx                  ← novo (UI)
├── lib/
│   ├── agent/
│   │   ├── agents/vitoria/
│   │   │   ├── index.ts                      ← novo (AgentDefinition)
│   │   │   ├── prompt.ts                     ← novo
│   │   │   ├── tools.ts                      ← novo
│   │   │   └── context.ts                    ← novo
│   │   └── connectors/
│   │       └── planning-chat.ts              ← novo
│   ├── ai/
│   │   └── provider.ts                       ← edit (adiciona prefixo anthropic-direct/)
│   └── agents/
│       └── vitoria-theme.ts                  ← novo (tokens violet)

docs/agents/
└── vitoria-pilot-plan.md                     ← este arquivo
```

---

## 8. Fases de implementação

### Fase 1 — Infra (1-2h)

1. Adicionar `@ai-sdk/anthropic` (verificar versão atual via Context7) ao `package.json`
2. Editar `src/lib/ai/provider.ts` — prefix routing
3. Editar `src/lib/agent/engine.ts` — cache key dinâmica
4. Editar `src/lib/agent/usage.ts` — fallback de providerMetadata
5. Adicionar `ANTHROPIC_API_KEY` no .env (e Vercel envs)

**Critério de aceite:** chamar `getModel("anthropic-direct/claude-opus-4-7")` num teste retorna stream válido.

### Fase 2 — Vitoria agent (2-3h)

1. `src/lib/agent/agents/vitoria/{index,prompt,tools,context}.ts`
2. `VitoriaIcon` + tema
3. Smoke script `scripts/vitoria-cli.ts` (cópia do `vitor-cli.ts`) — manda mensagem hardcoded, ve resposta

**Critério:** rodar `tsx scripts/vitoria-cli.ts --planning <id> --message "olá"` retorna texto streamado de Opus 4.7.

### Fase 3 — Endpoint + connector (2h)

1. `planning-chat.ts` connector
2. `/api/planning/[id]/chat` route (GET + POST)
3. RLS check (`requirePlanningAccessApi` — pode precisar criar se não existir)
4. Persistência em ChatThread/ChatMessage com `agentName: "vitoria"`

**Critério:** `curl -X POST /api/planning/.../chat` retorna SSE.

### Fase 4 — UI command center (4-6h)

1. `vitoria-chat.tsx` — adapta `alpha-chat/panel.tsx` com tema violet
2. Hook na tela do Planning command center (que está em construção — verificar branch da Planning Ceremony)
3. Indicador visual diferenciando Vitoria de Alpha (cor + ícone)

**Critério:** abrir Planning command center, ver chat com Vitoria, mandar mensagem, receber resposta streamada.

### Fase 5 — Tools de Planning (2-3 dias)

Implementar as 5 tools novas (`add_planning_note`, `list_planning_notes`, `propose_task_action`, `get_planning_state`, `read_transcript`). Cada uma é factory pattern padrão (igual `memory.ts`), insert/select em PlanningContextNote / MeetingTaskAction / PlanningTranscript.

**Critério:** rodar conversação real:
- PM linka 2 transcripts + 1 meeting
- Pede pra Vitoria "leia o contexto"
- Vitoria chama `read_transcript` x2, `add_planning_note` x3-5
- PM pede "propõe sprint"
- Vitoria chama `get_backlog`, `propose_task_action` x N
- PM aprova via UI (MeetingTaskActionSheet — já existe)

### Fase 6 — Audit (1-2 dias)

Adaptar o [`vitor-audit.md`](../vitor-audit.md) pra Vitoria — 10-15 cenários de planning:
- Briefing inicial sem transcripts → recusa
- Briefing com 1 transcript curto → propõe summary
- Briefing com 3 transcripts → propõe summary + 5 notes
- Reading→proposing com backlog vazio → reporta gap
- Proposing → propõe 6 actions baseadas em notes
- Adversarial: PM pede task fora do que está nos transcripts → recusa
- Adversarial: PM pede pra criar task **finalizada** (sem aprovação) → recusa

Roda baseline 1x, mede qualidade. Comparar com Alpha em mesmo escopo (se possível) pra ver se Opus 4.7 + Anthropic direto entrega valor real.

---

## 9. Riscos e mitigações

### 9.1 Risco — Anthropic SDK v2 cache control diferente

Não testei. `@ai-sdk/anthropic` aceita `providerOptions.anthropic.cacheControl`? Confirmar com Context7 antes de implementar Fase 1.

**Mitigação:** se não aceitar, MVP roda sem cache (mais caro, mas funcional). Otimização vem depois.

### 9.2 Risco — Custo Opus 4.7

Opus 4.7 é ~5x mais caro que Sonnet 4.6 em input tokens. Planning Ceremony tem contexto pesado (transcripts longos).

**Mitigação:**
- Cache deve cobrir o stable prefix do prompt (~80% do volume)
- Compactar transcripts grandes antes de injetar no contexto
- Monitor por `usage` log — alarme em $X/dia

### 9.3 Risco — Sua subscription Claude não permite API uso

Algumas subscriptions Claude Pro/Max **não** incluem API access — só Claude.ai/CLI.

**Mitigação:** confirmar antes de Fase 1. Se não permitir, usar key separada de developer (cobrança PAYG na sua conta).

### 9.4 Risco — Engine compartilhado

Mudança no engine afeta Vitor + Alpha + Vitoria. Bug ali quebra os três.

**Mitigação:**
- Mudança é cirúrgica (fallback de chave de cache, prefix routing)
- Testar Vitor + Alpha **antes** de fazer merge da Fase 1
- Feature flag opcional: `USE_ANTHROPIC_DIRECT=true` controla se vitoriaAgent realmente vai pelo Anthropic — em emergência, set false → cai pra OpenRouter sonnet 4.6

---

## 10. Out of scope (não fazer no piloto)

- **MCP** — Vitoria não consome MCP no MVP (Anthropic SDK suporta, mas escopo cresce demais)
- **Volund OS** — totalmente fora; este é independente
- **BYO OAuth per-user** — usa key da org. Multi-tenant fica pro futuro
- **Tools Vitor** (decisions, design memory) — Vitoria é planning, não design session
- **Migration Vitor → Vitoria** — Vitor mantém. Vitoria é agente novo, não substituto

---

## 11. Critério final de aceite

- [ ] Anthropic SDK direto funciona — chamada vai pra Anthropic, não OpenRouter
- [ ] Vitor + Alpha continuam intactos (sem regressão visível ou em uso/cost)
- [ ] Vitoria responde em Planning command center com tema violet
- [ ] Streaming SSE funciona end-to-end
- [ ] Persistência em ChatThread/ChatMessage com `agentName: "vitoria"`
- [ ] 5 tools de planning funcionam (add_note, propose_action, etc)
- [ ] Audit Vitoria atinge ≥ 70% de "correto" (baseline; meta evolui)
- [ ] Custo por sessão de planning <$2 (alvo inicial)

---

## 12. Próximo passo concreto

1. **Confirmar ANTHROPIC_API_KEY válida** com acesso a `claude-opus-4-7`. Curl rápido:
   ```bash
   curl https://api.anthropic.com/v1/messages \
     -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
     -H "content-type: application/json" \
     -d '{"model":"claude-opus-4-7","max_tokens":50,"messages":[{"role":"user","content":"ping"}]}'
   ```

2. **Context7 doc** do `@ai-sdk/anthropic` — versão atual + sintaxe de cache control v2.

3. **Confirmar branch da Planning Ceremony UI** — se o command center está em outra branch (não joao-dev), planejar merge.

Resolve esses 3 e a Fase 1 sai em 2h.
