# PRD — Forge Event SSOT (dual-write em ForgeEvent)

> Status: `backlog` · Owner: João · Created: 2026-05-31 · Target: 1 loop Ralph (~1h30min)

---

## 0 · Posicionamento

Primeiro PRD da quinta **Forge-MVP** (F1..F5). Resolve o gap mais crítico do runtime atual: **eventos não estão em Postgres**. Hoje `exec-prd.ts` e `exec-story.ts` só escrevem em `events.jsonl` no disco. A tabela `ForgeEvent` (que a UI Realtime escuta) fica vazia, e os outros PRDs da quinta (F2..F5) dependem desse pipeline. Sem F1, F3 (UI Realtime) não tem o que renderizar.

Princípio: **Postgres é SSOT, filesystem é cache local de debug**.

---

## 1 · Problema

3 sintomas concretos do estado atual:

1. **UI muda** — `run-kanban.tsx:141` e `active-builders.tsx` subscrevem `ForgeEvent` via `supabase.channel('postgres_changes', { table: 'ForgeEvent' })`. A tabela nunca recebe INSERT do runtime. Resultado: UI nunca atualiza durante um run, só após F5/closeout (que ainda não existe).

2. **Run inspecionável só na máquina do daemon** — se o daemon roda na máquina A, os eventos vivem em `~/.volund-forge/runs/<runId>/events.jsonl` em A. Um operador na máquina B (ou no `/forge-spike/runs/<id>` em qualquer browser) não vê nada. Não dá pra ter visão multi-máquina, multi-operador.

3. **Tudo perdido se disco morrer** — `events.jsonl` é o único registro. Sem replicação. Sem audit trail durável. Sem analytics histórica (custo por kind, duração média de story, etc.).

**Fonte de cada problema:**
- [src/app/api/forge/runs/[id]/stream/route.ts:18](../../../src/app/api/forge/runs/[id]/stream/route.ts) — SSE lê `<repo>/.forge/<id>/events.jsonl`, path errado pra daemon-mode.
- [scripts/forge/exec-prd.ts:63-71](../../../scripts/forge/exec-prd.ts) — função `emit()` só `appendFileSync(eventsPath, ...)`.
- Schema `ForgeEvent` em `supabase/migrations/` existe desde o spike mas só recebe INSERTs do legacy `forge-engine` (não-daemon).

## 2 · Solução em uma frase

**Helper único `createEmitter({ runId, agentId?, taskId? })` em `src/lib/forge/runtime/event-writer.ts` que faz dual-write: append síncrono no `events.jsonl` (não-bloqueante, debug local) + INSERT batch assíncrono em `ForgeEvent` (fila in-memory, flush a 250ms ou 100 eventos, retry idempotente).**

## 3 · Não-objetivos

- ❌ Não migrar runs antigos (backfill de jsonl → ForgeEvent). Só novos runs.
- ❌ Não tocar `exec-prd.ts` / `exec-story.ts` além do necessário pra usar o helper. Refator amplo fica fora.
- ❌ Não adicionar campo novo em `ForgeEvent` além do mínimo necessário (a tabela já cobre).
- ❌ Não validar payload contra schema Zod no helper — payload é jsonb freeform por design.
- ❌ Não implementar throttling / rate-limit no flush — sistema é low-volume (1 daemon).
- ❌ Não tratar reconciliação pós-crash (jsonl → DB) — fica pra PRD futuro se precisar.
- ❌ Não medir custo / tokens aqui — F2 trata `ForgeRun` totals.
- ❌ Não criar tabela nova — usar `ForgeEvent` existente.

## 4 · Personas e jornada

**Daemon executando job:**
> "Worker emite `tool_use`. Helper appendFileSync no jsonl (1ms). Helper enfileira INSERT no array in-memory. Quando array chega a 100 itens OU 250ms passou, helper dispara 1 INSERT batch via supabase-js. Worker não esperou nada — já tá no próximo emit."

