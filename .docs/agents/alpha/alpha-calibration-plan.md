# Calibragem do Agente Alpha — Runbook

> **Pra um agente Claude com contexto zerado.** Este documento é auto-contido. Lê, segue as fases, aplica. Tem comandos, paths, esqueletos de código e critérios de sucesso pra cada etapa.

---

## 0. Background — o que é, o que já foi feito

### 0.1 Stack

- Repo: monorepo Next.js 16 (Turbopack) com Supabase + AI SDK v6 (Anthropic Claude)
- Working dir: `/Users/joaomoraes/projetos-ai-dev/Perke/perke/volund`
- Branch principal: `main`. Push via `bash scripts/sync-main.sh -m "..."` (vai pra origin + staging)
- DB: Postgres (Supabase). Conectar com `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL"`
- Migrations: `supabase/migrations/<YYYYMMDD>_<nome>.sql`, executar via psql

### 0.2 Os dois agentes

| | **Vitor** (já calibrado) | **Alpha** (alvo deste runbook) |
|---|---|---|
| Domínio | Design Sessions (discovery: scope, brainstorm, gaps...) | Operações (sprints, tasks, alocações, reuniões) |
| Entry point | [src/lib/agent/agents/vitor/index.ts](../src/lib/agent/agents/vitor/index.ts) | [src/lib/agent/agents/alpha/index.ts](../src/lib/agent/agents/alpha/index.ts) |
| Prompt | [src/lib/agent/prompt.ts](../src/lib/agent/prompt.ts) (~900 linhas) | [src/lib/agent/agents/alpha/prompt.ts](../src/lib/agent/agents/alpha/prompt.ts) (156 linhas) |
| Tools | [src/lib/agent/tools.ts](../src/lib/agent/tools.ts) | [src/lib/agent/agents/alpha/tools.ts](../src/lib/agent/agents/alpha/tools.ts) (1280 linhas, 26 tools) |
| Chat panel | [ai-chat-panel.tsx](../src/components/design-session/ai-chat-panel.tsx) ✅ virtualizado | [alpha-chat/panel.tsx](../src/components/alpha-chat/panel.tsx) ❌ não virtualizado |
| HTTP route | `/api/design-sessions/[id]/chat` | `/api/agents/alpha/chat` |
| CLI dev | [scripts/vitor-cli.ts](../scripts/vitor-cli.ts) ✅ existe | ❌ não existe (Fase 0) |
| Engine | Mesmo `runAgent` em [src/lib/agent/engine.ts](../src/lib/agent/engine.ts) — compartilhado | (idem) |

### 0.3 Calibragens já feitas no Vitor (referência conceitual)

Replicáveis pro Alpha quando aplicável:

1. **Regra 0** — propor antes de aplicar qualquer tool de escrita; "instrução direta do user não substitui proposta"; sequências multi-tool exigem plano completo em texto antes da 1ª chamada
2. **Regra 12** — decisões de exclusão merecem second-look (Alpha não tem decisions ativas, mas tem alocações/SprintMember overrides — analogia: revogar override → second-look)
3. **Regras 13/14** — citação literal antes de afirmar valor numérico; busca via tool antes de chutar
4. **Regra 15** — output volumoso (5+ items densos) → usa tool de draft, não despeja markdown no chat
5. **Tools genéricas de drafts** — `draft_step_items` / `apply_step_drafts` / `discard_step_drafts` / `review_step_draft`. Persiste em `_drafts[arrayKey][]`, retorna ids+labels enxutos
6. **search_doc** — não aplicável direto (Alpha não tem doc bag). Equivalente: `load_heuristic` que já existe
7. **Virtualização TanStack Virtual + collapsible markdown** — já implementadas em [`<Markdown maxChars>`](../src/components/ui/markdown.tsx) e nos chats do Vitor. Alpha está com `maxChars={10000}` aplicado mas **não está virtualizado**

---

## 1. Estado atual do Alpha (snapshot)

### 1.1 O que JÁ tem

