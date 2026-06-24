# PRD — Forge Run Lifecycle (status, progress, totals em ForgeRun)

> Status: `backlog` · Owner: João · Created: 2026-05-31 · Target: 1 loop Ralph (~1h15min)

---

## 0 · Posicionamento

Segundo PRD da quinta **Forge-MVP** (depende de F1). Resolve: **`ForgeRun.status` nunca sai de `queued`**. Hoje `exec-prd.ts` faz `markStoryPasses()` mutando um `prd.json` local com flag `passes:true`, mas o registro canônico na tabela `ForgeRun` fica congelado em `queued`. Resultado: UI e analytics enxergam o run como "nunca começou", mesmo quando ele já terminou.

Princípio: **toda transição de estado do runtime tem que se manifestar como UPDATE em `ForgeRun`**.

---

## 1 · Problema

3 sintomas:

1. **Run congelado em queued** — `ForgeRun.status='queued'` mesmo após o daemon executar 10 stories. `startedAt=null`. `endedAt=null`. UI que filtra "runs ativos" via `WHERE status='running'` nunca acha nada. Tab "Forge" do projeto não mostra histórico de runs concluídos porque todos parecem nunca terem iniciado.

2. **Progress não acumula** — `ForgeRun.progress=0` permanece zero. Não dá pra mostrar barra de progresso. Não dá pra calcular ETA. Não dá pra responder "quantas stories esse PRD tem passado?".

3. **Métricas básicas perdidas** — sem `startedAt`/`endedAt`, não sei a duração média de um run. Sem totals (`tokensInTotal`, `tokensOutTotal`, `costUsdTotal` — colunas que JÁ EXISTEM em `ForgeRun`), não dá pra responder "quanto custou esse PRD?", "qual o PRD mais caro?".

**Fonte de cada problema:**
- [scripts/forge/exec-prd.ts:211-218](../../../scripts/forge/exec-prd.ts) — `markStoryPasses` só mexe em `prd.json` local.
- [scripts/forge/exec-prd.ts:405-503](../../../scripts/forge/exec-prd.ts) — `main()` emite eventos via jsonl mas nenhum `UPDATE ForgeRun`.
- Schema `ForgeRun` já tem `status`, `progress`, `startedAt`, `endedAt`, `costUsdTotal`, `tokensInTotal`, `tokensOutTotal` — colunas órfãs.

## 2 · Solução em uma frase

**Módulo `src/lib/forge/runtime/run-state.ts` com funções `markRunRunning(runId)`, `updateRunProgress(runId, storiesPassed, total)`, `markRunDone(runId, reason)`, `markRunError(runId, reason)` que fazem UPDATE idempotente em `ForgeRun`, plumbed em `exec-prd.ts` nos pontos canônicos do lifecycle.**

## 3 · Não-objetivos

- ❌ Não tocar `ForgeJob` lifecycle — já é correto (daemon faz `updateJobStatus` em [scripts/forge/daemon.ts:106](../../../scripts/forge/daemon.ts)).
- ❌ Não implementar tracking de tokens / custo nesse PRD. Colunas existem mas populá-las precisa parsing do stream Claude — fica pra PRD futuro (`forge-cost-tracking`).
- ❌ Não mexer em `progress` calc complexa (storypoints, AC weight). Usar simples `floor(passed/total*100)`.
- ❌ Não reusar `updateJobStatus` do daemon — `ForgeRun` é objeto diferente, lifecycle diferente.
- ❌ Não acoplar à UI. UI lê o que tiver no DB.
- ❌ Não tratar resume (retomar run abortado). Run interrompido = abandonado.
- ❌ Não emitir webhook / notificação. F5 trata visibilidade externa.

## 4 · Personas e jornada

**Daemon executando primeiro story:**
> "Worker boot. Chamo `markRunRunning(runId)`. Postgres UPDATE: `status='running', startedAt=now()`. UI Realtime já recebeu o `postgres_changes` do ForgeRun — botão 'Cancel' aparece habilitado."

