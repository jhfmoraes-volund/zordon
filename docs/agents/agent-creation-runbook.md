# Building Agents — Runbook

> **Pra dev criando o próximo agente neste repo**, depois de Vitor (Design Sessions) e Alpha (Ops). Documento auto-contido, opinionado, com paths reais. Stack: Next.js 16 + Supabase + AI SDK v6 + Anthropic Claude.
>
> **Como usar:** leia 0 → 4 antes de criar pasta nenhuma. Use 5 → 10 como referência durante o build. Use 11 → 12 pra calibrar com o usuário real (PM/CRO/etc) via Claude Code. Use 13 → 15 pra checar qualidade antes de mergear.
>
> **Antes de desenhar tools, leia a doutrina:** [agent-construction-doctrine.md](../platform/agent-construction-doctrine.md) — o *porquê* (poucas tools afiadas que leem a realidade; disciplina no ACT, liberdade no SENSE) + o checklist que toda tool nova passa. Este runbook é o *como* mecânico; a doutrina é o *porquê* que mantém o agente esperto.

---

## 0. Pra quem é

Você é dev neste repo e vai criar um novo agente conversacional pra apoiar uma área (financeiro, comercial, RH, dev experience, etc). Já existem 2 agentes vivos como referência:

- **Vitor** — Design Sessions (discovery: scope, brainstorm, gaps, briefing, geração de tasks). Estado: maduro, calibrado.
- **Alpha** — Ops (sprints, tasks, alocações, reuniões). Estado: maduro, calibrado.

Pré-requisitos:
- Conhecimento de Next.js 16 (App Router, Route Handlers).
- Conhecimento de Supabase (queries, RPCs, RLS, migrations via psql).
- TypeScript intermediário.
- Conhecimento básico do AI SDK v6 da Vercel — esta runbook explica o que você precisa.

Se você nunca trabalhou com nenhum dos 3, pare e leia o código do Alpha primeiro: [src/lib/agent/agents/alpha/](../src/lib/agent/agents/alpha/).

---

## 1. Quando faz sentido criar um agente

Antes de criar agente, descarte alternativas mais baratas:

| Problema | Alternativa adequada |
|---|---|
| Lookup determinístico ("dado X, mostre Y") | Endpoint REST + query SQL |
| Análise estatística rotineira | Job + Materialized View |
| FAQ sobre docs estáticos | RAG simples (vector store + retrieval) |
| Workflow fixo com poucos passos | Server action ou job em fila |
| **Conversação iterativa onde o usuário refina o pedido** | **Agente** ✅ |
| **Múltiplas tools encadeadas com decisão entre elas** | **Agente** ✅ |
| **Síntese cross-fonte (DB + API externa + heurísticas)** | **Agente** ✅ |
| **Tarefa onde "PM aprova antes de aplicar" importa** | **Agente** ✅ (com pattern Propose-not-Execute) |

Sinais de que **não** é hora de criar agente: 1 input → 1 output, sem ramificação. Aí é tool, não agente.

---

## 2. Anatomia

Todo agente do repo segue este shape:

```
┌─────────────────────────────────────────────────────┐
│ Connector                                           │
│  ├─ HTTP (web)  : src/app/api/agents/<nome>/chat/   │
│  ├─ CLI         : scripts/<nome>-cli.ts             │
│  └─ Trigger/Cron: src/app/api/triggers/...          │
└─────────────────┬───────────────────────────────────┘
                  ▼
       runAgent(req) ◄── único entry point
       src/lib/agent/engine.ts
                  ▼
       ┌──────────┴──────────┐
       │  AgentDefinition    │  src/lib/agent/agents/<nome>/index.ts
       │   ├─ loadContext()  │  → src/lib/agent/agents/<nome>/context.ts
       │   ├─ buildPrompt()  │  → src/lib/agent/agents/<nome>/prompt.ts
       │   └─ buildTools()   │  → src/lib/agent/agents/<nome>/tools.ts
       └─────────────────────┘
                  ▼
            streamText (AI SDK)  ── system prompt + history + tools
                  ▼
       Persistência (ChatThread + ChatMessage com parts)
```

**Conceitos:**

- **Engine compartilhada** ([src/lib/agent/engine.ts](../src/lib/agent/engine.ts)): função `runAgent(req)` que recebe `agent`, `thread`, `capabilities`, `userMessage`, `memberId`, `params`. Constrói o `system prompt`, monta tools, chama `streamText`, retorna o stream sem consumir.
- **AgentDefinition** ([src/lib/agent/types.ts](../src/lib/agent/types.ts)): interface obrigatória com `name`, `loadContext`, `buildPrompt`, `buildTools`. Cada agente implementa.
- **Capabilities**: `{ maxSteps, readTools, writeTools, webSearch?, createTasks?, projectId?, composio?, roamToken? }`. Passadas pelo connector. Tools podem ser gateadas por flags daqui.
- **Connector**: quem consome o stream e devolve pro caller (HTTP via `toUIMessageStreamResponse`, CLI via loop manual em `fullStream`, trigger via collectText).
- **Persistência**: `ChatThread` (1 por sessão/member-agent/canal) + `ChatMessage` (1 por turno, com `parts` jsonb pra rebuild da UI).

---

## 3. AI SDK v6 — fundação técnica

Toda a fundação do agente é o **Vercel AI SDK v6** com provider Anthropic. Não tente reimplementar.

### APIs em uso real

| API | Onde | Pra que |
|---|---|---|
| `streamText({model, system, messages, tools, stopWhen, onFinish})` | [engine.ts](../src/lib/agent/engine.ts) | Núcleo: roda o LLM com tools |
| `tool({description, inputSchema, execute})` | tools.ts de cada agente | Define cada tool callable |
| `stepCountIs(n)` | engine.ts | Limita quantos turnos de tool-calling (`stopWhen`) |
| `result.toUIMessageStreamResponse({onFinish})` | rota HTTP | Stream pro browser + persiste no `onFinish` |
| `result.streamText.fullStream` | CLI | Itera chunks brutos: `text-delta`, `tool-call`, `tool-result`, `finish`, `error` |
| `ModelMessage` / `UIMessage` | context.ts (history) / persistência | Formatos diferentes — model é simples role+content; UI tem parts ricas |

