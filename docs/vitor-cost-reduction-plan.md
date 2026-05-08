# Vitor — Plano de Redução de Custo

**Diagnóstico em:** 2026-05-08
**Caso real:** session `e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f` ("Inception Zelar")
**Custo observado:** **$89.03** em 112 turnos / 10 dias / 29M prompt tokens / **0** cache tokens

---

## 1. Sumário executivo

Vitor está custando ~$0.79/turno no caso Zelar. A meta é **$0.05–0.10/turno** sem alterar comportamento percebido pelo PM.

Quatro causas, em ordem de impacto:

| # | Causa raiz | Economia esperada | Esforço |
|---|---|---|---|
| 1 | **Prompt cache do Anthropic não está ativo** (cachedPromptTokens=0 em 100% dos turnos) | **~70%** ($89→$27) | M |
| 2 | **Histórico do chat sem cap** — cada turno reenvia 256 mensagens / 167k tokens | ~30–40% adicional | S |
| 3 | **`brainstorm.solutions` (251 KB) renderizado full em verbosity≠execution** | ~15–25% adicional | S |
| 4 | **`currentStepData` JSON cru com `_drafts`/`_notes` antigos** dumpado no prompt | ~5–10% | S |

Economia combinada (multiplicativa, não somatória): **~92%** → ~$7/sessão equivalente em vez de $89.

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

Os 39 turnos acima de 350k tokens custaram **$54** (60% do total). Os 25 turnos no topo (>400k) sozinhos: **$31**.

### Composição estimada do prompt num turno típico (412k tokens)

| Bloco | Tokens estimados | Volátil? |
|---|---|---|
| System prompt fixo (`prompt.ts` stablePrefix + behavior rules + schemas) | ~40k | **Estável** (cacheable) |
| `sessionContext` — brainstorm + prioritization + personas + … | ~80k | **Estável por step** (cacheable) |
| `projectMemorySection` + `memorySection` (decisões/perguntas) | ~5k | Quase estável |
| `currentStepData` JSON cru (com `_notes`, `_drafts`) | ~15k | Volátil |
| **Histórico do chat (256 msgs, 668 KB)** | **~167k** | **Cresce sem cap** |
| Mensagem do usuário | ~1k | Volátil |
| Tool defs (15 tools) | ~10k | Estável |

**Insight:** ~210k tokens (51%) já são estáveis dentro de uma sessão e poderiam ser cacheados. Outros ~120k (29%) são histórico que deveria ter cap.

### Sinais de mau dimensionamento

- `brainstorm.solutions` JSON: **251.754 chars** (~63k tokens)
- `prioritization.items` JSON: **50.234 chars** (~12k tokens)
- 256 ChatMessages na thread (10 dias de uso real)
- `projectMemoryMd` vazio, transcripts vazios — então o peso é puramente step data + histórico
- 0 reasoning tokens — `:thinking` não está em uso (bom; senão seria pior ainda)

---

## 3. Plano de fixes

Os 4 fixes são independentes e podem ser shippados em PRs separados. **Recomendo a ordem F1 → F2 → F3 → F4** (F1 sozinho já justifica o trabalho).

### F1 — Ativar prompt cache do Anthropic via OpenRouter

**Por quê:** OpenRouter passa `cache_control: { type: "ephemeral" }` direto pra API do Anthropic quando recebe `providerOptions.openrouter.cacheControl` em `parts` de tipo `text`. Anthropic cobra **10%** dos cached tokens vs 100% dos tokens não-cacheados. Cache TTL é 5min (suficiente — turnos do Vitor vêm em rajada).

**Restrição da Anthropic:** até **4 cache breakpoints** por request. Ordem do prompt importa — só cacheia o **prefixo contíguo** até o último breakpoint.

**Estratégia:** dividir o system em 2 partes envoltas em parts cacheable, e marcar o último user message com cache control também.