**UI escutando run:**
> "Realtime channel recebe `postgres_changes` em ForgeEvent. Componente atualiza lista. Latência ≤ 300ms desde o emit do daemon."

**Operador inspecionando run antigo:**
> "Abre `/forge-spike/runs/<runId>`. Componente faz `SELECT * FROM ForgeEvent WHERE runId=$1 ORDER BY seq`. Todos os eventos do run aparecem, mesmo se o daemon nem está rodando."

## 5 · Decisões fixadas

| Dn | Decisão | Por quê |
|---|---|---|
| D1 | Helper único `createEmitter({ runId, agentId?, taskId? })` em `src/lib/forge/runtime/event-writer.ts` exportando `{ emit, flush, close }` | API mínima, testável. Substitui `emit()` inline em `exec-prd.ts` e `exec-story.ts`. |
| D2 | Dual-write: jsonl síncrono primeiro, fila DB depois | jsonl é o safety net (sempre roda); DB pode falhar transitoriamente. Ordem importa: disco antes de DB. |
| D3 | Fila DB in-memory (Array) com flush a `250ms` ou `100 eventos` (whichever first) via `setInterval` | Padrão de telemetria (Datadog/OTel). Latência baixa o suficiente pra UI sentir Realtime. Batch de 100 ≪ 100 INSERTs. |
| D4 | `seq` (bigint) é gerado client-side via counter monotônico por `runId`, incrementado **antes** do dual-write | Preserva ordem dentro do batch. Postgres só valida unicidade `(runId, seq)`. |
| D5 | Falha de INSERT batch loga via `console.error` mas **NÃO** retira eventos da fila — tenta de novo em 1s (exponential backoff até 60s) | Disco já tem; pior caso é atraso no DB, não perda. Backoff evita storm. |
| D6 | CHECK constraint atual de `ForgeEvent.kind` é **dropada** via migration `20260601m_forge_event_kind_widen.sql` | Lista atual (`thought`, `tool_call`, ...) não cobre kinds reais do runtime (`autorun_started`, `manifest_bootstrapped`, etc.). Migrar pra constraint ampla = retrabalho frequente. Sem CHECK = taxonomy livre, documentada em código (`src/lib/forge/runtime/event-kinds.ts`). |
| D7 | Helper expõe `close()` que **espera o último flush** (await Promise) antes de retornar — chamado no `process.on('exit')` do `exec-prd.ts` | Garante que eventos finais (`autorun_done`) cheguem no DB antes do processo morrer. |
| D8 | Falha de flush no `close()` não bloqueia exit — timeout de 5s, depois loga warning e segue | Não trava o daemon se o DB cair na hora errada. Disco continua íntegro. |
| D9 | `agentId` e `taskId` ficam `null` em eventos do orchestrator (exec-prd); preenchidos só no exec-story (que conhece agentId/taskId) | Schema já tem nullable. Sem inventar agentId fake. |
| D10 | Refator é **invasivo mínimo**: `exec-prd.ts` substitui sua função `emit()` por `import { createEmitter } from "../../src/lib/forge/runtime/event-writer"`. Mesma assinatura `emit(kind, payload)`. | Reduz risco. Não muda comportamento de quem emite — só de pra onde o evento vai. |

## 6 · Arquitetura

```
┌────────────────────┐     ┌────────────────────┐
│  exec-prd.ts       │     │  exec-story.ts     │
│  emit("xxx", {...})│     │  emit("xxx", {...})│
└─────────┬──────────┘     └──────────┬─────────┘
          │                            │
          └──────────────┬─────────────┘
                         │
              ┌──────────▼──────────┐
              │ createEmitter()     │  src/lib/forge/runtime/event-writer.ts
              │  ─ counter seq      │
              │  ─ append jsonl     │  (sync, <1ms)
              │  ─ push to queue    │  (sync, <1ms)
              └──────────┬──────────┘
                         │
                  ┌──────▼──────────┐
                  │ flushInterval   │  setInterval 250ms
                  │ OR queue ≥100   │
                  └──────┬──────────┘
                         │
                  ┌──────▼──────────┐
                  │ supabase        │
                  │   .from(        │
                  │     "ForgeEvent"│
                  │   ).insert([..])│
                  └──────┬──────────┘
                         │
                  ┌──────▼──────────┐
                  │  Postgres       │
                  │  ForgeEvent     │  ← SSOT
                  └─────────────────┘
```