### Provider Anthropic

[src/lib/ai/provider.ts](../src/lib/ai/provider.ts):

```ts
import { anthropic } from "@ai-sdk/anthropic";
export const DEFAULT_MODEL = "claude-sonnet-4-6"; // ou opus
export function getModel(id) { return anthropic(id); }
```

Modelos atuais: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`. Default Sonnet — bom custo/qualidade pra agentes.

### O contrato real do `streamText`

Você **nunca** faz `await streamText(...)` esperando o texto. Sempre retorna **imediatamente** um handle com:
- `.textStream` — async iter de string deltas
- `.fullStream` — async iter de eventos brutos (incluindo tool calls)
- `.usage`, `.providerMetadata`, `.response` — disponíveis no callback `onFinish`
- `.toUIMessageStreamResponse(opts)` — converte pra HTTP stream consumível pelo client React

Quem decide quando consumir é o **connector**. O engine retorna o handle pro connector usar como quiser.

### Tools são fechadas em closure no momento da montagem

Cada `tool({ execute })` recebe a closure do escopo de `assembleAlphaTools(capabilities, opts)`. Por isso `roamToken` (vindo de `capabilities`) entra na função de execute via lexical scope, **nunca como argumento da tool** — o LLM não vê tokens.

```ts
export function assembleAlphaTools(capabilities, opts) {
  const roamToken = capabilities.roamToken;  // ← closure
  const tools = {};

  tools.get_meeting_transcript = tool({
    inputSchema: z.object({ transcriptId: z.string() }),
    execute: async ({ transcriptId }) => {
      const roam = new RoamClient(roamToken);  // ← usa closure, não argumento
      return await roam.getTranscript(transcriptId);
    },
  });

  return tools;
}
```

### Step counting

`stopWhen: stepCountIs(N)` limita quantas rodadas de tool-calling. Cada rodada = LLM produz tool calls → executa → LLM vê resultados → produz mais tool calls **ou** texto final. Ultrapassar = stream termina abruptamente sem texto. Defaults atuais: Vitor 30, Alpha 60.

Subir `maxSteps` é o fix pra "agente parou no meio de batch operation". Mas antes de subir, considere se o batch deveria virar **drafts** (uma tool insere N items, outra tool aplica todos) — economiza steps drasticamente.

### Persistência: `parts` é a fonte de verdade da UI

Quando você usa `toUIMessageStreamResponse({ onFinish })`, recebe a `responseMessage: UIMessage` completa com array de `parts` (`text`, `tool-call`, `tool-result`, `reasoning`). Salva o array inteiro em `ChatMessage.parts` (jsonb) pra que a UI possa rebuildar os "chips" de tool em reload. **Não jogue fora.**

```ts
// src/lib/agent/context.ts
export function persistResponseMessage(threadId) {
  return async ({ responseMessage }) => {
    const text = responseMessage.parts
      .filter(p => p.type === "text").map(p => p.text).join("\n");
    await persistAssistantMessage(threadId, text, responseMessage.parts);
  };
}
```

---

## 4. Template inicial — criar agente "Foo"

Vamos do zero. Substitua `Foo` pelo nome real (`Beta`, `Sage`, etc).

### Passo 1: pasta e `index.ts`

```bash
mkdir -p src/lib/agent/agents/foo
```

`src/lib/agent/agents/foo/index.ts`:
```ts
import { buildFooPrompt } from "./prompt";
import { assembleFooTools } from "./tools";
import { buildFooContext } from "./context";
import type { AgentDefinition, AgentRunRequest } from "../../types";

export const fooAgent: AgentDefinition = {
  name: "foo",

  async loadContext(req: AgentRunRequest) {
    return await buildFooContext({ /* extrair de req.params */ });
  },

  buildPrompt(ctx) {
    return buildFooPrompt(ctx);
  },

  async buildTools({ capabilities, agentContext }) {
    return assembleFooTools(capabilities, { /* pinned do contexto */ });
  },
};
```

### Passo 2: `prompt.ts` mínimo

```ts
import type { PromptContext } from "../../types";

export function buildFooPrompt({ agentContext }: PromptContext): string {
  const ctx = (agentContext.fooContext as string) || "Sem contexto.";
  return `Você é Foo, o assistente de <área> do Volund.

## Hoje
${agentContext.todayBlock /* injetado pelo loader */}

## Contexto atual
${ctx}

## Como agir
- Responda em pt-BR.
- Seja direto.
- Use as tools quando precisar de dado fresh.

## Suas ferramentas
${/* preencher conforme tools.ts */ ""}
`;
}
```

### Passo 3: `tools.ts` com 1 read + 1 write

```ts
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Capabilities } from "../../types";

export function assembleFooTools(capabilities: Capabilities, opts: {} = {}): ToolSet {
  const supabase = db();
  const tools: ToolSet = {};

  tools.get_something = tool({
    description: "Lê algo do banco. Use pra responder perguntas factuais.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data } = await supabase.from("Something").select("*").limit(10);
      return { items: data ?? [] };
    },
  });

  if (capabilities.writeTools) {
    tools.do_something = tool({
      description: "Faz uma ação. Use SEMPRE Regra 0: proponha em texto e peça confirmação antes de chamar.",
      inputSchema: z.object({
        target: z.string().describe("O que afetar"),
      }),
      execute: async ({ target }) => {
        // ...
        return { done: true, target };
      },
    });
  }

  return tools;
}
```

### Passo 4: `context.ts`

```ts
import { db } from "@/lib/db";

export async function buildFooContext(opts: {}): Promise<Record<string, unknown>> {
  // 1. Bloco hoje (sempre)
  const todayBlock = renderToday();

  // 2. Dados específicos
  // const { data } = await db().from("...").select("...");

  // 3. Compor texto único do contexto operacional
  const fooContext = [todayBlock, /* outros blocos */].filter(Boolean).join("\n\n");

  return { fooContext, todayBlock };
}