**Arquivos a tocar:**
- [src/lib/agent/engine.ts](src/lib/agent/engine.ts) — montar `system` e `messages` com parts estruturadas
- [src/lib/agent/prompt.ts:1344-1407](src/lib/agent/prompt.ts) — `buildSystemPrompt` retorna `{ stable: string, volatile: string }` em vez de string concatenada

**Esboço da mudança (pseudo-código):**

```typescript
// engine.ts
const { stable, volatile } = await agent.buildPrompt(promptContext);

const result = streamText({
  model: getModel(modelId),
  // system aceita só string; usar messages com role=system + parts
  messages: [
    {
      role: "system",
      content: [
        { type: "text", text: stable,
          providerOptions: { openrouter: { cacheControl: { type: "ephemeral" } } } },
        { type: "text", text: volatile,
          providerOptions: { openrouter: { cacheControl: { type: "ephemeral" } } } },
      ],
    },
    ...messageHistory, // já como text strings — não cacheia, mas é incremental
    { role: "user", content: userMessage },
  ],
  tools,
  ...
});
```

Verificar se AI SDK v6 aceita `role: "system"` em `messages` array quando o prefixo cacheable precisa ser parts; senão, trocar `streamText({ system, ... })` por `streamText({ messages, ... })` com a primeira message sendo system.

**Métrica de validação:** depois do deploy, rodar query:

```sql
SELECT
  AVG("cachedPromptTokens"::float / NULLIF("promptTokens", 0)) as cache_ratio,
  COUNT(*) FILTER (WHERE "cachedPromptTokens" > 0) as turns_with_cache
FROM "AgentUsage"
WHERE "createdAt" > NOW() - INTERVAL '24 hours'
  AND "agentName" = 'vitor';
```

**Critério de sucesso:** `cache_ratio` > 0.5 dentro de 24h. Se ficar em 0, breakpoints estão mal posicionados ou OpenRouter não propagou — checar `providerMetadata.openrouter.usage.cache_creation_input_tokens` no log.

**Risco:** baixo. Cache miss vira cache write na primeira chamada (custa **125%** do normal por 5min de TTL); a partir do 2º turno na mesma janela, paga 10%. Pior caso são turnos isolados ≥5min de gap (que ficariam idênticos ao custo atual).

---

### F2 — Cap no histórico de mensagens

**Por quê:** [src/lib/agent/context.ts:64-81](src/lib/agent/context.ts) carrega TODAS as mensagens da thread sem `LIMIT`. Numa session com 256 turnos, cada novo turno reenvia os 668 KB de histórico (~167k tokens). E como o histórico fica ANTES do user message no array, ele entra **dentro** da janela cacheable só nas primeiras 5min após cada nova mensagem — depois disso, vira tudo prompt fresco de novo.

**Estratégia:** janela deslizante de N mensagens recentes + sumário comprimido das antigas (opcional na v1; cap simples já resolve).

**Arquivos a tocar:**
- [src/lib/agent/context.ts:64-81](src/lib/agent/context.ts) — `buildMessageHistory(threadId, { maxMessages?, maxTokens? })`
- [src/lib/agent/engine.ts](src/lib/agent/engine.ts) — passar opções

**Implementação v1 (cap por contagem):**

```typescript
export async function buildMessageHistory(
  threadId: string,
  opts: { maxMessages?: number } = {},
): Promise<ModelMessage[]> {
  const limit = opts.maxMessages ?? 40;
  const { data } = await db()
    .from("ChatMessage")
    .select("*")
    .eq("threadId", threadId)
    .order("createdAt", { ascending: false }) // pega últimas
    .limit(limit);

  return (data ?? [])
    .reverse() // restaura ordem cronológica
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));
}
```

**Default sugerido:** 40 mensagens (~20 turnos = ~25k tokens no caso Zelar).

**Implementação v2 (depois, se v1 deixar gap perceptível):** comprimir mensagens antigas em um sumário rolling armazenado em `ChatThread.memorySummary`. Só atualiza quando atinge cap; agente recebe sumário como primeira mensagem do array.