Componentes novos:
- `src/lib/forge/runtime/event-writer.ts` — helper exportado, factory `createEmitter`.
- `src/lib/forge/runtime/event-kinds.ts` — type literal union de kinds usados (documentação ao vivo).
- `supabase/migrations/20260601m_forge_event_kind_widen.sql` — drop CHECK constraint.

Componentes modificados:
- `scripts/forge/exec-prd.ts` — substitui `emit()` inline por `createEmitter()`.
- `scripts/forge/exec-story.ts` — substitui `emit()` inline por `createEmitter()`.

## 7 · Schema

```sql
-- supabase/migrations/20260601m_forge_event_kind_widen.sql
ALTER TABLE "ForgeEvent" DROP CONSTRAINT IF EXISTS "ForgeEvent_kind_check";

COMMENT ON COLUMN "ForgeEvent"."kind" IS
  'Free-form text. Canonical taxonomy lives in src/lib/forge/runtime/event-kinds.ts. '
  'Examples: autorun_started, story_picked, story_done, tool_use, tool_result, '
  'assistant_text, error, autorun_done.';
```

`ForgeEvent` existente (mantido):
- `runId uuid NOT NULL` (FK → ForgeRun, ON DELETE CASCADE)
- `seq bigint NOT NULL` (client-monotônico)
- `agentId uuid NULL` (FK → ForgeAgent)
- `taskId uuid NULL` (FK → ForgeTask)
- `ts timestamptz NOT NULL DEFAULT clock_timestamp()`
- `kind text NOT NULL` (CHECK removida)
- `payload jsonb NOT NULL`
- PK `(runId, seq)`
- Indexes em `(agentId, seq)`, `(taskId, seq)` mantidos
- Policies `ForgeEvent_select` (owner+manager) e `ForgeEvent_mutate` mantidas

## 8 · APIs

Nenhuma rota nova ou modificada nesse PRD. Helper é uso interno do runtime.

API TypeScript (exportada do helper):

```ts
// src/lib/forge/runtime/event-writer.ts
export type EmitterConfig = {
  runId: string;
  agentId?: string | null;
  taskId?: string | null;
  jsonlPath: string;
};

export type Emitter = {
  emit(kind: string, payload?: Record<string, unknown>): void;
  flush(): Promise<void>;
  close(): Promise<void>;
};

export function createEmitter(config: EmitterConfig): Emitter;
```

## 9 · UX

N/A — este PRD é runtime/infra puro. UX vem em F3 (forge-ui-realtime).

## 10 · Integrações

- **F2 (forge-run-lifecycle)** depende deste: usa o helper pra emitir eventos quando atualiza `ForgeRun.status/progress`.
- **F3 (forge-ui-realtime)** depende deste: UI subscreve `ForgeEvent` via Realtime, espera popular.
- **F4 (forge-daemon-service)** independente: rodar em paralelo.
- **F5 (forge-closeout-pr)** depende deste: usa o helper pra emitir `closeout_started`, `pr_opened`, etc.

## 11 · Faseamento