function renderToday(): string {
  const now = new Date();
  const iso = now.toISOString().split("T")[0];
  const weekday = now.toLocaleDateString("pt-BR", {
    weekday: "long", timeZone: "America/Sao_Paulo",
  });
  return `## Hoje\nData atual: **${iso}** (${weekday}).`;
}
```

### Passo 5: rota HTTP

`src/app/api/agents/foo/chat/route.ts` — copie de [api/agents/alpha/chat/route.ts](../src/app/api/agents/alpha/chat/route.ts) e troque:
- `alphaAgent` → `fooAgent`
- `agentName: "alpha"` → `agentName: "foo"`
- `ALPHA_CAPABILITIES` → `FOO_CAPABILITIES`
- `parseRoute(...)` se aplicável
- `params: { meetingId, route }` → params específicos do Foo

### Passo 6: CLI

`scripts/foo-cli.ts` — copie de [scripts/alpha-cli.ts](../scripts/alpha-cli.ts) e troque o agente importado + nome em `ensureAgentThread("foo", ...)` + params.

### Smoke test

```bash
npx tsx --require ./scripts/_server-only-shim.cjs scripts/foo-cli.ts \
  --member-id <seu-id> --new-thread \
  --message "olá, quem é você?"
```

Se imprimir resposta + zero tool calls + persistir thread, está vivo.

A partir daqui o trabalho é **iterar**: adicionar uma tool, escrever um cenário no CLI, observar o que falha, ajustar prompt/tool, re-rodar. Veja seção 12.

---

## 5. Prompt — estrutura + 7 princípios

### Hierarquia de blocos

Ordem importa pra o LLM. Use sempre:

1. **Identidade** (uma frase: "Você é Foo, o assistente de…")
2. **Contexto operacional** (`${ctx.fooContext}`) — gerado pelo loader
3. **Awareness** (rota, foco, sessão ativa)
4. **Vocabulário rígido** (conceitos colidentes — ver P2 abaixo)
5. **Suas ferramentas** (lista enxuta + descrição funcional)
6. **Como agir** (fluxos típicos: passos numerados)
7. **Regras** (curtas, em bullets, na cauda)

### Os 7 princípios (extraídos da calibragem)

#### P1 — Bloco "Hoje" obrigatório

Sem isso, o modelo chuta o ano errado em datas relativas ("essa quinta", "30/06"). Injete no contexto:

```
## Hoje
Data atual: **2026-04-29** — quarta-feira, 29 de abril de 2026.
Use sempre essa data como âncora pra interpretar referências relativas.
Nunca chute o ano por inferência.
```

#### P2 — Vocabulário rígido pra conceitos colidentes

Quando dois conceitos parecem sinônimos pro LLM mas têm semânticas diferentes (ex: ata Zordon vs transcrição Roam, Task vs Todo), defina explicitamente e dê regras duras:

```markdown
## Vocabulário básico — Task ≠ Todo

- Task: unidade de trabalho de produto que custa FP. Tem reference, sprint, lifecycle.
- Todo: ação operacional / lembrete. Sem FP, status binário.

Heurística: "vai sair como código?" → Task. "alguém precisa lembrar de fazer?" → Todo.
Em dúvida → pergunte.
```

#### P3 — Regra 0: propor antes de aplicar

Pra qualquer operação de escrita não-trivial, o agente **propõe em texto**, **pede confirmação**, **só então chama tool**. Vale especialmente pra batches multi-tool.

```markdown
## Regra 0 — Contrato de escrita
1. Confirme escopo (qual entidade, qual operação).
2. Proponha em texto os params concretos.
3. Pergunte: "Posso aplicar?"
4. Só execute APÓS confirmação.
5. Após aplicar, PARE. Resuma. Pergunte se segue.

Tools de escrita = qualquer tool que altere estado. Lista: <enumerar>.
Tools de leitura são livres.
```

#### P4 — Citação numérica baseada em tool result

Antes de afirmar valor numérico (capacidade, FP, datas), o agente **deve** ter chamado a tool relevante neste turno ou ter o número no contexto. Senão, marca como estimativa.

#### P5 — Output volumoso → resumo + filtro, não dump

Lista de 10+ items densos? Sumário curto + 3-5 mais relevantes + oferta de filtros. Nunca despeje markdown >10k chars.

#### P6 — Awareness de rota/contexto

Se o agente sabe **onde** o usuário está (rota, entidade focada), tools de leitura sem ID explícito devem **filtrar pelo escopo**. Ver `parseRoute` em [alpha/route-context.ts](../src/lib/agent/agents/alpha/route-context.ts).

#### P7 — Tipos com fluxos diferentes (dispatcher)

Quando uma entidade tem `type` (ex: `Meeting.type`), regra dura no prompt: "se type=X, faça A; se type=Y, faça B; tools <lista> são banidas em type=Z". Espelhe a regra no contexto (`buildMeetingBlock` por type) — ver [alpha/context.ts:buildMeetingBlock](../src/lib/agent/agents/alpha/context.ts).

---

## 6. Tools — design

### Read vs Write

- **Read**: sem confirmação, sem `capabilities.writeTools` gate. Sempre disponíveis.
- **Write**: dentro do `if (capabilities.writeTools)`. Sujeitas à Regra 0.

### Schema com Zod — descreva, não só tipe

`.describe(...)` em **todo** campo. O LLM lê isso pra decidir como preencher.

```ts
inputSchema: z.object({
  taskReference: z.string().describe("Referência da task (ex: TASK-042)"),
  newPriority: z.number().int().min(0).max(10)
    .describe("Nova prioridade (0=baixa, 10=crítica)"),
}),
```

### Resolução por nome, não ID

LLMs são ruins com UUIDs e ótimos com nomes. Suas tools devem aceitar `projectName`, `memberName`, `sprintName`, `taskReference` e resolver internamente:

```ts
const { data: project } = await supabase
  .from("Project")
  .select("id, name")
  .ilike("name", `%${projectName}%`)
  .limit(1)
  .maybeSingle();
