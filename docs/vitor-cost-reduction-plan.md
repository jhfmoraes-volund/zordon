# Vitor — Plano de Redução de Custo (V2)

**Diagnóstico em:** 2026-05-08
**V2 em:** 2026-05-08 (revisão crítica + runbook)
**Caso real:** session `e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f` ("Inception Zelar")
**Custo observado:** **$89.03** em 112 turnos / 10 dias / 29M prompt tokens / **0** cache tokens

> **O que mudou da V1 → V2**
> - Ordem de PRs invertida: **F1 primeiro** (cache), não por último.
> - F1 reescrito: `system` precisa virar mensagem dentro de `messages` (string `system` não aceita `cacheControl`).
> - Adicionado **spike F0** (30min) antes de mexer no engine — valida shape do provider.
> - Cache de **tools** incluído (4º breakpoint).
> - Breakpoint deslocado do user atual pro **último turno completo do histórico**.
> - Pricing recalibrado: write Anthropic é **1.25x**, não ~1x — meta realista é 60–65% (não 70%).
> - Métrica corrigida: persistir `cache_creation_input_tokens` separado do `cache_read_input_tokens`.
> - F2: filtro de role no DB + nota sobre tool-call orphan.
> - F3: tratar `selectedSteps` customizado (brainstormIndex = -1).
> - **F4 removido**: tool de drafts já não está em `main` — `src/lib/agent/tools/drafts.ts` foi deletado, nenhum tool de draft registrado em `tools.ts`. DB tem 4 linhas com `_drafts: []` legadas (zero objetos pesados). Substituído por housekeeping SQL one-shot (seção 8).

---

## 1. Sumário executivo

Vitor está custando ~$0.79/turno no caso Zelar. Meta: **$0.05–0.10/turno** sem alterar comportamento percebido pelo PM.

| # | Causa raiz | Economia esperada (V2) | Esforço |
|---|---|---|---|
| 1 | Prompt cache do Anthropic não está ativo (cachedPromptTokens=0 em 100% dos turnos) | **~60–65%** ($89→$32) | M |
| 2 | Histórico do chat sem cap (256 msgs / 167k tokens reenviados a cada turno) | ~30% adicional sobre o sufixo não-cacheado | S |
| 3 | `brainstorm.solutions` (251 KB) renderizado full em verbosity≠execution | ~15% adicional | S |

Combinada (multiplicativa): **~80%** → ~$15/sessão equivalente em vez de $89.

> ~~F4 (sanitize `_drafts`) removido~~ — a tool de drafts não está mais em `main`. Ver seção 8 para o housekeeping SQL que limpa as 4 linhas zumbi no banco.

---

## 2. Diagnóstico — números reais

### Distribuição de prompt tokens por turno (session Zelar)

| Faixa | Turnos | % |
|---|---|---|
| 11k–50k | 7 | 6% |
| 50k–130k | 14 | 13% |
| 130k–250k | 36 | 32% |
| 250k–350k | 16 | 14% |
| 350k–460k | **39** | **35%** |

39 turnos acima de 350k tokens custaram **$54** (60% do total). 25 turnos no topo (>400k): **$31**.

### Composição estimada do prompt num turno típico (412k tokens)

| Bloco | Tokens estimados | Volátil? | Ação |
|---|---|---|---|
| System fixo (`stablePrefix` + behavior rules + schemas) | ~40k | Estável | F1 — breakpoint 1 |
| `sessionContext` — brainstorm + prioritization + personas | ~80k | Estável por step | F1 — breakpoint 2 |
| `projectMemorySection` + `memorySection` | ~5k | Quase estável | dentro do breakpoint 2 |
| `currentStepData` JSON cru (com `_notes`) | ~15k | Volátil | nunca cacheia |
| Tool defs (15 tools) | ~10k | Estável | F1 — breakpoint 3 |
| Histórico do chat (256 msgs, 668 KB) | ~167k | Cresce sem cap | F2 (cap) + F1 breakpoint 4 (no último turno completo) |
| Mensagem do usuário | ~1k | Volátil | nunca cacheia |