1 fase única. PRD é atômico — não vale parcial (se metade do código usa helper e metade não, fica inconsistente).

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Supabase RLS bloqueia INSERT do daemon (daemon não autentica) | Alta | Alta — DB fica vazio | Daemon usa `SUPABASE_SERVICE_ROLE_KEY` via `db()` (já configurado em [src/lib/db.ts](../../../src/lib/db.ts)). Service role bypassa RLS. |
| Fila in-memory cresce sem bound em runs longos / DB caído | Média | Média — leak de RAM | Cap de 10k eventos na fila; ao atingir, descarta novos com warning (disco já tem). |
| Race: dois emits no mesmo ms podem gerar `seq` duplicado se counter não for atômico | Baixa | Alta — INSERT falha por PK | Counter é variável Number incrementada sincronicamente no helper (single-thread Node, sem race). |
| Migration drop CHECK falha por permissão | Baixa | Média | Rodar via `DIRECT_URL` (superuser); test antes em staging. |
| Crash do daemon entre `appendFileSync` e enqueue → evento no disco, não no DB | Média | Baixa | Aceito v1. Reconciliação fica pra PRD futuro se virar dor. |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| Eventos por run no DB / no jsonl | `SELECT count(*) FROM "ForgeEvent" WHERE "runId"=$1` vs `wc -l ~/.volund-forge/runs/$1/events.jsonl` | Razão ≥ 0.99 (perda <1%) |
| Latência emit → DB | `MIN(ts) - jsonl ts` por evento (amostra) | p95 ≤ 500ms |
| Falhas de batch INSERT | `console.error` logs no `~/.forge/daemon.log` filtrado por `"event flush failed"` | < 1% das tentativas |
| UI vê evento em tempo real | Manual: abrir `/forge-spike/runs/<id>` durante run, contar eventos vs `wc -l` jsonl | Diferença ≤ 5 eventos |

## 14 · Open questions

- (Opcional Fase 2) Reconciliação jsonl → DB pós-crash. Decidir quando surgir o caso.

## 15 · Referências

- [scripts/forge/exec-prd.ts](../../../scripts/forge/exec-prd.ts) — emit() atual a ser substituído (linhas 63-71)
- [scripts/forge/exec-story.ts](../../../scripts/forge/exec-story.ts) — outro emit() a substituir
- [src/lib/db.ts](../../../src/lib/db.ts) — client supabase-js com service role
- [src/components/forge/run-kanban.tsx:122-150](../../../src/components/forge/run-kanban.tsx) — consumer Realtime que vai começar a funcionar
- Memory `project_forge_double_diamond`, `project_zordon_ops_pipeline`
- PRD relacionado: [prd-forge-engine.md](prd-forge-engine.md) (FE-007 já previa eventos em DB; este PRD entrega isso de verdade no daemon path)

## 16 · Stories implementáveis