if (!project) return { error: `Projeto "${projectName}" não encontrado.` };
```

Excessão: tools que listam pedem ID quando vão alterar item específico (ex: `discard_meeting_action({ actionId })`).

### Retorno: enxuto pra reads, rico pra ações

- **Read tool de listagem**: retorne só o necessário (`{count, items: [{id, label}]}`). Tudo que vai pro LLM pesa em tokens.
- **Action tool**: retorne **antes/depois** + warnings: `{updated: true, from: {...}, to: {...}, warning?: "..."}` — Alpha usa pra explicar ao usuário sem outra tool call.
- **Errors**: retorne `{ error: "..." }` em vez de throw. O LLM lê e pode se recuperar.

### Tool de proposta vs execução (Propose-not-Execute)

Quando a operação afeta dados e precisa de aprovação humana, separe em **2 tools** + uma tabela de staging:

- `propose_X({...})` → INSERT em `XAction(decision=pending)`. Não muda estado de produção.
- `apply_X_actions({...})` → executa pendentes em batch (esta pode nem ser exposta ao agente; pode ficar só na UI).

Ver pattern em [tools.ts:propose_task_action](../src/lib/agent/agents/alpha/tools.ts) + tabela `MeetingTaskAction`. Permite "Alpha sugere → PM aprova → sistema aplica".

### Validação de consistência

Combinações inválidas devem retornar erro claro:

```ts
if (type === "create" && taskReference) {
  return { error: "type=create não aceita taskReference (task ainda não existe)." };
}
if (type === "move" && !targetSprintName) {
  return { error: "type=move exige targetSprintName." };
}
```

### Drafts pra batch ops

Quando o agente vai fazer 5+ writes encadeados, use o pattern drafts:

1. `draft_X({ items: [...] })` — persiste em tabela `XDraft` (jsonb), retorna `{ids, labels}` enxutos.
2. Agente apresenta sumário no chat.
3. Usuário confirma.
4. `apply_X_drafts({ ids? })` — aplica em transação. Se falhar no meio, **não aplique parcial**.

Reduz tool calls de N (uma por write) pra 2 (draft + apply). Economiza tokens, mantém atomicidade. Ver [src/lib/agent/tools/step-drafts.ts](../src/lib/agent/tools/step-drafts.ts) (Vitor).

---

## 7. Context loader — o que injetar

O contexto é o que o agente vê **a cada turno**, montado por `loadContext` em runtime. Cabeça de orçamento: ~10k chars de contexto é razoável; 20k+ começa a doer.

### Sempre injete

- Bloco `## Hoje` (P1 acima).
- Baseline de saúde (capacity, alertas top-N, números importantes).
- Índice de heurísticas (`name + description`, sem corpo — corpo carrega via tool sob demanda).

### Injete condicional ao foco

- Se `route.kind === "project"`, bloco `## Foco: Projeto X` rico + esconde global.
- Se `route.kind === "meeting"`, bloco específico **por type da meeting** (ver dispatcher em [context.ts:buildMeetingBlock](../src/lib/agent/agents/alpha/context.ts)).
- Sem foco: render global resumido.

### Renderers separados por entidade

Não enfia tudo num `buildContext` monolítico. Tenha funções `renderProjectFocus`, `renderSprintFocus`, `renderMeetingBlock`, `renderToday`, etc. Cada uma retorna string, e `buildContext` junta.

### Limite de tamanho

Truncar campos de texto livre (notas, transcrições) em ~2500 chars, com aviso `…[truncado, X chars]`. O agente pode pedir mais via tool se precisar.

### Anti-pattern: dump de tabelas inteiras

Não jogue 200 tasks no contexto. Top-N por prioridade + "e mais Y no backlog — use get_backlog pra ver". O agente pula pra tool quando precisa.

---

## 8. Heurísticas (playbooks)

Quando uma regra de negócio é longa (>20 linhas), opinionada (esquemas, fluxos numerados), e não se aplica em **todo** turno — vira **heurística** carregável sob demanda.

### Estrutura

- Tabela `AgentHeuristic` com `id`, `agentId`, `name` (slug), `title`, `description`, `body` (markdown), `category`, `active`.
- Loader: `loadAgentHeuristic(agentId, name)` retorna o body.
- Tool exposta: `load_heuristic({ name })`.
- No contexto: índice (`name + description`) sem corpo.

### Quando virar playbook

| Conteúdo | Onde mora |
|---|---|
| Regra curta universal ("sempre cite tool") | prompt principal |
| Vocabulário rígido | prompt principal |
| Fluxo opinionado de 5+ passos pra cenário específico | heurística |
| Framework analítico (sprint composição, redistribuição de carga) | heurística |
| Checklist longa de qualidade | heurística |

Ver as heurísticas do Alpha: `replanejamento-reuniao`, `sprint-composicao`, `redistribuicao-sobrecarga`, `criacao-tasks-qualidade`, `quando-pedir-confirmacao`.

### Como Alpha decide carregar

No prompt, sob "Como agir", lista `name + when`:

```
- Vai compor sprint? → carregue sprint-composicao.
- Recebeu transcrição? → carregue replanejamento-reuniao.
```

O LLM lê o índice (no contexto) + esses gatilhos (no prompt) e decide.

---

## 9. Memory & Compacting

### O que é "memory" aqui

**ChatMessage por thread**, com `parts` jsonb por mensagem. Cada turno do agente persiste:
- `role: "user" | "assistant"`
- `content: string` (texto plano pra rebuild de prompt)
- `parts: UIMessage[]` (pra rebuild da UI com tool chips)

A "memória" do agente entre turnos é **o histórico inteiro da thread** — `buildMessageHistory(threadId)` em [context.ts](../src/lib/agent/context.ts) carrega tudo e passa pro `streamText` como `messages`.

### Persistir no `onFinish`

Pattern:

```ts
result.toUIMessageStreamResponse({
  onFinish: persistResponseMessage(threadId),  // joga texto + parts no DB
});
```

[persistResponseMessage](../src/lib/agent/context.ts) faz join de partes de texto e salva o array completo em `parts`.

### Per-member threads (privacidade)

Pra agentes standalone (Alpha) que não têm `sessionId`, use `ensureAgentThread(agentName, channel, memberId)`. ChatThread tem `createdBy = memberId`. GET valida `eq("createdBy", member.id)` — usuário A não vê thread do B.

### Compacting — quando histórico cresce demais

**Hoje no Volund:** não há compacting automático. Cada turno carrega o histórico inteiro. A 50+ mensagens isso vira problema (tokens, latência).

**Estratégias quando precisar:**