**Risco médio:** se o usuário referenciar algo de 50 turnos atrás ("lembra aquela persona que falamos no começo?"), Vitor não vê. Mitigação:
- Sumário rolling em v2 cobre isso
- A info importante já vai pra `DesignDecision`/`DesignOpenQuestion` (memória estruturada, sempre injetada)
- `read_session_memory` tool resgata sob demanda

**Métrica de validação:**

```sql
SELECT AVG("promptTokens") FROM "AgentUsage"
WHERE "createdAt" > NOW() - INTERVAL '24 hours' AND "agentName" = 'vitor';
```

**Critério de sucesso:** queda de ≥30% no avg comparado à semana anterior.

---

### F3 — Compactar `brainstorm.solutions` quando não é o foco

**Por quê:** [src/lib/task-generator.ts:140-148](src/lib/task-generator.ts) usa `renderCardFull` em verbosity `full` e `discovery`. No caso Zelar (step `hypotheses`), verbosity é `full` e renderiza os 251 KB de solutions completos. Mas o agente raramente precisa de `keyScreens`/`userFlows`/`technicalNotes` fora do briefing.

**Estratégia:** introduzir verbosity `"compact-vision"` para steps **depois** do brainstorm que não são briefing (technical_specs, hypotheses, risks_gaps quando vem depois). Renderiza só title + howItSolves + persona.

**Arquivos a tocar:**
- [src/lib/task-generator.ts:17-21](src/lib/task-generator.ts) — adicionar `"compact-vision"` ao tipo
- [src/lib/task-generator.ts:140-173](src/lib/task-generator.ts) — usar `renderCardCompact` no novo modo
- [src/lib/agent/agents/vitor/index.ts:20-37](src/lib/agent/agents/vitor/index.ts) — `pickVerbosity` mapeia steps `hypotheses`/`technical_specs`/`risks_gaps` (quando ≥ index do brainstorm) pra novo modo

**Lógica nova de `pickVerbosity`:**

```typescript
function pickVerbosity(currentStepKey, subPhase, stepIndex, brainstormIndex) {
  if (currentStepKey === "briefing") {
    // mantém comportamento atual baseado em subPhase
    return mapSubPhase(subPhase);
  }
  if (currentStepKey === "brainstorm" || currentStepKey === "prioritization") {
    return "full"; // está editando, precisa do detalhe
  }
  if (stepIndex > brainstormIndex) {
    return "compact-vision"; // já passou pelo brainstorm
  }
  return "full"; // antes do brainstorm — sem cards ainda
}
```

**Risco baixo:** tools de leitura (`get_step_data`) continuam puxando o JSON cru sob demanda quando o agente realmente precisar.

**Métrica:** `LENGTH(sessionContext)` num log estruturado por step. Esperado: queda de ~50k chars pra ~10k em `hypotheses`/`technical_specs`.

---

### F4 — Filtrar `_drafts` e `_notes` antigos no `currentStepData` injetado

**Por quê:** [src/lib/agent/prompt.ts:1404-1405](src/lib/agent/prompt.ts) faz `JSON.stringify(currentStepData, null, 2)` direto. Inclui `_drafts` (rascunhos abandonados de tools como `add_item`) e `_notes` antigos. No caso Zelar, `prioritization._drafts` é `object`, `brainstorm._drafts` também — pode ter acumulado rascunhos.

**Estratégia:** sanitizar o snapshot antes de injetar.

**Arquivos a tocar:**
- [src/lib/agent/context.ts:20-31](src/lib/agent/context.ts) — `getStepData` recebe `{ omit?: string[] }` ou expor `getStepDataForPrompt` que dropa `_drafts` e trunca `_notes` por idade.
- [src/lib/agent/agents/vitor/index.ts:61](src/lib/agent/agents/vitor/index.ts) — usar a versão filtrada quando vai pro prompt (a versão completa fica disponível pelas tools).