**Insight:** ~210k tokens (51%) já são estáveis — cacheáveis. Outros ~120k (29%) são histórico que deveria ter cap.

### Sinais de mau dimensionamento

- `brainstorm.solutions` JSON: **251.754 chars** (~63k tokens)
- `prioritization.items` JSON: **50.234 chars** (~12k tokens)
- 256 ChatMessages na thread (10 dias)
- `projectMemoryMd` vazio, transcripts vazios — peso é puramente step data + histórico
- 0 reasoning tokens — `:thinking` desligado (bom)

---

## 3. Plano de fixes — nova ordem

```
PR 0: F0 — Spike de cache control (30min, off-prod)
PR 1: F1 — Cache control via OpenRouter        — 3-4h, risk M, ganho ~60–65%
PR 2: F2 — Cap histórico                       — 1h,    risk M, ganho ~30% (sufixo não-cache)
PR 3: F3 — Verbosity compact-vision            — 1h,    risk B, ganho ~15%

Housekeeping (paralelo, qualquer momento):
  H1 — Cleanup _drafts zumbi no DB (1 query SQL, <1s)
```

Por que F1 primeiro: economia maior, e os outros fixes reduzem o sufixo **não-cacheável** — fazer F2/F3 antes não melhora o cache, só desinfla um sufixo que ainda paga 100%. F1 captura valor desde o turno 2 de qualquer sessão em rajada.

**Janela mínima entre PRs:** 24h em prod com tráfego real, pra colher métricas antes do próximo.

---

## F0 — Spike: validar cache control com OpenRouter (PRÉ-REQUISITO)

**Objetivo:** confirmar empiricamente que `providerOptions.openrouter.cacheControl` em `system` (via `messages` array) propaga corretamente para a Anthropic API e retorna `cache_creation_input_tokens` no `providerMetadata`.