1. **Drafts pattern** (já usado): em vez de 20 tool calls separadas (cada uma fica no histórico), 1 draft + 1 apply. Reduz drasticamente.
2. **Resumo periódico**: a cada N turnos, gerar um summary do que aconteceu e usar como `system` adicional, descartando turnos antigos. **Não implementado ainda** — pode virar feature do engine.
3. **Truncamento por janela**: passar só os últimos K turnos pra `streamText`. Perde histórico distante. Funciona pra fluxos curtos.
4. **Reset com sumário**: ao trocar de fluxo (ex: PM mudou de tema completamente), criar nova thread e copiar contexto crítico como nota.

Quando você adicionar compacting ao engine, reuse `buildMessageHistory` mas insira lógica de truncamento/sumário antes de retornar.

### Anti-pattern: salvar conteúdo da tool no `content`

`content` é só texto plano (pra rebuild de prompt). Tool calls e results vão em `parts`. Não duplique.

---

## 10. Capabilities + Security

### Capability gating

```ts
interface Capabilities {
  maxSteps: number;       // stop condition do streamText
  readTools: boolean;     // se false, esconde reads (raro)
  writeTools: boolean;    // se false, esconde writes
  webSearch?: boolean;    // se true, expõe tool de busca web
  createTasks?: boolean;  // permissões específicas
  projectId?: string;     // pinned scope
  composio?: { userId; toolkits[] };  // tools dinâmicas externas
  roamToken?: string;     // per-user, vault
}
```

Use `if (capabilities.writeTools) { tools.do_X = ... }` pra montar tools condicionalmente. Combinado com Regra 0 no prompt, dá segurança em camadas.

### Per-user tokens via Vault

Pra integrações externas com auth per-user (Roam, GitHub, etc):

1. Migration cria tabela `MemberIntegration(memberId, provider, secretId, tokenHint)` com RLS + REVOKE pra anon/authenticated. Só `service_role` acessa.
2. RPCs `set_member_integration`, `get_member_integration_secret`, `delete_member_integration` com `SECURITY DEFINER` + GRANT só pra service_role.
3. Token vive em `vault.secrets` (encrypted at rest). Tabela só guarda `vault.secrets.id`.
4. Em runtime: `getMemberIntegrationToken(member.id, "roam")` é chamado **server-side** com `member.id` da DAL.

Ver [supabase/migrations/20260423_add_member_integrations.sql](../supabase/migrations/20260423_add_member_integrations.sql) e [src/lib/member-integrations.ts](../src/lib/member-integrations.ts).

### `getCurrentMember` é o gate único de identidade

**Regra invariante:** `memberId` que vai pra qualquer tool sensitive **vem da DAL**, nunca do request body.

```ts
// route.ts
const member = await getCurrentMember();  // ← do session cookie
if (!member) return new Response("Forbidden", { status: 403 });
const roamToken = await getMemberIntegrationToken(member.id, "roam");  // ← member.id da DAL
const capabilities = { ...defaults, roamToken };
```

Não confie em `body.memberId`. Não passe pro LLM.

### Token em closure, nunca em payload

Tools que usam token: closure capture, não tool input. Já mostrado em §3.

### CLI bypassa auth

`scripts/<agente>-cli.ts` aceita `--member-id` arbitrário. Roda com `.env` (que tem service_role). **Dev only.** Mitigações:
- `.env` em `.gitignore` (já está).
- Não compartilhe `.env` em canais não-criptografados.
- Se um dev sair, rotacione `DIRECT_URL` e re-encripte vault.

---

## 11. CLI de calibragem

O CLI é fundamental: permite calibrar fora do navegador, com logs visíveis, threads isoláveis, sem auth ping-pong.

### Estrutura básica

```
scripts/
  _server-only-shim.cjs    # bypassa "server-only" pra rodar via tsx
  _server-only-noop.cjs
  <agente>-cli.ts          # 1 arquivo por agente
```

`_server-only-shim.cjs` já existe no repo. Não duplique — referencie via `--require`.

### Template do `<agente>-cli.ts`

Use [scripts/alpha-cli.ts](../scripts/alpha-cli.ts) como base. Estrutura:

```ts
async function main() {
  const args = parseArgs(process.argv.slice(2));
  // 1. Validar member existe
  // 2. Resolver thread (--new-thread / --thread-id / latest)
  // 3. Parse params específicos do agente (route, sessionId, etc)
  // 4. Header colorido
  // 5. Persistir user message
  // 6. Montar capabilities
  // 7. runAgent() → result.streamText
  // 8. Consumir fullStream com switch (text-delta / tool-call / tool-result / finish / error)
  // 9. persistAssistantMessage com text + parts
  // 10. Resumo: text length, tool calls, tool list
}
```

Args padrão recomendados:
- `--member-id` (required, sem auth) — pegar via `psql -c 'SELECT id, name FROM "Member"'`
- `--message` ou `--message-file` (pra payload grande)
- `--new-thread` (flag — cria nova) ou `--thread-id <id>` (continua existente)
- `--max-steps N` (override pro debug)
- Args específicos do agente (`--session`, `--meeting-id`, `--current-path`, etc)

### Run

```bash
npx tsx --require ./scripts/_server-only-shim.cjs scripts/foo-cli.ts \
  --member-id <uuid> --new-thread \
  --message "olá"
```

### O que o CLI imprime

- Cabeçalho amarelo: member, thread, route, params
- `▸ tool-call <name>` magenta + input truncado
- `→ <name> result` verde + output truncado
- texto do assistant em tempo real (text-delta)
- erro/finish em cores
- Resumo final: text length, tool calls com ✓ ou ·

Truncar output em ~1500 chars por chunk. Histórico inteiro fica em `ChatMessage` no DB; CLI só serve pra você ver o que rolou.

---

## 12. Loop de calibragem com Claude Code

Esta é a parte central. Você (dev) está no terminal com Claude Code aberto. O agente que você está construindo está rodando via CLI numa thread isolada. Você itera entre os dois.

### Por que CLI + Claude Code

- **CLI** = você roda turnos do agente real contra DB real, com logs verbosos.
- **Claude Code** = você descreve em pt-BR o que quer ajustar. Claude Code edita prompt/tool/context, roda typecheck, valida.