```yaml
- id: ESS-001
  title: Migration drop ForgeEvent_kind_check
  description: ALTER TABLE drop constraint, adiciona comment apontando pra taxonomy em código.
  acceptanceCriteria:
    - "supabase/migrations/20260601m_forge_event_kind_widen.sql existe e roda via psql"
    - "Constraint ForgeEvent_kind_check não existe mais em information_schema"
    - "COMMENT em ForgeEvent.kind referencia src/lib/forge/runtime/event-kinds.ts"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_constraint WHERE conname='ForgeEvent_kind_check'"
      expected: "0"
    - kind: sql
      command_or_query: "SELECT col_description('\"ForgeEvent\"'::regclass, ordinal_position) FROM information_schema.columns WHERE table_name='ForgeEvent' AND column_name='kind'"
      expected: "Free-form text. Canonical taxonomy lives in src/lib/forge/runtime/event-kinds.ts."
  dependsOn: []
  estimateMinutes: 10
  touches:
    - supabase/migrations/20260601m_forge_event_kind_widen.sql
  agentProfile: db
  passes: false

- id: ESS-002
  title: Criar event-kinds.ts (taxonomy ao vivo)
  description: Type literal union com todos os kinds emitidos pelo runtime atual. Documentação ao vivo (não bloqueia novos kinds — apenas IDE autocomplete).
  acceptanceCriteria:
    - "src/lib/forge/runtime/event-kinds.ts existe"
    - "Exporta type ForgeEventKind como union literal"
    - "Inclui: autorun_started, autorun_done, manifest_bootstrapped, story_picked, story_running, story_done, story_failed, story_spawn_error, prd_state_change, error, tool_use, tool_result, assistant_text, stderr, claude_system, claude_result, claude_closed, done"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit src/lib/forge/runtime/event-kinds.ts"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'autorun_started' src/lib/forge/runtime/event-kinds.ts"
      expected: "1"
  dependsOn: []
  estimateMinutes: 10
  touches:
    - src/lib/forge/runtime/event-kinds.ts
  agentProfile: code
  passes: false

- id: ESS-003
  title: Implementar createEmitter() em event-writer.ts
  description: Factory que retorna { emit, flush, close }. Counter monotônico, fila com flush 250ms/100. supabase-js insert. Backoff 1s→60s. Cap 10k eventos.
  acceptanceCriteria:
    - "src/lib/forge/runtime/event-writer.ts existe"
    - "Exporta createEmitter(config: EmitterConfig): Emitter"
    - "emit() é síncrono, appendFileSync no jsonl + push na fila"
    - "Flush automático a cada 250ms via setInterval"
    - "Flush forçado se fila atingir 100 eventos"
    - "Falha de INSERT loga via console.error mas não remove da fila"
    - "Backoff exponencial (1s, 2s, 4s, ..., max 60s)"
    - "Cap 10k eventos na fila — descarta novos com warning"
    - "close() faz último flush (await) com timeout 5s"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit src/lib/forge/runtime/event-writer.ts"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'createEmitter' src/lib/forge/runtime/event-writer.ts"
      expected: "1"
  dependsOn: ["ESS-002"]
  estimateMinutes: 30
  touches:
    - src/lib/forge/runtime/event-writer.ts
  agentProfile: code
  passes: false

- id: ESS-004
  title: Integrar createEmitter em exec-prd.ts
  description: Substituir função emit() inline (linhas 63-71) por import + createEmitter. Chamar close() no autorun_done e no catch principal.
  acceptanceCriteria:
    - "scripts/forge/exec-prd.ts importa createEmitter de event-writer"
    - "Variável seq local removida (helper gerencia)"
    - "Função emit() inline removida; chamadas usam emitter.emit(...)"
    - "main().catch(...) chama await emitter.close() antes de process.exit"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit scripts/forge/exec-prd.ts"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'createEmitter' scripts/forge/exec-prd.ts"
      expected: "1"
    - kind: lint
      command_or_query: "grep -c 'function emit(' scripts/forge/exec-prd.ts"
      expected: "0"
  dependsOn: ["ESS-003"]
  estimateMinutes: 20
  touches:
    - scripts/forge/exec-prd.ts
  agentProfile: code
  passes: false

- id: ESS-005
  title: Integrar createEmitter em exec-story.ts
  description: Mesma operação em exec-story. agentId/taskId podem ser passados se o script conhecer (caso contrário null).
  acceptanceCriteria:
    - "scripts/forge/exec-story.ts importa createEmitter"
    - "Função emit() inline removida"
    - "close() chamado no fim e no error handler"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit scripts/forge/exec-story.ts"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'createEmitter' scripts/forge/exec-story.ts"
      expected: "1"
  dependsOn: ["ESS-003"]
  estimateMinutes: 20
  touches:
    - scripts/forge/exec-story.ts
  agentProfile: code
  passes: false

- id: ESS-006
  title: Smoke test end-to-end
  description: Rodar daemon + criar ForgeRun + ForgeJob fake (1 story trivial) + verificar ForgeEvent populado.
  acceptanceCriteria:
    - "Após run, count(*) em ForgeEvent ≥ 5 (started, story_picked, ..., autorun_done)"
    - "Razão DB/jsonl ≥ 0.99"
    - "Latência p95 emit→DB ≤ 500ms (amostra de 10 eventos)"
  verifiable:
    - kind: manual_browser
      command_or_query: "bash scripts/forge/test-smoke-event-ssot.sh"
      expected: "PASS"
  dependsOn: ["ESS-004", "ESS-005"]
  estimateMinutes: 25
  touches:
    - scripts/forge/test-smoke-event-ssot.sh
  agentProfile: ops
  passes: false
```