**Story 3 de 10 passa:**
> "Chamo `updateRunProgress(runId, 3, 10)`. Postgres UPDATE: `progress=30`. UI atualiza barra. Analytics dashboard mostra '3/10 stories'."

**Run termina com todas passando:**
> "Chamo `markRunDone(runId, 'all_passed')`. UPDATE: `status='done', endedAt=now(), progress=100, meta=jsonb_set(meta, '{reason}', 'all_passed')`. UI mostra ✓ verde + duração total."

**Run termina por pivot:**
> "Chamo `markRunError(runId, 'pivot_required')`. UPDATE: `status='error', endedAt=now(), meta=jsonb_set(meta, '{errorReason}', 'pivot_required')`. UI mostra ✗ vermelho + link pra pivot-required.md."

## 5 · Decisões fixadas

| Dn | Decisão | Por quê |
|---|---|---|
| D1 | Helpers em `src/lib/forge/runtime/run-state.ts` separado do event-writer | Concerns distintos: lifecycle ≠ telemetria. Test isolado. |
| D2 | 4 transições: `markRunRunning`, `updateRunProgress`, `markRunDone`, `markRunError` | Cobre o lifecycle real do exec-prd. Sem método "intermediate" que abre porta pra estados inválidos. |
| D3 | Todas as funções são idempotentes (`UPDATE ... WHERE status NOT IN ('done','error')`) | Race entre 2 daemons (que não deveria existir) ou retry não corrompe estado. Estado terminal não é sobrescrito. |
| D4 | `progress = Math.floor((passed / total) * 100)` clamped [0,100] | Simples, suficiente. Aceita que stories têm peso igual v1. |
| D5 | `meta` em `ForgeRun` ganha campos `{ reason?: string, errorReason?: string, eventCounts?: Record<string,number> }` via `jsonb_set` | Schema já é `jsonb` — não precisa migration. Acumula contexto sem schema rígido. |
| D6 | `eventCounts` é populado no `markRunDone/Error` lendo `SELECT kind, count(*) FROM "ForgeEvent" GROUP BY kind` daquele runId | Analytics post-mortem barata sem job separado. |
| D7 | Não usar `gen_random_uuid()` nem `now()` no client — server timestamps via DEFAULT/UPDATE expression `now()` | Time skew entre daemon e Postgres não distorce duração. |
| D8 | UPDATE usa supabase-js com service role (mesma client de F1) | Bypassa RLS (daemon não tem auth de usuário). |
| D9 | `progress` chamada **a cada story_done** (não em cada event) — frequência baixa | UPDATE em loop apertado não escala. 1 update por story é suficiente pra UI. |
| D10 | Falha de UPDATE loga warning e segue (não aborta run) | Run em andamento > consistência perfeita de status. F1 garante que eventos chegam mesmo se status update falhar. |

## 6 · Arquitetura

```
exec-prd.ts main()
  │
  ├─ início: markRunRunning(runId)
  │    └─► UPDATE ForgeRun SET status='running', startedAt=now() WHERE id=$1
  │        AND status='queued'   ◄── idempotente
  │
  ├─ loop stories
  │   │
  │   ├─ story passa
  │   │   └─ markStoryPasses(prd.json)            (legacy local)
  │   │   └─ updateRunProgress(runId, n, total)
  │   │       └─► UPDATE ForgeRun SET progress=$2 WHERE id=$1
  │   │
  │   └─ story falha
  │       └─ markRunError(runId, 'story_failed')
  │           └─► UPDATE ForgeRun SET status='error', endedAt=now(),
  │               meta=jsonb_set(meta,'{errorReason}','story_failed')
  │               WHERE id=$1 AND status NOT IN ('done','error')
  │
  └─ fim
      ├─ all passed → markRunDone(runId, 'all_passed')
      ├─ max reached → markRunDone(runId, 'max_reached')
      └─ no more ready → markRunDone(runId, 'no_more_ready')
           └─► UPDATE ForgeRun SET status='done', endedAt=now(), progress=100,
               meta=jsonb_set(meta,'{reason}',$2),
                  jsonb_set(meta,'{eventCounts}', <subquery>)
               WHERE id=$1 AND status NOT IN ('done','error')
```