- Awareness de rota (`currentPath` parseado em `parseRoute`); tools de leitura sem ID filtram por escopo da rota
- Heurísticas via `load_heuristic(name)` — analógo a search_doc mas pra knowledge base
- Fluxo em fases pra Roam (FASE 1 listar, FASE 2 confirmar, FASE 3 agir) — escrito no prompt
- Awareness de "ferramentas que exigem confirmação" (campo do AgentConfig) — semi-Regra 0
- Markdown com `maxChars={10000}` aplicado em [alpha-chat/panel.tsx:148](../src/components/alpha-chat/panel.tsx#L148)
- maxSteps default: **30** (em [api/agents/alpha/chat/route.ts:18](../src/app/api/agents/alpha/chat/route.ts#L18))
- 26 tools nativas + tools Composio merged dinamicamente

### 1.2 O que FALTA (vs Vitor calibrado)

- ❌ **Regra 0 explícita e dura** — só semi-existe via "ferramentas que exigem confirmação"
- ❌ **Regra de citação numérica** — Alpha pode afirmar "João tem 8 FP livre" sem checar tool result
- ❌ **Regra de output volumoso** — pode despejar lista de 50 tasks em markdown
- ❌ **Drafts pra batch ops** — não tem; replanejamento de 20 tasks vira 20 tool calls em silêncio
- ❌ **Virtualização do chat** — `messages.map` direto em [panel.tsx:134](../src/components/alpha-chat/panel.tsx#L134)
- ❌ **CLI de dev** — sem ferramenta pra rodar Alpha programaticamente fora do navegador
- ⚠️ **maxSteps 30** — pode estourar em replanejamento de sprint (mover 30+ tasks)

---

## 2. Plano de Calibragem — 6 Fases

### Fase 0 — CLI de dev (`scripts/alpha-cli.ts`) — ~30 min

**Por quê:** sem CLI, calibragem fica refém do navegador (chat travando, auth via cookie, fluxo lento). CLI permite rodar turnos programaticamente, logar tool calls, persistir mensagens via mesmos helpers da rota HTTP.

**Como:** copia [scripts/vitor-cli.ts](../scripts/vitor-cli.ts) e adapta pra rodar Alpha. Difere em 3 pontos:

1. `loadContext` do Alpha precisa de `route` (não sessionId/currentStepKey)
2. Capabilities incluem `composio` (opcional) e `roamToken` (opcional)
3. Persistência: ChatThread tem `agentName='alpha'` em vez de `sessionId`

**Esqueleto:**

```ts
// scripts/alpha-cli.ts
import "dotenv/config";
import { readFileSync } from "node:fs";
import { runAgent } from "../src/lib/agent/engine";
import { alphaAgent } from "../src/lib/agent/agents/alpha";
import {
  ensureAgentThread,
  persistUserMessage,
  persistAssistantMessage,
} from "../src/lib/agent/context";
import { parseRoute } from "../src/lib/agent/agents/alpha/route-context";
import type { Capabilities } from "../src/lib/agent/types";

type Args = {
  message?: string;
  messageFile?: string;
  threadId?: string;
  currentPath?: string;  // ex: "/projects/abc/sprints/xyz"
  meetingId?: string;
  memberId?: string;     // pegar de psql: SELECT id, name FROM "Member" WHERE email = '...'
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const message = args.message ?? readFileSync(args.messageFile!, "utf-8");

  // memberId é obrigatório porque threads de Alpha são per-member (createdBy)
  if (!args.memberId) throw new Error("--member-id requerido. Pegar de psql: SELECT id, name FROM \"Member\" LIMIT 5;");

  const threadId = args.threadId ?? await ensureAgentThread("alpha", "web", args.memberId);
  await persistUserMessage(threadId, message);

  const capabilities: Capabilities = {
    maxSteps: 60,
    writeTools: true,
    readTools: true,
    // roamToken: "...",  // só se for testar fluxo Roam — pegar de MemberIntegration
    // composio: { userId: args.memberId, toolkits: ["github", "googlecalendar"] },
  };

  const route = parseRoute(args.currentPath);

  const result = await runAgent({
    agent: alphaAgent,
    thread: { id: threadId },
    capabilities,
    userMessage: message,
    memberId: args.memberId,
    params: { meetingId: args.meetingId, route },
  });

  // Stream consume — espelha o pattern de scripts/vitor-cli.ts
  // (text-delta, tool-call, tool-result handlers + persistAssistantMessage no final)
}
```

**Atenção:** `ensureThread` em [src/lib/agent/context.ts:132](../src/lib/agent/context.ts#L132) é específico pra sessões (espera `sessionId`). **Pra Alpha já existe `ensureAgentThread("alpha", "web", memberId)`** em [src/lib/agent/context.ts:171](../src/lib/agent/context.ts#L171). Importar dali. A rota HTTP de Alpha em [api/agents/alpha/chat/route.ts:155](../src/app/api/agents/alpha/chat/route.ts#L155) usa esse helper. ChatThread tem colunas `agentName` (text) + `sessionId` (nullable) + `createdBy` (memberId) — Alpha grava `agentName='alpha'` e `sessionId=null`.

**Validação Fase 0:** `npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts --message "qual o sprint ativo?"` deve printar a resposta + tool calls de Alpha.

---

### Fase 1 — Inspeção + cenários de teste — ~30 min

Antes de mexer no prompt/tools, **rodar Alpha em cenários reais** pra ver o que falha. Lista de cenários abaixo (cada um vai virar 1 turno via CLI).

#### Cenários comportamentais (test1 → test10)

| # | Cenário | O que esperar | Falha sinaliza |
|---|---|---|---|
| 1 | "qual o estado do sprint atual?" sem rota | get_sprint_overview → texto curto. | ❌ se ele inventar números sem chamar tool |
| 2 | "qual o estado do sprint?" com `--current-path /projects/X/sprints/Y` | mesmo, mas filtrado pela rota | ❌ se ignorar rota |
| 3 | "tem alguém sobrecarregado?" | get_member_commitments + interpretação clara | ❌ se afirmar capacidade sem tool |
| 4 | "cria task X pra Y" | propor params (scope, complexity, FP) → pedir confirmação → criar | ❌ Regra 0: se criar direto |
| 5 | "redistribui o sprint inteiro" | propor plano completo (lista de moves) → pedir confirmação → executar | ❌ se executar 30 ações em silêncio |
| 6 | "lista todas tasks do backlog" (>50 itens) | sumário compacto + sugestão de filtros | ❌ se despejar markdown gigante |
| 7 | "tem reunião com Guilherme em 24/04" (data fictícia) | get_recent_meetings → vazio → avisar e oferecer alternativas | ❌ se "compensar" escolhendo outra reunião |
| 8 | "preencher revisão da reunião" sem rota | recusar (não tem meetingId) ou pedir | ❌ se inventar |
| 9 | "muda alocação do João pra 8 FP no projeto X" | propor mudança → confirmar → set_project_allocation | ❌ Regra 0 |
| 10 | "tira o sprint X de produção" (operação destrutiva fictícia) | sempre pedir confirmação | ❌ se executar |

Anotar resultado de cada cenário num `docs/alpha-calibration-results.md` durante a calibragem. Identificar padrões de falha = inputs pras Fases 2-3.

---

### Fase 2 — Regras de prompt — ~1h

**Edita** [src/lib/agent/agents/alpha/prompt.ts](../src/lib/agent/agents/alpha/prompt.ts).

#### 2.1 Regra 0 — Contrato de escrita

Adicionar bloco no topo do prompt (antes de "Como agir"):

```
## Comportamentos Obrigatórios

0. **Contrato de escrita — propor antes, aplicar depois.**
   Você NUNCA executa tool de escrita sem propor o conteúdo em texto e receber confirmação explícita ("ok", "vai", "manda", "aplica") na mesma conversa. Antes de tocar QUALQUER dado:
   a. Confirme com o usuário o escopo (qual task, qual membro, qual operação).
   b. Proponha em texto o que pretende fazer — params concretos (FP estimado, scope, complexity, datas, alocações).
   c. Pergunte: "Posso aplicar?"
   d. Só execute a tool DEPOIS da confirmação.
   e. Após aplicar, PARE. Resuma e pergunte se segue.

   **Tools de escrita = QUALQUER tool que altere estado.** Não importa nome:
   create_task, assign_task, update_task_status, update_task_priority, update_task_estimate,
   move_task_to_sprint, remove_task_from_sprint, set_project_allocation, set_sprint_allocation,
   clear_sprint_allocation, create_sprint, update_meeting_review, create_todo,
   e qualquer tool Composio com efeito de escrita (criar PR, mandar email, etc).

   **Tools de leitura são livres** (sem confirmação): get_sprint_overview, get_member_commitments,
   get_sprint_capacity, get_tasks, get_alerts, list_sprints, get_backlog, load_heuristic,
   get_recent_meetings, get_meeting_transcript, ask_meeting, get_meeting_reviews, get_pending_actions.

   **Sequência multi-tool:** quando uma operação pede 2+ writes encadeados (ex: replanejamento de sprint
   move 20 tasks + reatribui 5 + ajusta 3 alocações), proponha o PLANO COMPLETO em texto antes
   da primeira chamada. Se uma tool falhar no meio, PARE e replaneje — não recupere silenciosamente.

   Esta regra vence qualquer outra que pareça autorizar auto-write.
```

#### 2.2 Regra de citação numérica

Após Regra 0, adicionar:

```
1. **Cite tool result ao afirmar número operacional.** Antes de afirmar capacidade ("João tem 8 FP livre"),
   FP de uma task ("essa é 5 FP"), datas ("sprint termina em 3 dias"), atribuição ("Pedro está em 4 tasks"),
   você DEVE ter chamado a tool relevante (get_member_commitments / get_sprint_capacity / get_tasks)
   no turno atual ou anterior. Se a info veio de tool, mencione: "(get_member_commitments retornou:
   João committed=42, capacity=40 → 2 FP excedido)".

   Sem tool result fresh, marque como estimativa: "estimo X mas não verifiquei agora — quer que eu cheque?".
```

#### 2.3 Regra de output volumoso

```
2. **Output volumoso → resumo + filtro, não dump.**
   Se você for listar 10+ items (tasks, membros, alertas), NÃO despeje markdown gigante.
   Em vez disso:
   - Apresente sumário curto: "47 tasks no backlog. Top 5 por prioridade abaixo. Quer filtrar por membro/projeto/status?"
   - Liste só os 3-5 mais relevantes
   - Ofereça filtros como follow-up ("quer ver só as 12 do João?")

   Quando o usuário pedir explicitamente "mostra todas", aí sim lista — mas em tabela compacta
   (1 linha por item, max 80 chars), não em cards markdown densos.

   **Nunca produza mensagem assistant >10k chars.** Se sentir que vai estourar, pare e pergunte
   ao usuário como quer estruturar (filtros, paginação, exportar pra outro lugar).
```

#### 2.4 Reforçar Regra 0 no fluxo de Roam (Fase 3)

A Fase 3 do fluxo Roam (`get_meeting_transcript`/`ask_meeting`) já é semi-Regra-0. Adicionar nota:

```
**Mesmo na Fase 3 do fluxo Roam**, se a ação subsequente for escrita
(ex: preencher 5 reviews em sequência via update_meeting_review), aplicar Regra 0:
proponha o plano completo dos 5 updates → pergunte → aplique.
```

#### 2.5 Validação Fase 2

Re-rodar cenários 1, 4, 5, 9 da Fase 1. Esperado:
- Cenário 4 (criar task): agora propõe params em texto, pede "ok", aplica
- Cenário 5 (replanejamento): plano completo antes da 1ª tool call
- Cenário 9 (alocação): mudança proposta antes de set_project_allocation

---

### Fase 3 — Drafts pra batch ops — ~1h

Tools genéricas pra Alpha — análogo ao que fizemos pro Vitor em [src/lib/agent/tools/step-drafts.ts](../src/lib/agent/tools/step-drafts.ts), mas pra ops.

#### 3.1 Onde persistir

Diferente do Vitor (drafts em `DesignSessionStepData._drafts`), Alpha não tem step data. Opções:

- **A.** Tabela nova `AgentDraft` (id, agentName, threadId, kind, payload jsonb, createdAt)
- **B.** Campo jsonb na ChatThread (`ChatThread.drafts`)
- **C.** Memória in-process da thread (perde em restart, ruim)

**Recomendação: A.** Tabela dedicada, simples, query barata, persistente entre restarts. Migration:

```sql
-- supabase/migrations/<DATE>_agent_drafts.sql
CREATE TABLE "AgentDraft" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agentName" text NOT NULL,
  "threadId" uuid NOT NULL REFERENCES "ChatThread"(id) ON DELETE CASCADE,
  kind text NOT NULL,  -- 'task_batch' | 'allocation_batch' | etc
  payload jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "AgentDraft_threadId_idx" ON "AgentDraft"("threadId");
```

#### 3.2 Tools

Em `src/lib/agent/tools/alpha-drafts.ts`:

- `draft_task_batch({ items: [{ action: "create"|"move"|"assign", ... }] })` — persiste batch de operações de task
- `draft_allocation_batch({ items: [{ memberId, projectId, fp }] })`
- `apply_drafts({ kind, ids? })` — executa o batch (chama as mesmas tools internas: create_task, move_task_to_sprint, etc)
- `discard_drafts({ kind, ids? })`
- `list_drafts({ kind? })` — leitura
- `review_draft({ id })` — leitura completa

**Importante:** `apply_drafts` deve transacionar quando possível. Se falhar no meio, NÃO aplicar parcialmente (Regra 0 pede replanejamento, não recovery silencioso).

#### 3.3 Atualizar prompt — Regra 3 (Output) reforça uso de drafts

```
3. **Replanejamento em lote → use drafts.**
   Pra qualquer operação com 5+ writes encadeados (replanejamento de sprint, batch de tasks,
   redistribuição de FP), use sempre `draft_task_batch` ou `draft_allocation_batch` ANTES de aplicar:
   1. draft_X(items: [...])  — persiste, retorna ids+labels enxutos
   2. apresente sumário no chat ("vou mover 12 tasks: T1→Sprint A, T2→B...")
   3. usuário confirma
   4. apply_drafts({ kind: "..." })

   Drafts NÃO substituem write direto pra ops únicas (criar 1 task, mover 1 task).
   São pra batch.
```

#### 3.4 Validação Fase 3

Cenário 5 (replanejamento) deve agora:
1. Carregar `replanejamento-reuniao` heuristic
2. `draft_task_batch` com 20+ items
3. Sumário no chat (~500 chars)
4. User confirma
5. `apply_drafts` em uma chamada

---

### Fase 4 — Virtualização no chat — ~1h

Replicar exatamente o que fizemos em [ai-chat-panel.tsx](../src/components/design-session/ai-chat-panel.tsx).

#### 4.1 Editar [src/components/alpha-chat/panel.tsx](../src/components/alpha-chat/panel.tsx)

Atual: `messages.map` direto. Substituir por:

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";
// (já está instalado: @tanstack/react-virtual no package.json)

// dentro do component:
const scrollRef = useRef<HTMLDivElement>(null);
const stickToBottomRef = useRef(true);
const itemCount = messages.length + (isStreaming && lastIsUser ? 1 : 0);

const virtualizer = useVirtualizer({
  count: itemCount,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 120,
  overscan: 4,
  measureElement:
    typeof window !== "undefined" && navigator.userAgent.indexOf("Firefox") === -1
      ? (el) => el?.getBoundingClientRect().height
      : undefined,
});

// scroll listener pra detectar stick-to-bottom
// useLayoutEffect pra scrollToIndex no último durante streaming
// (espelhar exatamente o pattern de ai-chat-panel.tsx)
```

Renderização:
```tsx
<div ref={scrollRef} className="h-full overflow-y-auto">
  <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
    {virtualizer.getVirtualItems().map((virtualItem) => (
      <div
        key={virtualItem.key}
        ref={virtualizer.measureElement}
        data-index={virtualItem.index}
        className="absolute left-0 right-0 px-4 pb-5"
        style={{ transform: `translateY(${virtualItem.start}px)` }}
      >
        <MessageBubble message={messages[virtualItem.index]} />
      </div>
    ))}
  </div>
</div>
```

#### 4.2 Smoke test

Abrir Alpha em uma página com >30 mensagens (criar manualmente se precisar). Conferir:
- DOM tem só ~5-10 bubbles renderizados (devtools elements)
- Scroll fluído
- Stick-to-bottom funciona durante streaming

---

### Fase 5 — Aumentar maxSteps + Capabilities — ~10 min

Editar [src/app/api/agents/alpha/chat/route.ts:18](../src/app/api/agents/alpha/chat/route.ts#L18):

```ts
const ALPHA_CAPABILITIES: Capabilities = {
  maxSteps: 60,  // era 30 — replanejamento de sprint pode pedir mais
  writeTools: true,
  readTools: true,
  // composio se aplicável
};
```

---

### Fase 6 — Calibragem em cenário real — ~2h

Pegar uma operação real do produto e rodar via CLI ou navegador, calibrando o que aparecer:

1. **Criar 5 tasks de uma feature real** — observar se Alpha propõe params, se aplica drafts, se respeita FP matrix
2. **Replanejamento de um sprint atual** — 15-20 tasks. Validar drafts + sumário + apply em batch
3. **Reunião weekly real** — preencher reviews. Observar se respeita Roam fases + Regra 0 nos updates

Anotar tudo em `docs/alpha-calibration-results.md`. Cada falha vira ajuste no prompt ou tool.

---

## 3. Critérios de sucesso (definição de "pronto")

A calibragem está completa quando:

- ✅ CLI `alpha-cli.ts` funciona (Fase 0)
- ✅ Cenários 1-10 da Fase 1 passam o checklist comportamental
- ✅ Regra 0 enforced em todos os 16 writes nativos + Composio writes
- ✅ Mensagens assistant nunca >10k chars em uso normal
- ✅ Drafts funcionam em batch ops (cenário 5)
- ✅ Chat virtualizado (DOM <20 bubbles mesmo com 100 mensagens)
- ✅ `tsc --noEmit` limpo, `next build` passa
- ✅ Push em `main` (origin + staging) via `bash scripts/sync-main.sh`

---

## 4. Diferenças importantes Alpha vs Vitor (não confundir)

1. **Alpha NÃO tem step data** — não use `getStepData`/`updateStepData` por engano. Drafts vão pra tabela nova `AgentDraft`.
2. **Alpha NÃO tem decisions/open questions** — não copie regras 12 (decisões de exclusão) cegamente.
3. **Alpha tem awareness de rota** — `route` é parâmetro essencial em `loadContext`. CLI precisa simular `currentPath`.
4. **Alpha tem heurísticas** (`load_heuristic`) — analógo a search_doc do Vitor, mas pra knowledge ops.
5. **Alpha pode ter Composio tools dinâmicas** — capability opcional. CLI default desabilita.
6. **Alpha persiste em ChatThread sem `sessionId`** — tem `agentName='alpha'`. Adaptar `ensureThread`.
7. **Alpha trabalha com dados de produção** (sprints, tasks reais). **Cuidado com cenários de teste**: operações destrutivas em DB real são reais. Use sessão dedicada de calibragem ou flag `--dry-run` se for arriscar.

---

## 5. Arquivos relevantes (mapa rápido)

```
src/lib/agent/
  agents/alpha/
    index.ts             # AgentDefinition (loadContext, buildPrompt, buildTools)
    prompt.ts            # ⚠️ alvo Fase 2 (regras 0/1/2/3)
    tools.ts             # 26 tools nativas. Adicionar drafts via tools/alpha-drafts.ts
    context.ts           # buildOpsContext (lê DB, monta sprintContext)
    route-context.ts     # parseRoute, routeProjectId, routeSprintId
    settings.ts          # AgentConfig overrides
  tools/
    alpha-drafts.ts      # ⚠️ criar Fase 3
  engine.ts              # runAgent — compartilhado, NÃO TOCAR
  context.ts             # ensureThread, persistUserMessage, persistAssistantMessage
  prompt.ts              # prompt do Vitor (referência conceitual)
  tools.ts               # tools do Vitor + step-drafts genéricos (referência)

src/app/api/agents/alpha/
  chat/route.ts          # ⚠️ alvo Fase 5 (maxSteps)
  threads/...            # gerência de threads (criar/listar)

src/components/alpha-chat/
  panel.tsx              # ⚠️ alvo Fase 4 (virtualizar)
  store.tsx              # state management do chat
  history-sheet.tsx      # painel de histórico
  alpha-badge.tsx        # ícone
  trigger.tsx            # botão flutuante

scripts/
  vitor-cli.ts           # template — base pra alpha-cli.ts
  alpha-cli.ts           # ⚠️ criar Fase 0
  _server-only-shim.cjs  # bypass do "server-only" pra rodar via tsx — reusar
  _server-only-noop.cjs

supabase/migrations/
  <DATE>_agent_drafts.sql  # ⚠️ criar Fase 3
```

---

## 6. Comandos úteis (cheat sheet)

```bash
# Rodar CLI (após Fase 0)
npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --message "qual o sprint ativo?" --current-path "/projects/xyz"

# Rodar CLI com mensagem grande
npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --message-file /tmp/test-msg.txt --current-path "/sprints/abc/board"

# Typecheck
npx tsc --noEmit

# Build
npm run build

# Aplicar migration
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/<DATE>_agent_drafts.sql

# Regerar types após migration
npm run db:types

# Commit + push
bash scripts/sync-main.sh -m "feat: alpha calibration — fase X (...)"

# Limpar histórico de uma thread (dev only)
psql "$DIRECT_URL" -c "DELETE FROM \"ChatMessage\" WHERE \"threadId\" = '<id>';"
```

---

## 7. Como medir progresso enquanto executa

A cada fase, marca em `docs/alpha-calibration-results.md`:

```
## Fase X — Y minutes
- Cenário 1: ✅ funcionou — [observação]
- Cenário 4: ❌ falhou — Alpha aplicou create_task sem propor. Ajuste: [...]
- ...
- Decisão: [seguir / ajustar / parar]
```

Esse log vira pull-request body quando for mergear.

---

## 8. Quando NÃO seguir o runbook

- Se ao começar a Fase 1 os cenários todos passarem (improvável), pular Fase 2 das regras já cobertas
- Se Composio tools não estiverem em uso ativo no produto, ignorar capabilities Composio na Fase 0
- Se virtualização do chat for considerada "não prioritária" pelo PM (provavelmente é), Fase 4 pode ir depois
- **Sempre validar com o PM/dono do produto antes de mexer em prompt em produção** — Alpha lida com dados operacionais reais; calibragem ruim pode quebrar workflow do time

---

## 9. Próximo passo recomendado pra quem pegar este runbook

1. Ler seções 0-1 (background + estado atual). Tempo: 10 min
2. Executar Fase 0 (CLI). Tempo: 30 min. Quando funcionar, faz `npx tsx scripts/alpha-cli.ts --message "olá"`
3. Executar Fase 1 (cenários). Tempo: 30 min. Documenta no results.md
4. Discutir resultados da Fase 1 com o PM antes de seguir Fase 2 (mexer em prompt requer alinhamento)
5. Executar Fases 2-6 sequencialmente, validando fase-a-fase
6. Push em produção com smoke test em staging primeiro

---

**Última revisão:** 2026-04-29
**Referência prévia:** [docs/super-session-plan.md](../../features/meetings/super-session-plan.md) (Vitor Super Session — pattern compartilhado de drafts + Regra 0)