**Implementação:**

```typescript
export async function getStepDataForPrompt(sessionId, stepKey) {
  const raw = await getStepData(sessionId, stepKey);
  const { _drafts, ...rest } = raw;
  // _notes mantém — facilitator-facing, anchor de comportamento
  return rest;
}
```

**Risco:** zero. `_drafts` é estado intermediário do client; agente nunca deve ler.

**Métrica:** spot check num turno típico: tamanho do JSON injetado.

---

## 4. Ordem recomendada de execução

```
PR 1: F4 (filtra _drafts)            — 30min, risk 0, ganho ~5%
PR 2: F2 (cap histórico)             — 1h,    risk M, ganho ~30%
PR 3: F3 (compact-vision verbosity)  — 1h,    risk B, ganho ~15%
PR 4: F1 (cache control)             — 2-3h,  risk B, ganho ~70%
```

F1 fica por último porque depende de testar o caminho de `parts` no AI SDK v6 — quero que F2/F3/F4 já estejam em prod pra medir o efeito do cache de forma limpa (cache num prompt menor cacheia melhor).

**Janela mínima entre PRs:** 24h em prod com tráfego real, pra colher métricas antes do próximo.

---

## 5. Métricas a acompanhar

Adicionar dashboard interno (ou query salva) que rode diariamente:

```sql
SELECT
  date_trunc('day', "createdAt") as day,
  COUNT(*) as turns,
  ROUND(AVG("promptTokens")) as avg_prompt,
  ROUND(AVG("cachedPromptTokens")) as avg_cached,
  ROUND(AVG("cachedPromptTokens"::float / NULLIF("promptTokens", 0))::numeric, 2) as cache_ratio,
  ROUND(AVG("costUsd")::numeric, 4) as avg_cost,
  ROUND(SUM("costUsd")::numeric, 2) as day_cost
FROM "AgentUsage"
WHERE "agentName" = 'vitor'
  AND "createdAt" > NOW() - INTERVAL '14 days'
GROUP BY day
ORDER BY day DESC;
```

**Targets pós-F1+F2+F3+F4:**
- `avg_prompt` < 100k
- `cache_ratio` > 0.6
- `avg_cost` < $0.10

---

## 6. Riscos transversais

- **Mudança de comportamento percebido:** F2 e F3 alteram o que o agente "vê". Mitigação: rodar em paralelo com o caso Zelar real por alguns dias antes de declarar GA, pedir feedback do PM.
- **Cache invalidation acidental:** qualquer linha mudada **antes** de um breakpoint invalida o cache do dia inteiro. F1 exige disciplina ao editar `prompt.ts` — nunca tocar nas seções "estáveis" sem awareness do impacto. Considerar adicionar comentário `// CACHE BREAKPOINT — não edite acima sem revisar` no ponto do breakpoint.
- **OpenRouter bug:** se `cache_creation_input_tokens` voltar não-zero mas `cached_tokens` ficar 0 nos turnos seguintes, é bug do provider. Fallback: trocar `@openrouter/ai-sdk-provider` por `@ai-sdk/anthropic` direto (perde routing/fallback do OR mas ganha cache nativo garantido).

---

## 7. Fora de escopo deste plano (anotar pra depois)

- **Reasoning/thinking tokens:** hoje 0 — quando ligar `claude-sonnet-4.6:thinking`, custo dobra ou triplica. Avaliar caso a caso (ex: só em `briefing`).
- **Modelo menor para sub-fases simples:** `claude-haiku-4.5` em `module_discovery`/`story_tree` poderia cair custo 5x. Requer A/B de qualidade.
- **Compactar histórico via sumário rolling (F2 v2):** só vale a pena se F2 v1 mostrar gap real de contexto.
- **Tool result truncation:** results de `list_*` tools podem inflar contexto na próxima volta. Hoje não medido — instrumentar antes de mexer.