Componentes novos:
- `src/lib/forge/runtime/run-state.ts` — 4 funções exportadas.

Componentes modificados:
- `scripts/forge/exec-prd.ts` — chamadas nos pontos do lifecycle.

## 7 · Schema

Nenhuma migration. Colunas usadas já existem em `ForgeRun`:
- `status` (text, CHECK queued|running|done|error|aborted)
- `progress` (integer 0..100)
- `startedAt`, `endedAt` (timestamptz nullable)
- `meta` (jsonb)

## 8 · APIs

API TypeScript interna:

```ts
// src/lib/forge/runtime/run-state.ts
export async function markRunRunning(runId: string): Promise<void>;
export async function updateRunProgress(runId: string, storiesPassed: number, totalStories: number): Promise<void>;
export async function markRunDone(runId: string, reason: 'all_passed' | 'max_reached' | 'no_more_ready'): Promise<void>;
export async function markRunError(runId: string, errorReason: 'story_failed' | 'pivot_required' | 'crash' | 'no_prd_json' | 'no_forge_run'): Promise<void>;
```

Nenhuma rota HTTP nova.

## 9 · UX

N/A — backend puro. F3 entrega a UI que consome esse estado.

## 10 · Integrações

- **F1 (forge-event-ssot)** é pré-requisito (este PRD depende do helper estar plumbed).
- **F3 (forge-ui-realtime)** consome o `ForgeRun.status` via subscription.
- **F4 (forge-daemon-service)** independente.
- **F5 (forge-closeout-pr)** estende `markRunDone` adicionando `prUrl` ao `meta`.

## 11 · Faseamento

1 fase. Idempotência de UPDATE permite re-rodar stories sem corrupção.

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Race entre 2 daemons clamando o mesmo run | Baixa | Alta | Combinado com F4 (daemon-ctl.sh recusa subir 2ª instância) + idempotência D3. |
| UPDATE falha e run fica `queued` pra sempre | Média | Média | F4 cron orphan-recovery já existe pra `ForgeJob`; vai precisar análogo pra `ForgeRun` em PRD futuro. v1 aceita o risco. |
| `progress` errado se `totalStories` mudar mid-run (não acontece em modo manifest) | Baixa | Baixa | Snapshot do total no início do run e usa o snapshot. |
| `eventCounts` query lenta em runs gigantes | Baixa | Baixa | Aceito v1; ForgeEvent tem PK `(runId, seq)` e cap por run é ≤ 20 stories. |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| Runs com `status='running'` durante execução | `SELECT status FROM "ForgeRun" WHERE id=$1` em meio a um run | sempre `running`, nunca `queued` |
| `startedAt` populado | `SELECT startedAt FROM "ForgeRun" WHERE id=$1` após primeira story | NOT NULL |
| `progress` reflete avanço | UI mostra "3/10 stories" | progress = floor(3/10*100) = 30 |
| `endedAt` populado no fim | `SELECT endedAt FROM "ForgeRun"` após autorun_done | NOT NULL |
| `meta.eventCounts` populado | `SELECT meta->>'eventCounts' FROM "ForgeRun"` | jsonb não vazio |

## 14 · Open questions

- (Fase 2) Cron orphan-recovery pra `ForgeRun` análogo ao de `ForgeJob`.

## 15 · Referências

- [scripts/forge/exec-prd.ts](../../../scripts/forge/exec-prd.ts) — pontos de plumbing
- [src/lib/db.ts](../../../src/lib/db.ts) — client service-role
- [supabase/migrations/20260601j_forge_daemon.sql](../../../supabase/migrations/20260601j_forge_daemon.sql) — schema atual ForgeRun
- PRD-F1: [prd-forge-event-ssot.md](prd-forge-event-ssot.md)
- Memory `project_forge_double_diamond`