A combinação fica: você roda cenário no CLI → vê falha → fala com Claude Code "Alpha confundiu X com Y, ajusta o prompt" → Claude Code edita → você re-roda mesmo cenário → confirma.

### As 5 fases do loop

#### Fase 0 — Inspeção (antes de tocar prompt nenhum)

Liste 8-10 cenários reais que cobrem leitura, ações simples, ações em batch, casos ambíguos, e edge cases (datas, nomes inexistentes, dados quebrados). Rode TODOS antes de mexer em código.

Exemplo de matriz de cenários (Alpha):

| # | Cenário | Esperado | Sintoma de falha |
|---|---|---|---|
| 1 | "estado do sprint?" sem rota | tool call + texto curto | inventou números |
| 2 | mesmo, com `--current-path /sprints/X` | filtra pela rota | ignorou rota |
| 3 | "tem alguém sobrecarregado?" | leu baseline + citou | afirmou sem checar |
| 4 | "cria task X pra Y" | propôs antes (Regra 0) | criou direto |
| 5 | "redistribui sprint inteiro" | plano completo antes | executou em silêncio |
| 6 | "lista 100 tasks" | sumário + filtros | dump markdown |
| 7 | data inexistente | flagou | inventou pra compensar |
| 8 | nome ambíguo | pediu desambiguação | escolheu |

Rode os reads primeiro (sem risco). Os writes — rode com flag mental "se ele executar quando deveria propor, é falha + dano em DB". Tenha plano de cleanup.

#### Fase 1 — Diagnóstico

Pra cada cenário falho, decompor: **qual princípio quebrou?**

- Não chamou tool antes de afirmar número → P4 (citação numérica)
- Despejou markdown gigante → P5 (output volumoso)
- Confundiu conceitos → P2 (vocabulário rígido)
- Executou direto → P3 (Regra 0)
- Chutou ano errado → P1 (bloco hoje)
- Ignorou rota → P6 (awareness)
- Aplicou regra errada de pm_review em daily → P7 (dispatcher por type)

Anote por cenário: princípio violado + ajuste candidato (mexer em prompt? em tool? em context?).

#### Fase 2 — Ajuste cirúrgico

**Uma mudança por round.** Não edite prompt e tool no mesmo round, fica difícil isolar o que resolveu.

Tipos de fix:

| Sintoma | Onde fixar |
|---|---|
| Agente não tem dado | Adicionar tool de leitura ou enriquecer contexto |
| Agente tem dado mas ignora | Reforçar regra no prompt |
| Agente erra resolução de FK | Refatorar tool pra aceitar nome em vez de ID |
| Agente desperdiça tool calls | Adicionar block ao contexto (evita N reads) |
| Agente faz batch errado | Drafts pattern |
| Agente mistura conceitos | Vocabulário rígido + dispatcher |

#### Fase 3 — Re-rodar mesmo cenário

Pega thread nova (`--new-thread`), mesma mensagem. Compara:
- Tool call agora correta?
- Output agora alinhado?
- Outras regras seguem OK?

Se passou: marca ✅ no log. Se ainda falha: re-diagnostica (talvez seja outra causa).

#### Fase 4 — Validação cruzada via psql

Se o agente diz "X tem Y FP", confira no banco. Se ele diz "criei a task Z", confirme `SELECT FROM Task WHERE...`. Confiar em texto do agente é o que estamos calibrando — verificar via DB é o ground truth.

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -c '...'
```

#### Fase 5 — Documentar em `<agente>-calibration-results.md`

Pra cada cenário/round, registre:

```markdown
### Cenário X — descrição
**Tool calls:** ...
**✅ Acertos:** ...
**⚠️ Problemas:** ...
**Fix aplicado:** edits em prompt.ts/tools.ts (link)
**Re-validação:** ...
**Decisão:** ✅ | ⚠️ ressalva | 🔴 falha
```

Esse arquivo vira o body do PR quando você for mergear.

### Cleanup obrigatório

Se cenários writes criaram dados de teste no DB, tem que limpar:

```sql
BEGIN;
DELETE FROM "Meeting" WHERE id LIKE 'aaaa%';  -- IDs convencionados
DELETE FROM "Task" WHERE id IN (...);
COMMIT;
```

Convencione IDs prefixados (ex: `aaaaaaaa-...`) pra cenários, fica fácil identificar.

### Quando parar

- Critérios passam: 8/10 cenários ✅, 2/10 ressalvas aceitáveis.
- Doc de calibragem está completo e revisado.
- `tsc --noEmit` limpo, `next build` passa.
- PM/dono do produto deu OK em ao menos 1 cenário com dado real.

### Quando NÃO seguir o loop

- Mudança em produção que afeta múltiplos PMs → valide com PM antes de mergear.
- Tool destrutiva nova → exija dry-run + aprovação.
- Mudança de prompt que muda comportamento em fluxos já calibrados → re-rode TODA a matriz, não só o cenário novo.

---

## 13. Cookbook — 6 patterns reutilizáveis

### Pattern 1: Vocabulário rígido pra distinção semântica

**Quando:** dois conceitos colidem semanticamente pro LLM (ata vs transcrição, Task vs Todo, draft vs aplicado).

**Como:**
1. Bloco no prompt: `## Vocabulário básico — A ≠ B` com definição + heurística + exemplos.
2. Regras duras: "quando user diz X, busca A; se vazio, fale 'não há A — quer B como alternativa?'".
3. Nas tool descriptions, use o vocabulário consistentemente.

**Caso real:** [alpha/prompt.ts](../src/lib/agent/agents/alpha/prompt.ts) seção "Reuniões — Ata Zordon ≠ Transcrição Roam".

### Pattern 2: Regra 0 (propor → confirmar → aplicar)

**Quando:** tool de escrita não-trivial.

**Como:**
1. Prompt explícito: "tool de escrita = propor antes, aplicar depois".
2. Liste explicitamente quais tools são write.
3. Em batches, "plano completo em texto antes da 1ª chamada".
4. Após aplicar, **PARE** e resuma.

**Caso real:** create_meeting do Alpha — sempre propõe data + projetos + attendees em texto antes.

### Pattern 3: Dispatcher por type

**Quando:** entidade tem campo `type` que muda fluxo (Meeting, Project, Sprint).