**Por que:** o README do `@openrouter/ai-sdk-provider@2.8.0` ([node_modules/@openrouter/ai-sdk-provider/README.md:167-212](node_modules/@openrouter/ai-sdk-provider/README.md#L167-L212)) só mostra exemplo cacheando user message. Cache em system block é suportado pela Anthropic API mas não está documentado no provider — preciso provar que funciona antes de refatorar 1500 linhas.

**Arquivo:** criar `scripts/spike-cache.ts` (descartável após validação).

**Critério de sucesso:**
- 1ª chamada: `providerMetadata.openrouter.usage.cache_creation_input_tokens` > 0
- 2ª chamada (mesmo prefixo, dentro de 5min): `providerMetadata.openrouter.usage.cache_read_input_tokens` > 0
- Custo da 2ª chamada substancialmente menor que da 1ª

**Se falhar:** plano B — trocar `@openrouter/ai-sdk-provider` por `@ai-sdk/anthropic` direto na rota do Vitor (perde routing/fallback do OR mas ganha cache nativo). Documentar fallback no PR1.

**Runbook F0:**

```bash
# 1. criar o spike
cat > scripts/spike-cache.ts <<'EOF'
import { config } from "dotenv";
config();
import { streamText } from "ai";
import { getModel } from "@/lib/ai/provider";

const BIG_TEXT = "Lorem ipsum ".repeat(2000); // ~4k tokens estável

async function run(label: string) {
  const result = streamText({
    model: getModel("anthropic/claude-sonnet-4.6"),
    messages: [
      {
        role: "system",
        content: [
          {
            type: "text",
            text: `You are a helpful assistant.\n\n${BIG_TEXT}`,
            providerOptions: {
              openrouter: { cacheControl: { type: "ephemeral" } },
            },
          },
        ],
      },
      { role: "user", content: "Diga oi em portugues" },
    ],
  });
  // consumir o stream
  for await (const _ of result.textStream) { /* drain */ }
  const meta = await result.providerMetadata;
  const usage = await result.usage;
  console.log(`[${label}]`, {
    sdk_usage: usage,
    or_usage: (meta as any)?.openrouter?.usage,
  });
}

await run("call-1-write");
await new Promise((r) => setTimeout(r, 2000));
await run("call-2-read");
EOF

# 2. rodar
pnpm tsx scripts/spike-cache.ts
```

**Resultados esperados:**
- `call-1-write`: `cache_creation_input_tokens: ~4000`, `cache_read_input_tokens: 0`
- `call-2-read`: `cache_creation_input_tokens: 0`, `cache_read_input_tokens: ~4000`

**Se vier zero nos dois:** OpenRouter não propagou. Repetir com `extraBody.cache_control` direto. Se ainda falhar → plano B (provider Anthropic direto).

---

## F1 — Ativar prompt cache do Anthropic via OpenRouter

**Por quê:** Anthropic cobra **10%** dos cached tokens vs 100% dos não-cacheados. Cache TTL é 5min (suficiente — turnos do Vitor vêm em rajada). Write é **1.25x** durante a janela de criação.

**Restrição:** até **4 cache breakpoints** por request. Cacheia só o **prefixo contíguo** até o último breakpoint. Qualquer mudança antes do último breakpoint invalida tudo.

**Estratégia:** 4 breakpoints distribuídos em ordem do request:

1. **System part 1 (estável)** — `stablePrefix` puro: identidade + behavior rules + schemas + capacidades. Nunca muda dentro de uma sessão.
2. **System part 2 (estável-por-step)** — `sessionContext` + `projectMemorySection` + tool defs efetivamente cacheáveis ficam embutidos aqui.
3. **Tools array** — definições dos tools (~10k tokens, totalmente estáveis dentro da sessão).
4. **Último turno completo do histórico** — não a mensagem do user atual (essa é volátil), mas o último par `(user_N-1, assistant_N-1)`. Cacheia o histórico cumulativo até N-1, ganha hit a partir do turno N+1.

**Arquivos a tocar:**

| Arquivo | Mudança |
|---|---|
| [src/lib/agent/prompt.ts:855](src/lib/agent/prompt.ts#L855), [:1407](src/lib/agent/prompt.ts#L1407) | `buildSystemPrompt` retorna `{ stable: string, volatile: string }` em vez de string concatenada |
| [src/lib/agent/types.ts:57](src/lib/agent/types.ts#L57) | `buildPrompt` retorna `{ stable: string; volatile: string }` (breaking; ajustar Alpha também) |
| [src/lib/agent/agents/vitor/index.ts:150](src/lib/agent/agents/vitor/index.ts#L150) | Retorna shape novo |
| [src/lib/agent/agents/alpha/index.ts:34](src/lib/agent/agents/alpha/index.ts#L34) | Retorna shape novo (mesmo se Alpha não cachear ainda — manter contrato unificado) |
| [src/lib/agent/engine.ts:33-57](src/lib/agent/engine.ts#L33-L57) | Trocar `system: string` por `messages` com role=system + parts; aplicar cacheControl |

**Implementação — engine.ts (depois):**

```ts
import { streamText, stepCountIs, type ModelMessage } from "ai";
import { getModel, DEFAULT_MODEL } from "@/lib/ai/provider";
import { buildMessageHistory } from "./context";
import { recordAgentUsage } from "./usage";
import type { AgentRunRequest, AgentRunResult } from "./types";

const CACHE_OPT = {
  providerOptions: { openrouter: { cacheControl: { type: "ephemeral" as const } } },
};

export async function runAgent(req: AgentRunRequest): Promise<AgentRunResult> {
  const { agent, thread, capabilities, userMessage } = req;

  const [agentContext, messageHistory] = await Promise.all([
    agent.loadContext(req),
    buildMessageHistory(thread.id, { maxMessages: 40 }), // F2
  ]);

  const promptContext = { messageHistory, capabilities, agentContext };
  const [{ stable, volatile }, tools] = await Promise.all([
    agent.buildPrompt(promptContext),
    agent.buildTools(promptContext),
  ]);

  // CACHE BREAKPOINT 1: system stable (identity + behavior rules + schemas)
  // CACHE BREAKPOINT 2: system stable-per-step (sessionContext + memory)
  // Volatile (currentStepData, mode block) goes WITHOUT cacheControl.
  const systemMessage: ModelMessage = {
    role: "system",
    content: [
      { type: "text", text: stable, ...CACHE_OPT },
      { type: "text", text: volatile },
    ],
  };

  // CACHE BREAKPOINT 4: last completed turn (history cumulative up to N-1).
  // Apply cacheControl to the LAST element in `messageHistory` (which is the
  // assistant of turn N-1 if pairs are even, user of N-1 if odd — either way
  // it's the boundary that stays stable when turn N+1 arrives).
  const historyWithBreakpoint: ModelMessage[] = messageHistory.length
    ? messageHistory.map((m, i, arr) =>
        i === arr.length - 1
          ? { ...m, content: [{ type: "text" as const, text: m.content as string, ...CACHE_OPT }] }
          : m,
      )
    : [];

  const messages: ModelMessage[] = [
    systemMessage,
    ...historyWithBreakpoint,
    { role: "user", content: userMessage },
  ];

  const modelId = agent.model ?? DEFAULT_MODEL;

  // CACHE BREAKPOINT 3: tools array (Anthropic supports cache_control on tools).
  // The OpenRouter provider doesn't expose a direct hook for this in v2.8 —
  // verify in F0 spike whether tools propagate as cacheable by default. If
  // not, this breakpoint may need extraBody on the model factory.
  const result = streamText({
    model: getModel(modelId),
    messages,
    tools,
    stopWhen: stepCountIs(capabilities.maxSteps),
    onFinish: ({ usage, providerMetadata, response }) => {
      void recordAgentUsage({
        agentName: agent.name,
        threadId: thread.id,
        memberId: req.memberId ?? null,
        modelId,
        usage,
        providerMetadata,
        generationId: response?.id ?? null,
      });
    },
  });

  return { streamText: result };
}
```

**Implementação — prompt.ts (split):**

```ts
export function buildSystemPrompt(input: PromptInput): { stable: string; volatile: string } {
  // ... build sections as before ...
  const stable = `${stablePrefix}`; // identity + rules + schemas + capacidades + behavior
  const volatile = `${modeBlock}${projectMemorySection}${memorySection}

## Dados completos da sessao
${sessionContext || "Nenhum dado preenchido ainda."}

## Dados detalhados do step atual (${currentStepKey})
${JSON.stringify(currentStepData, null, 2)}`;
  return { stable, volatile };
}
```

> ⚠️ **NÃO mover sessionContext para `stable`.** Ele troca quando o step muda — colocá-lo no breakpoint 1 invalida o cache toda vez que o usuário avança de step. Mantenha apenas `stablePrefix` no breakpoint cacheável; sessionContext e tudo "estável-por-step" fica em `volatile`. (V1 propunha 2 breakpoints no system; V2 simplifica pra 1 só, porque o ganho de adicionar um breakpoint para sessionContext é pequeno e o risco de invalidação acidental é alto.)

**Comentário de proteção** — adicionar em prompt.ts logo antes do `stablePrefix`:

```ts
// CACHE BREAKPOINT — não edite o conteúdo do stablePrefix sem revisar impacto.
// Qualquer mudança aqui invalida o cache de TODAS as sessões em curso por 5min.
// Ver docs/vitor-cost-reduction-plan.md F1.
```

**Métrica de validação:**

```sql
SELECT
  AVG("cachedPromptTokens"::float / NULLIF("promptTokens", 0)) as cache_read_ratio,
  AVG((rawUsage->'openrouter'->>'cache_creation_input_tokens')::float
      / NULLIF("promptTokens", 0)) as cache_write_ratio,
  COUNT(*) FILTER (WHERE "cachedPromptTokens" > 0) as turns_with_read_hit,
  COUNT(*) as total_turns
FROM "AgentUsage"
WHERE "createdAt" > NOW() - INTERVAL '24 hours'
  AND "agentName" = 'vitor';
```

> Para `cache_creation_input_tokens` aparecer no `rawUsage`, o [usage.ts:42](src/lib/agent/usage.ts#L42) precisa expandir o pickup de `orMeta.usage`. Hoje só captura `cost/totalTokens/promptTokens/completionTokens`. **Adicionar como sub-task do F1**:
>
> ```ts
> type OpenRouterUsage = {
>   cost?: number; totalTokens?: number; promptTokens?: number; completionTokens?: number;
>   cache_creation_input_tokens?: number;
>   cache_read_input_tokens?: number;
> };
> ```

**Critério de sucesso (24h pós-deploy):**
- `cache_read_ratio` > 0.5 em sessões com ≥3 turnos em janela de 5min
- `cache_write_ratio` < 0.4 (writes só nos primeiros turnos da janela)
- Custo médio por turno < $0.30 (queda de ~60% sobre $0.79 baseline)

**Risco:** médio. Cache miss vira cache write na primeira chamada (custa **125%** do normal por 5min de TTL); a partir do 2º turno na mesma janela, paga 10%. Pior caso são turnos isolados ≥5min de gap (ficariam ~10–20% mais caros).

**Mitigação se F0 falhar:** trocar `@openrouter/ai-sdk-provider` por `@ai-sdk/anthropic` direto — o shape de cacheControl é nativo e documentado.

---

## F2 — Cap no histórico de mensagens

**Por quê:** [src/lib/agent/context.ts:64-81](src/lib/agent/context.ts#L64-L81) carrega TODAS as mensagens da thread sem `LIMIT`. 256 turnos = 668 KB = 167k tokens de histórico **não-cacheável** entre o último breakpoint e a user message atual.

**Arquivos a tocar:**
- [src/lib/agent/context.ts:64-81](src/lib/agent/context.ts#L64-L81) — `buildMessageHistory(threadId, opts?)`
- [src/lib/agent/engine.ts:24](src/lib/agent/engine.ts#L24) — passar `{ maxMessages: 40 }`

**Implementação v1 (cap por contagem):**

```ts
export async function buildMessageHistory(
  threadId: string,
  opts: { maxMessages?: number } = {},
): Promise<ModelMessage[]> {
  const limit = opts.maxMessages ?? 40;
  const { data } = await db()
    .from("ChatMessage")
    .select("*")
    .eq("threadId", threadId)
    .in("role", ["user", "assistant"])  // filtra no DB
    .order("createdAt", { ascending: false })
    .limit(limit);

  return (data ?? [])
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}
```

**Default sugerido:** 40 mensagens (~20 turnos = ~25k tokens no caso Zelar).

**Risco — tool-call orphan:** Anthropic exige pareamento `tool_use`/`tool_result`. Hoje [context.ts:75-80](src/lib/agent/context.ts#L75-L80) só emite `{ role, content }` em texto plano (sem `parts` reidratados), então não há risco de orphan no estado atual. **Documentar essa premissa no PR**: se um dia voltar a hidratar `parts` com tool calls, o cap precisa respeitar boundaries de turno (ex: não cortar entre assistant que chamou tool e user que viu tool_result).

**Risco — contexto perdido:** se o usuário referenciar algo de 50 turnos atrás, Vitor não vê. Mitigações:
- Info importante já vai pra `DesignDecision`/`DesignOpenQuestion` (sempre injetada via `agentContext`)
- `read_session_memory` tool resgata sob demanda
- v2: sumário rolling armazenado em `ChatThread.memorySummary` (só implementar se v1 mostrar gap real)

**Métrica:**

```sql
SELECT AVG("promptTokens") FROM "AgentUsage"
WHERE "createdAt" > NOW() - INTERVAL '24 hours' AND "agentName" = 'vitor';
```

**Critério de sucesso:** queda ≥30% no avg comparado à semana anterior ao PR (controlando por sessão — comparar mesma session se possível).

---

## F3 — Compactar `brainstorm.solutions` quando não é o foco

**Por quê:** [src/lib/task-generator.ts:140-148](src/lib/task-generator.ts#L140-L148) usa `renderCardFull` em verbosity `full`/`discovery`. No caso Zelar (step `hypotheses` em verbosity `full`), renderiza os 251 KB de solutions completos. Agente raramente precisa de `keyScreens`/`userFlows`/`technicalNotes` fora do briefing.

**Arquivos a tocar:**
- [src/lib/task-generator.ts:17-21](src/lib/task-generator.ts#L17-L21) — adicionar `"compact-vision"` ao tipo
- [src/lib/task-generator.ts:140-173](src/lib/task-generator.ts#L140-L173) — usar `renderCardCompact` no novo modo
- [src/lib/agent/agents/vitor/index.ts:20-37](src/lib/agent/agents/vitor/index.ts#L20-L37) — `pickVerbosity` mapeia steps pós-brainstorm

**Lógica nova de `pickVerbosity` (com guard pra selectedSteps custom):**

```ts
function pickVerbosity(
  currentStepKey: string,
  subPhase: string | undefined,
  selectedSteps: string[] | null,
): SessionContextVerbosity {
  if (currentStepKey === "briefing") return mapBriefingSubPhase(subPhase);
  if (currentStepKey === "brainstorm" || currentStepKey === "prioritization") return "full";

  // selectedSteps custom: brainstorm pode nem existir nessa sessão.
  const order = selectedSteps ?? DEFAULT_STEP_ORDER;
  const brainstormIndex = order.indexOf("brainstorm");
  if (brainstormIndex === -1) return "full";          // sessão sem brainstorm → comportamento atual

  const currentIndex = order.indexOf(currentStepKey);
  if (currentIndex > brainstormIndex) return "compact-vision";
  return "full";
}
```

**Risco baixo:** tools de leitura (`get_step_data`) continuam puxando o JSON cru sob demanda quando o agente realmente precisar.

**Métrica:** `LENGTH(sessionContext)` num log estruturado por step. Esperado: queda de ~250k chars pra ~30k em `hypotheses`/`technical_specs`/`risks_gaps` quando posteriores ao brainstorm.

---

## 4. Runbook executável (ordem cronológica)

### Dia 0 — Spike (F0, ~30min)

```bash
# branch
git checkout -b vitor-cost-spike

# criar e rodar o spike (script acima)
pnpm tsx scripts/spike-cache.ts

# checar output:
#   call-1-write deve mostrar cache_creation_input_tokens > 0
#   call-2-read deve mostrar cache_read_input_tokens > 0
```

**Decision gate:**
- ✅ Cache funciona via OpenRouter → seguir pra F1.
- ❌ Cache não propaga → adicionar branch `vitor-anthropic-direct`, instalar `@ai-sdk/anthropic`, refatorar `getModel` pra usar provider Anthropic só na rota do Vitor. Re-rodar spike.

### Dia 1 — F1 (cache, 3-4h)

```bash
git checkout -b vitor-f1-cache main

# 1. usage.ts: expandir tipo OpenRouterUsage
# 2. prompt.ts: split buildSystemPrompt -> { stable, volatile }
# 3. types.ts: atualizar AgentDefinition.buildPrompt
# 4. agents/vitor/index.ts + agents/alpha/index.ts: retornar shape novo
# 5. engine.ts: messages com role=system + parts + cacheControl

# typecheck
pnpm tsc --noEmit
pnpm next lint

# smoke local
pnpm dev
# abrir uma session, mandar 2-3 mensagens, ver no Network tab
# o body do request pra OpenRouter tem cache_control nos parts certos

# deploy via sync-main
bash scripts/sync-main.sh -m "ZRD-JM-50: agent — prompt cache via OpenRouter (F1)"

# 30min depois, rodar:
psql "$DIRECT_URL" -c "
SELECT
  COUNT(*) total,
  COUNT(*) FILTER (WHERE \"cachedPromptTokens\" > 0) hits,
  ROUND(AVG(\"cachedPromptTokens\"::float / NULLIF(\"promptTokens\", 0))::numeric, 2) ratio,
  ROUND(AVG(\"costUsd\")::numeric, 4) avg_cost
FROM \"AgentUsage\"
WHERE \"agentName\" = 'vitor' AND \"createdAt\" > NOW() - INTERVAL '30 minutes';"
```

**Decision gate (24h):**
- ✅ ratio > 0.4 e avg_cost < $0.40 → seguir pra F2.
- ❌ ratio = 0 → revert, abrir investigação. Provável causa: provider não propagou (volta pra plano B do F0).
- ⚠️ ratio entre 0.1-0.4 → investigar invalidação acidental antes de seguir.

### Dia 2 — F2 (cap histórico, 1h)

```bash
git checkout -b vitor-f2-cap main
# context.ts: buildMessageHistory(threadId, { maxMessages })
# engine.ts: passar { maxMessages: 40 }
pnpm tsc --noEmit
bash scripts/sync-main.sh -m "ZRD-JM-51: agent — cap historico em 40 msgs (F2)"

# 24h depois:
psql "$DIRECT_URL" -c "
SELECT date_trunc('day', \"createdAt\") d, ROUND(AVG(\"promptTokens\"))
FROM \"AgentUsage\" WHERE \"agentName\" = 'vitor'
  AND \"createdAt\" > NOW() - INTERVAL '7 days'
GROUP BY d ORDER BY d DESC;"
```

### Dia 3 — F3 (verbosity, 1h)

```bash
git checkout -b vitor-f3-verbosity main
# task-generator.ts: compact-vision mode
# agents/vitor/index.ts: pickVerbosity com selectedSteps guard
pnpm tsc --noEmit
bash scripts/sync-main.sh -m "ZRD-JM-52: agent — compact-vision verbosity (F3)"
```

### Housekeeping H1 (paralelo, 1min — pode rodar a qualquer momento)

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
psql "$DIRECT_URL" -c "
UPDATE \"DesignSessionStepData\"
SET data = data - '_drafts'
WHERE data ? '_drafts'
RETURNING \"sessionId\", \"stepKey\";"
```

Limpa as 4 linhas zumbi com `_drafts: []` (legado da tool removida).

### Dia 4 — Validação final

Rodar dashboard completo (seção 5). Se `avg_cost` ficou < $0.10 e `cache_read_ratio` > 0.5, declarar GA. Caso contrário, ler `rawUsage` em turnos caros e identificar fix #4.

---

## 5. Métricas a acompanhar

Dashboard diário (salvar como query no Supabase ou rodar via cron):

```sql
SELECT
  date_trunc('day', "createdAt") as day,
  COUNT(*) as turns,
  ROUND(AVG("promptTokens")) as avg_prompt,
  ROUND(AVG("cachedPromptTokens")) as avg_cache_read,
  ROUND(AVG((rawUsage->'openrouter'->>'cache_creation_input_tokens')::float)) as avg_cache_write,
  ROUND(AVG("cachedPromptTokens"::float / NULLIF("promptTokens", 0))::numeric, 2) as cache_read_ratio,
  ROUND(AVG("costUsd")::numeric, 4) as avg_cost,
  ROUND(SUM("costUsd")::numeric, 2) as day_cost
FROM "AgentUsage"
WHERE "agentName" = 'vitor'
  AND "createdAt" > NOW() - INTERVAL '14 days'
GROUP BY day
ORDER BY day DESC;
```

**Targets pós-F1+F2+F3:**

| Métrica | Baseline | Target |
|---|---|---|
| `avg_prompt` | ~260k | < 100k |
| `cache_read_ratio` | 0 | > 0.5 |
| `cache_write_ratio` | 0 | < 0.4 |
| `avg_cost` | $0.79 | < $0.10 |

---

## 6. Riscos transversais

- **Mudança de comportamento percebido:** F2 e F3 alteram o que o agente "vê". Mitigação: deploy com a sessão Zelar como canário, pedir feedback do PM em 24h.
- **Cache invalidation acidental:** qualquer linha mudada **antes** do último breakpoint invalida o cache do dia inteiro. F1 exige disciplina ao editar `prompt.ts` — comentário `// CACHE BREAKPOINT` adicionado pra sinalizar.
- **OpenRouter bug:** se `cache_creation_input_tokens` voltar não-zero mas `cache_read_input_tokens` ficar 0 nos turnos seguintes, é bug do provider. Plano B: trocar pra `@ai-sdk/anthropic` direto (perde routing/fallback).
- **Latência:** cache write adiciona ~200ms na 1ª chamada. Cache read economiza ~500ms. Net positive a partir do turno 2.
- **Breaking change no contrato `buildPrompt`:** Alpha precisa ser ajustado no mesmo PR (mesmo se não for cachear ainda) pra manter o tipo unificado.

---

## 7. Fora de escopo deste plano (anotar pra depois)

- **Reasoning/thinking tokens:** hoje 0 — quando ligar `claude-sonnet-4.6:thinking`, custo dobra ou triplica. Avaliar caso a caso (ex: só em `briefing`).
- **Modelo menor para sub-fases simples:** `claude-haiku-4.5` em `module_discovery`/`story_tree` poderia cortar custo 5x. Requer A/B de qualidade.
- **Sumário rolling (F2 v2):** comprimir mensagens cortadas em `ChatThread.memorySummary`. Só vale se F2 v1 mostrar gap real de contexto.
- **Tool result truncation:** results de `list_*` tools podem inflar contexto na próxima volta. Hoje não medido — instrumentar antes de mexer.
- **TTL de 1h:** Anthropic oferece cache de 1h custando 2x no write (vs 1.25x do 5min). Se sessões do Vitor ficarem ociosas 10-30min entre rajadas, vale testar — mas só depois de F1 estabilizado.
- **Cachear tool defs como breakpoint dedicado:** se F0 mostrar que o provider já cacheia tools sem opt-in explícito, não precisa. Se não, exige `extraBody` no model factory — fix #4 se necessário.

---

## 8. Housekeeping H1 — Cleanup `_drafts` zumbi no DB

**Por quê:** A tool de drafts (`apply_drafts`/`discard_drafts`/`review_draft`/`draft_step_items`) foi removida de `main` há alguns sprints — `src/lib/agent/tools/drafts.ts` não existe mais e `tools.ts` não registra nada do tipo. Mas 4 linhas em `DesignSessionStepData` ainda têm a chave `_drafts` por arrasto histórico (todas com array vazio `[]`, sem objetos).

**Estado atual (verificado 2026-05-08):**

```
rows_with_drafts_key: 4
rows_with_nonempty_drafts: 0
total_rows: 38
```

Custo no prompt hoje: ~12 chars por linha afetada (`"_drafts": [],`). **Ganho real ≈ zero** — a motivação é higiene, não economia. Por isso não é PR de código, é uma query.

**Pré-requisito de segurança:** confirmar via grep que a tool não voltou:

```bash
grep -RIn "tools/drafts\|apply_drafts\|discard_drafts\|review_draft\|draft_step_items" \
  /Users/joaomoraes/projetos-ai-dev/Perke/perke/volund/src 2>/dev/null
# esperado: zero output
```

**Comando:**

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
psql "$DIRECT_URL" -c "
UPDATE \"DesignSessionStepData\"
SET data = data - '_drafts'
WHERE data ? '_drafts'
RETURNING \"sessionId\", \"stepKey\";"
```

**Validação pós-execução:**

```sql
SELECT count(*) FROM "DesignSessionStepData" WHERE data ? '_drafts';
-- esperado: 0
```

**Risco:** zero. Estamos removendo chave inerte (array vazio); tool que escreveria `_drafts` não existe mais; nenhum código de produção lê `data._drafts`.

**Reversão:** se descobrir depois que algum branch reativo precisa, basta um `INSERT` re-criando `_drafts: []` nas linhas afetadas — mas o conteúdo era vazio então não há perda de dados.