## 16 · Stories implementáveis

```yaml
- id: FRL-001
  title: Implementar run-state.ts com 4 helpers idempotentes
  description: Funções markRunRunning/updateRunProgress/markRunDone/markRunError. supabase-js, service-role. UPDATEs filtram estado terminal.
  acceptanceCriteria:
    - "src/lib/forge/runtime/run-state.ts existe"
    - "Exporta 4 funções com assinaturas do §8"
    - "Todas usam UPDATE com WHERE status NOT IN ('done','error') exceto markRunRunning (WHERE status='queued')"
    - "markRunDone/Error preenchem meta.reason / meta.errorReason via jsonb_set"
    - "markRunDone preenche meta.eventCounts via subquery em ForgeEvent"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit src/lib/forge/runtime/run-state.ts"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'markRunRunning\\|updateRunProgress\\|markRunDone\\|markRunError' src/lib/forge/runtime/run-state.ts"
      expected: "8"
  dependsOn: []
  estimateMinutes: 25
  touches:
    - src/lib/forge/runtime/run-state.ts
  agentProfile: code
  passes: false

- id: FRL-002
  title: Plumb markRunRunning + updateRunProgress em exec-prd.ts
  description: Chamada no autorun_started + a cada story_done. Falhas logam warning, não abortam.
  acceptanceCriteria:
    - "exec-prd.ts importa markRunRunning, updateRunProgress de run-state"
    - "main() chama await markRunRunning(autorunId) logo após autorun_started"
    - "Após cada markStoryPasses(true), chama updateRunProgress(autorunId, passedCount, totalStories)"
    - "Falha do UPDATE só loga via console.warn"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit scripts/forge/exec-prd.ts"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'markRunRunning\\|updateRunProgress' scripts/forge/exec-prd.ts"
      expected: "2"
  dependsOn: ["FRL-001"]
  estimateMinutes: 15
  touches:
    - scripts/forge/exec-prd.ts
  agentProfile: code
  passes: false

- id: FRL-003
  title: Plumb markRunDone + markRunError em exec-prd.ts
  description: Chamadas nos 5 caminhos de saída (all_passed, max_reached, no_more_ready, pivot, story_failed) + no main().catch.
  acceptanceCriteria:
    - "markRunDone chamado em autorun_done(ok:true) com reason correto"
    - "markRunError chamado em autorun_done(ok:false), autorun_pivot, autorun_crash, no_prd_json, no_forge_run"
    - "Cada caminho passa reason / errorReason de catálogo fixo"
    - "Helpers chamados ANTES de process.exit (await garantido)"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit scripts/forge/exec-prd.ts"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'markRunDone\\|markRunError' scripts/forge/exec-prd.ts"
      expected: "6"
  dependsOn: ["FRL-001"]
  estimateMinutes: 20
  touches:
    - scripts/forge/exec-prd.ts
  agentProfile: code
  passes: false

- id: FRL-004
  title: Smoke test lifecycle end-to-end
  description: Rodar 1 run completo. Verificar ForgeRun.status atravessou queued→running→done. startedAt/endedAt populados. progress=100. meta.reason='all_passed'. meta.eventCounts não vazio.
  acceptanceCriteria:
    - "Antes do run: status=queued, startedAt=null"
    - "Durante: status=running, startedAt NOT NULL, progress crescendo"
    - "Após: status=done OR error, endedAt NOT NULL, progress=100 (se done)"
    - "meta tem reason/errorReason"
    - "meta.eventCounts é jsonb não vazio"
  verifiable:
    - kind: manual_browser
      command_or_query: "bash scripts/forge/test-smoke-run-lifecycle.sh"
      expected: "PASS"
  dependsOn: ["FRL-002", "FRL-003"]
  estimateMinutes: 20
  touches:
    - scripts/forge/test-smoke-run-lifecycle.sh
  agentProfile: ops
  passes: false
```