**Como:**
1. No context loader, function principal vira dispatcher: `switch(entity.type) { case "A": ... }`.
2. Renderers separados por type, cada um com fluxo específico embedded.
3. No prompt: bloco "Tipos de X — fluxos por type (REGRA DURA)" com tools permitidas/banidas por type.

**Caso real:** [alpha/context.ts:buildMeetingBlock](../src/lib/agent/agents/alpha/context.ts) com `renderPmReviewMeeting`, `renderDailyMeeting`, `renderSuperPlanningMeeting`, `renderGeneralMeeting`.

### Pattern 4: Propose-not-Execute

**Quando:** tool afeta dados sensíveis e PM precisa aprovar.

**Como:**
1. Migration cria tabela `XAction(decision: pending|approved|rejected, execution: pending|applied|failed, source: ai|manual, payload jsonb)`.
2. Tool `propose_X({...})` → INSERT decision=pending. **Não muda estado real.**
3. UI lista pendings, PM aprova/edita/rejeita.
4. Tool ou job `apply_X({...})` aplica os approved em batch.
5. Agente vê `list_X_actions` pra evitar duplicar propostas.

**Caso real:** [MeetingTaskAction migration](../supabase/migrations/20260427_meetings_daily_super_planning.sql) + `propose_task_action` em [alpha/tools.ts](../src/lib/agent/agents/alpha/tools.ts).

### Pattern 5: UNION pra dados inconsistentes

**Quando:** modelo permite estado inconsistente (ex: `Project.pmId` aponta pra Member que não está em `ProjectMember`).

**Como:** tool faz UNION dos lugares possíveis, retorna flag indicando origem:

```ts
const byId = new Map();
// 1) PM
if (project.pm) byId.set(pm.id, { ..., source: "project_pm", isPM: true });
// 2) ProjectMembers — merge se já existir, cria se novo
for (const r of pmRows) {
  const existing = byId.get(r.member.id);
  if (existing) { existing.fpAllocation = r.fp; existing.source = "both"; }
  else byId.set(r.member.id, { ..., source: "project_member", isPM: false });
}
return { members: [...byId.values()], warning: orphanPM ? "..." : undefined };
```

**Caso real:** `get_allocated_project_members` em [alpha/tools.ts](../src/lib/agent/agents/alpha/tools.ts).

### Pattern 6: Auto-derive com flag de override

**Quando:** comportamento default é útil 90% mas precisa override pro 10%.

**Como:**
1. Param boolean opcional na tool (ex: `attendeesFromProjects`).
2. Default por tipo/contexto (`autoDerive = type === "daily" ? true : false`).
3. `attendeesFromProjects ?? autoDeriveDefault` permite override explícito.
4. **No prompt:** documente o default por tipo + exemplo de override.

**Caso real:** `create_meeting({ attendeesFromProjects? })` — auto-derive on em daily, off em pm_review, com merge sem duplicar de `attendeeNames`.

---

## 14. Anti-patterns

Erros que vimos na vida real:

### "Não sei a data de hoje"
LLM chuta o ano (2025 quando estamos em 2026). **Fix:** P1, bloco `## Hoje` no contexto.

### "Confundo conceitos similares"
Alpha chamava transcrição Roam de "ata" quando não tinha ata Zordon. **Fix:** P2, vocabulário rígido + regras duras "se vazio, ofereça B como alternativa, não como substituto silencioso".

### "Despejo markdown gigante"
50 tasks em cards densos. **Fix:** P5, sumário compacto + 3-5 mais relevantes + oferta de filtro.

### "Filtro client-side perde matches"
`listTranscriptsInRange({max:50})` + filtro `participant` aplicado depois → matches antigos sumiam. **Fix:** filtro **dentro do loop** de paginação, contando só matches.

### "Tool com descrição lacônica"
`description: "Lista tasks"` é pouco. LLM precisa saber **quando usar** vs alternativas. Descreva o caso de uso, o retorno típico, contraste com tools próximas.

### "Capability sem gating"
Expor write tool sempre, sem `if (capabilities.writeTools)`. Aí qualquer connector destrói dados. **Fix:** sempre gate; CLI dev pode habilitar tudo, web em modo briefing pode liberar só leitura.

### "Tool de leitura escondendo IDs"
Se você retorna só `{name, value}` sem `id`, e tool de escrita posterior precisa de id, agente faz lookup duplicado. **Fix:** retorne `{id, label}` consistentemente.

### "Histórico inflado por tool calls de batch"
20 `move_task_to_sprint` separadas → cada uma vira chunk no histórico → próximo turno carrega tudo de novo. **Fix:** Pattern Drafts (1 tool insere, 1 aplica), reduz pra 2 chunks.

### "Tool descrita pra o dev, não pro LLM"
"`update_task_estimate` — atualiza scope/complexity da Task" é descrição de função. Pro LLM, escreva: "atualiza scope e complexity de uma task, recalculando os FP automaticamente. Use quando o usuário disser 'essa task está mais simples/complexa do que parecia'."

### "Prompt sem hierarquia"
Regras misturadas, contexto no meio, vocabulário no fim. **Fix:** hierarquia rígida (§5).

---

## 15. Checklist final — agente pronto pra mergear

### Código
- [ ] `src/lib/agent/agents/<nome>/` com `index.ts`, `prompt.ts`, `tools.ts`, `context.ts` (e `route-context.ts` se aplicável).
- [ ] `src/app/api/agents/<nome>/chat/route.ts` espelha rota do Alpha.
- [ ] `scripts/<nome>-cli.ts` funciona com `--new-thread` em smoke test.
- [ ] `tsc --noEmit` limpo.
- [ ] `next build` passa.

### Prompt
- [ ] Bloco `## Hoje` injetado no contexto.
- [ ] Bloco de vocabulário rígido pra qualquer par de conceitos colidentes do domínio.
- [ ] Regra 0 explícita listando todas as write tools.
- [ ] Citação numérica reforçada (P4).
- [ ] Output volumoso → resumo/filtro (P5).
- [ ] Awareness de rota documentada (se aplicável, P6).
- [ ] Dispatcher por type documentado (se aplicável, P7).

### Tools
- [ ] Schema Zod com `.describe(...)` em todo campo.
- [ ] Resolução por nome (não ID) em todas as tools de escrita.
- [ ] Reads sem gate, writes em `if (capabilities.writeTools)`.
- [ ] Tools destrutivas em `require_approval_for` (config) ou bloqueadas em contextos sensíveis.
- [ ] Erros como `{ error: "..." }`, não throw.
- [ ] Drafts pattern pra batches de 5+ writes (se aplicável).
- [ ] Propose-not-Execute pra tools sujeitas à aprovação humana (se aplicável).

### Context
- [ ] Loader retorna `Record<string, unknown>` com `${nome}Context: string` pra prompt.
- [ ] Bloco hoje + baseline + foco condicional + heurísticas (índice).
- [ ] Truncamento de notas/transcrições com aviso.

### Capabilities + segurança
- [ ] `getCurrentMember()` na rota antes de qualquer tool sensitive.
- [ ] Tokens externos via `getMemberIntegrationToken(member.id, provider)`, nunca de body.
- [ ] Tokens em closure no `assembleTools`, nunca em payload de tool.
- [ ] Migration da tabela tem RLS + REVOKE; RPCs `SECURITY DEFINER` + GRANT só pra service_role.

### Calibragem
- [ ] Matriz de 8-10 cenários cobrindo reads + writes + edge cases + ambiguidade.
- [ ] Cada cenário rodado, com diagnóstico documentado.
- [ ] Cenários writes têm cleanup automático ou via psql.
- [ ] `<nome>-calibration-results.md` na pasta `docs/` com decisões + fixes + validação.
- [ ] PR body referencia o doc de calibragem.

### Pós-merge
- [ ] Smoke test em staging antes de produção.
- [ ] Comunicar ao PM/dono que o agente está disponível em `/<rota>`.
- [ ] Adicionar entrada em CLAUDE.md / AGENTS.md se houver convenção que sobrescreve runbook.

---

## Apêndice A — Comandos úteis

```bash
# Member id pra teste
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -c 'SELECT id, name, email FROM "Member" LIMIT 10;'

# Smoke test
npx tsx --require ./scripts/_server-only-shim.cjs scripts/<nome>-cli.ts \
  --member-id <uuid> --new-thread --message "olá"

# Cenário com mensagem grande
npx tsx --require ./scripts/_server-only-shim.cjs scripts/<nome>-cli.ts \
  --member-id <uuid> --new-thread --message-file /tmp/msg.txt

# Typecheck
npx tsc --noEmit

# Build
npm run build

# Aplicar migration
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/<DATE>_<nome>.sql

# Regerar database.types.ts após migration
npm run db:types

# Listar threads de um agente
psql "$DIRECT_URL" -c "SELECT id, title, \"createdAt\" FROM \"ChatThread\" WHERE \"agentName\" = '<nome>' ORDER BY \"createdAt\" DESC LIMIT 10;"

# Limpar histórico de uma thread (dev)
psql "$DIRECT_URL" -c "DELETE FROM \"ChatMessage\" WHERE \"threadId\" = '<id>';"

# Commit + push
bash scripts/sync-main.sh -m "feat: novo agente <nome> + calibragem"
```

## Apêndice B — Mapa de arquivos do repo

```
src/lib/agent/
  engine.ts              # runAgent — compartilhado entre todos agentes, NÃO TOCAR
  context.ts             # ensureThread, persistUserMessage, persistAssistantMessage,
                         # buildMessageHistory, persistResponseMessage
  config.ts              # loadAgentConfig, loadAgentHeuristic, loadFpMatrix
  types.ts               # AgentDefinition, Capabilities, AgentRunRequest, ChatThread
  agents/
    vitor/               # agente Design Sessions — referência de DS
    alpha/               # agente Ops — referência de PM tooling
    <nome>/              # ← seu novo agente
  tools/
    step-drafts.ts       # drafts genéricos (Vitor pattern, reusável)

src/app/api/agents/<nome>/
  chat/route.ts          # POST = chat, GET = histórico
  threads/...            # gerência de threads (criar/listar)

src/lib/ai/
  provider.ts            # getModel, DEFAULT_MODEL

scripts/
  _server-only-shim.cjs  # bypassa "server-only" — reutilize via --require
  _server-only-noop.cjs
  vitor-cli.ts           # template
  alpha-cli.ts           # template
  <nome>-cli.ts          # ← seu CLI

supabase/migrations/
  <DATE>_<nome>_*.sql    # migrations específicas do seu agente
```

## Apêndice C — Glossário

- **Agent (agente)**: AgentDefinition + connectors. Conversação iterativa com tools.
- **Capability**: flag/param que controla o que o agente pode fazer naquele run.
- **Connector**: como a request chega (HTTP, CLI, trigger, telegram).
- **Context loader**: função que monta o "## Contexto operacional" injetado no prompt a cada turno.
- **Draft**: registro intermediário (state-only) que fica pendente até `apply_*`. Usado pra batches.
- **Heurística (playbook)**: regra/fluxo opinionado carregável sob demanda via `load_heuristic`.
- **Propose-not-Execute**: pattern de "agente sugere → humano decide → sistema aplica".
- **Step**: 1 turno de tool calling do AI SDK. `stepCountIs(N)` limita.
- **Thread**: 1 conversação persistida. Per-member-agent ou per-session.
- **Tool**: função callable definida via `tool({ description, inputSchema, execute })` do AI SDK.
- **UIMessage / ModelMessage**: formatos de mensagem do AI SDK. UI tem parts ricas, model é simples.

---

**Última revisão:** 2026-04-29
**Referências:**
- [docs/alpha-calibration-plan.md](./alpha/alpha-calibration-plan.md) — runbook específico da calibragem do Alpha
- [docs/alpha-calibration-results.md](./alpha/alpha-calibration-results.md) — resultados da execução do plan acima
- [docs/super-session-plan.md](../features/meetings/super-session-plan.md) — pattern de drafts + Regra 0 (Vitor)
- [src/lib/agent/agents/alpha/](../src/lib/agent/agents/alpha/) — código do Alpha (referência viva)
- [src/lib/agent/agents/vitor/](../src/lib/agent/agents/vitor/) — código do Vitor (referência viva)
