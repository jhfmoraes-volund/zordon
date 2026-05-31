# PRD — Forge Autopilot (gates + memory + HITL sobre engine core)

> Status: `backlog` · Owner: João · Created: 2026-05-30 · Target: 1 loop Ralph (~2h45min)

---

## 0 · Posicionamento

Este PRD é a **camada de qualidade sobre o orchestrator do prd-forge-engine** (FE-004). Engine sabe rodar uma story; Autopilot sabe rodar um PRD inteiro com gates que verificam **em vez de confiar**. Sem ele, FE-004 é Ralph com profile-injection. Com ele, FE-004 vira piloto automático com 5 gates, 2 cost caps, 3 modos de HITL, e memory.jsonl preservando contexto entre stories.

Origem: spec sandbox `volund-forge-sandbox/docs/specs/autorun.md` validou o approach em ~2h30min de spike. Este PRD promove esse spike pra produção, plugando no engine canônico.

---

## 1 · Problema

[prd-forge-engine.md](prd-forge-engine.md) FE-004 implementa orchestrator local que executa stories sequencialmente, com **pivot detection (D21) — 2 falhas consecutivas mesma story → relatório**. **anti-pattern grep (D20)** já está em FE-006 (profiles). **cost tracking (FE-008)** existe.

Mas **5 gaps concretos** entre o que FE-004 entrega e o que autorun.md prova ser necessário pra autopilot confiável:

1. **Sem memory.jsonl entre stories.** Worker N+1 não vê o que worker N aprendeu *neste* PRD. Resultado: redescobre o mesmo gotcha 3 vezes (caso real do Ralph: `can_view_project tem 1 param, não 2` foi reaprendido em iters CTXSRC-003, CTXSRC-005, CTXSRC-007). Memory `feedback_role_helpers_postgres` documenta isso pós-facto, mas durante a execução é perdido.

2. **Sem cost cap.** FE-008 *traka* custo mas não corta. Story em loop bizarro (LLM em delírio recursivo) pode consumir $5+. PRD inteiro pode passar de $30 antes de alguém olhar. Builders pagam o próprio Claude (memory `project_zordon_ops_pipeline`, D23) — runaway é fricção fiscal real.

3. **Sem smoke gate tsc entre stories.** Typecheck roda dentro do worker como verifiable da story, mas FE-004 não re-valida o estado **global** do repo entre stories. Worker A commita `tsc clean`; worker B começa; worker B só descobre que worker A quebrou `src/types/global.d.ts` quando o próprio tsc dele falha — tarde, com diff já feito.

4. **Sem HITL strategy configurável.** FE-004 default = "para na 1ª falha" (conservative). Builder em PRD de alta confiança (Wiki v2) quer `full-auto` que só para no pivot (D21). Builder em PRD experimental quer `retry-once` com hint. Hoje, único modo é o hardcoded.

5. **Sem diff size / touches mismatch reporters.** Story diz `touches: [a.ts, b.ts]` mas worker mexeu em 14 arquivos. Diff 800 LOC. FE-004 não nota — só descobre se humano abre PR. Anti-pattern grep (D20) é por profile (`<Dialog `, etc), não por *tamanho* nem por *escopo creep*.

**Fonte de cada problema:**
- [prd-forge-engine FE-004](prd-forge-engine.md) descreve pivot+lock+merge mas não memory+caps+smoke+HITL+size.
- [volund-forge-sandbox/scripts/forge/exec-prd.ts:241-302](../../../../volund-forge-sandbox/scripts/forge/exec-prd.ts) — autorun atual do sandbox tem memory.jsonl mas SEM gates, SEM caps, SEM HITL — fica claro o que falta.
- [volund-forge-sandbox/docs/specs/autorun.md §3](../../../../volund-forge-sandbox/docs/specs/autorun.md) — constraints 4-12 listam exatamente os 5 gaps.

## 2 · Solução em uma frase

**Camada de gates + memory + HITL plumbed no orchestrator (prd-forge-engine FE-004), com sliding-window memory.jsonl entre stories, 2 cost caps com kill mid-flight, smoke tsc + rollback HEAD~1 entre stories, 3 HITL strategies (conservative/retry-once/full-auto), e 2 quality reporters (diff size, touches mismatch).**

## 3 · Não-objetivos

- ❌ Não reimplementar FE-004 — autopilot estende, não substitui. Stories aqui modificam funções do orchestrator existente.
- ❌ Não paralelizar (worktrees concorrentes) — sequencial v1. FE-005 (engine) já trata worktree por story; autopilot continua 1-worker-por-vez.
- ❌ Não persistir memory.jsonl em Supabase v1 — filesystem é SSOT do autopilot, local-first. Audit trail via FE-007 hooks (eventos sobem pro DB).
- ❌ Não auto-gerar pivot reports via LLM — relatório é template `pivot-required.md` (já em FE-004). LLM diagnosis é Phase 2.
- ❌ Não modificar profiles (FE-006) — autopilot é genérico, profile-agnostic.
- ❌ Não tocar Diamond 1 (Vitor/Vitoria) — autopilot é puro Diamond 2.
- ❌ Não substituir Ralph (`scripts/ralph/*.sh`) — convivem. Migração soft é Phase ∞.
- ❌ Não fazer pause/resume via web — autopilot roda até fim, abort, ou cap hit. UI pause é Phase 2.
- ❌ Não fazer cost forecasting upfront — só track + cap realizado, sem estimativa pré.
- ❌ Não fazer branch per story aqui — FE-005 já trata isolation worktree.

## 4 · Personas e jornada

**Builder em PRD novo (alta incerteza):**
> "Dispatch autorun com `--hitl=retry-once --cost-cap-prd=5`. Story 3 falha smoke tsc. Autopilot rollback HEAD~1, retry com hint 'tsc fail: error TS2322 in foo.ts:42'. Funciona. Story 5 quebra duas vezes seguidas — pivot, autopilot para, escreve relatório, eu reviso a Spec.md. Gastei $2.30."

**Builder em PRD bem definido (alta confiança):**
> "Dispatch autorun com `--hitl=full-auto --cost-cap-prd=15`. Saio almoçar. Volto, vejo 10/12 stories passes=true, custou $8.20, 2 ainda na fila. Story 11 mexeu em 12 arquivos (warning touches_mismatch, mas não pausou). Story 12 atingiu 600 LOC → autopilot pausou em `needs-human-review`. Abro diff, decido se merge ou refactor."

**Forge orchestrator (FE-004):**
> "Recebo task → pre-spawn: leio memory.jsonl últimas 5 + learnings-only, injeto no prompt → checo PRD cap (sum cost so far + estimate vs limite) → spawn worker → watchdog em stream-json (cap story) → post-worker: smoke tsc → anti-pattern (FE-006) → diff size → touches → se ok, append memory; se fail, apply HITL strategy."

## 5 · Decisões fixadas

| Dn | Decisão | Por quê |
|---|---|---|
| D1 | Memory.jsonl mora em `.forge/<runId>/memory.jsonl` (FS, NÃO em DB v1) | Local-first matches autopilot premise. Sandbox spec autorun.md provou o approach. Audit via FE-007 hook trail. |
| D2 | MemoryEntry shape: `{ story, title, summary, filesTouched[], learnings[], cost, durationMs, passes, killed?, smokeFailed?, diffStats? }` | Mínimo viável; `learnings[]` é freeform que worker preenche via tool `record_learning` (FE-013). |
| D3 | Sliding window injection: últimas 5 entries + qualquer entry com `learnings.length > 0`, cap 3000 tokens (truncate `summary` se exceder) | Cap ~3k tokens preserva orçamento de prompt. Learnings sempre incluídos porque são o sinal denso. |
| D4 | Dois cost caps: `costCapStory` ($1.00 default) e `costCapPrd` ($10.00 default). Configuráveis via CLI flag + env. | Story cap kill mid-flight; PRD cap pausa antes do próximo spawn (mais barato — não desperdiça parcial). |
| D5 | Kill mid-flight: SIGTERM no child → aguarda 10s → SIGKILL. Cleanup worktree via `git worktree remove --force`. Memory entry registra `killed: true, cost: <parcial>`. | SIGTERM dá chance de cleanup; SIGKILL é último recurso. Worktree força remove pra liberar estado. |
| D6 | Smoke gate = `npx tsc --noEmit --incremental` no repo root entre stories. Timeout 60s default. `--skip-smoke` flag pula com warning event. | tsc incremental é rápido (~3-8s no Volund). Catches breakage cross-file que worker isolado não vê. Build (`pnpm build`) opt-in. |
| D7 | Smoke fail → `git reset --hard HEAD~1` + `git worktree remove --force <path>` → story marcada `failed` + counter incrementa pro pivot detection (FE-004 D21) | Rollback atômico. Counter compartilhado com pivot dá comportamento consistente. |
| D8 | HITL strategies (3): `conservative` (para na 1ª fail), `retry-once` (default — 1 retry com diagnostic hint, depois para), `full-auto` (continua, pivot por D21 decide) | Builder escolhe risk-tolerance. Default mais conservador que pivot-only — autopilot é nervoso por design. |
| D9 | Diff size gate: `>500 LOC` OR `>20 files` → marca run `needs-human-review` e pausa (não fail) | Threshold conservador; review humano > suposição. Override via `--max-loc` `--max-files`. |
| D10 | Touches mismatch é WARNING (não block): se worker editou arquivo fora de `story.touches[]`, registra em events.jsonl + memory.diffStats. Filtra: só destaca arquivos *criados* (novos), não edits em existentes. | `touches` é orientativo no schema AGENTS.md. Builder informado decide. Filtro evita ruído de import-path edits. |
| D11 | Autopilot meta persistido em `.forge/<runId>/meta.json` no início: `{ hitlStrategy, costCapStory, costCapPrd, maxLoc, maxFiles, skipSmoke, startedAt }` | Audit + recovery: se autopilot crash, próxima invocação lê config. |
| D12 | Eventos novos emitidos via FE-007 (events.jsonl + Supabase upload): `cost_cap_warn`, `cost_cap_hit_story`, `cost_cap_hit_prd`, `smoke_fail`, `smoke_rollback`, `diff_oversize_review_needed`, `touches_mismatch`, `memory_appended`, `hitl_strategy_set`, `hitl_retry` | Observability via mesmo pipeline existente. UI (FE-010) consome sem alteração de source. |

## 6 · Arquitetura

```
Orchestrator (FE-004, prd-forge-engine)
─────────────────────────────────────
  pickReadyStory()
   │
   │ ┌─── pre-spawn ───────────────────────────────────────────────┐
   │ │  loadMemoryWindow(runId)            ◄── memory.ts           │
   │ │  → inject in worker prompt header                            │
   │ │  costGuard.checkPrdCap()            ◄── cost-caps.ts        │
   │ │  → if exceeded: pause autorun, emit cost_cap_hit_prd        │
   │ └──────────────────────────────────────────────────────────────┘
   │
   │ ┌─── spawn worker (FE-005) ───────────────────────────────────┐
   │ │  costGuard.watchWorker(child, costStream)                   │
   │ │  → SIGTERM if storyCap exceeded                             │
   │ │  → cleanup worktree, emit cost_cap_hit_story                │
   │ └──────────────────────────────────────────────────────────────┘
   │
   │ ┌─── post-worker (sequential gates) ──────────────────────────┐
   │ │  1. anti-pattern grep      ◄── FE-006 profile (existing)    │
   │ │  2. diff-review            ◄── diff-review.ts (NEW)         │
   │ │     → if oversize: pause status='needs-human-review'        │
   │ │     → emit touches_mismatch warnings                        │
   │ │  3. smoke gate             ◄── smoke.ts (NEW)               │
   │ │     → tsc --noEmit --incremental                            │
   │ │     → if fail: git reset HEAD~1 + worktree remove           │
   │ │     →           mark story failed, emit smoke_fail          │
   │ │  4. if all pass: appendMemory(entry)                        │
   │ └──────────────────────────────────────────────────────────────┘
   │
   │ ┌─── failure handling (hitl.ts) ──────────────────────────────┐
   │ │  applyStrategy(hitlStrategy, failureCtx)                    │
   │ │   conservative → stop autorun                               │
   │ │   retry-once   → 1 retry with diagnosticHint, then stop     │
   │ │   full-auto    → continue, increment consecutiveFailures    │
   │ │                  (FE-004 D21 pivot triggers at 2)           │
   │ └──────────────────────────────────────────────────────────────┘
   │
   └─► loop until: all passes OR pivot OR cap_hit_prd OR human-review
```

**Componentes novos (cada arquivo real):**

| Componente | Path | Responsabilidade |
|---|---|---|
| Memory | `src/lib/forge/memory.ts` | `appendMemory`, `loadMemoryWindow` — sliding window + cap |
| Cost caps | `src/lib/forge/cost-caps.ts` | `CostGuard` class: `watchWorker` (SIGTERM mid-flight), `checkPrdCap` |
| Smoke gate | `src/lib/forge/gates/smoke.ts` | `runSmokeGate` — tsc + rollback |
| Diff review | `src/lib/forge/gates/diff-review.ts` | `runDiffReview` — size + touches mismatch |
| HITL | `src/lib/forge/hitl.ts` | `applyStrategy` — decide retry/stop/continue |
| Orchestrator (extensão) | `src/lib/forge/orchestrator.ts` (FE-004) | Plumb dos novos gates em ordem |

## 7 · Schema (DDL)

**Nenhuma migration nova.** Memory.jsonl + reports + meta.json são filesystem.

(Phase 2 opcional): adicionar `ForgeRun.hitlStrategy text`, `ForgeRun.costCapStoryUsd numeric`, `ForgeRun.costCapPrdUsd numeric` pra audit. Não-bloqueante.

## 8 · APIs

**Nenhum endpoint novo.** Reusa FE-014 (dispatch) — body `POST /api/forge/runs` ganha campos opcionais:

```typescript
{
  taskId: string,         // existing
  hitlStrategy?: 'conservative' | 'retry-once' | 'full-auto',  // NEW, default 'retry-once'
  costCapStoryUsd?: number,  // NEW, default 1.00
  costCapPrdUsd?: number,    // NEW, default 10.00
  maxLoc?: number,           // NEW, default 500
  maxFiles?: number,         // NEW, default 20
  skipSmoke?: boolean,       // NEW, default false
}
```

Esses params são propagados pro orchestrator via env vars (`FORGE_HITL`, `FORGE_COST_CAP_STORY`, etc) ou args CLI.

**Eventos novos via FE-007 (events.jsonl + Supabase ForgeEvent):**

| `kind` | Payload | Quando |
|---|---|---|
| `cost_cap_warn` | `{costSoFar, capUsd, deltaPct}` | Cost atinge 80% do cap (story ou PRD) |
| `cost_cap_hit_story` | `{storyId, costSoFar, capUsd}` | Story killed por cap |
| `cost_cap_hit_prd` | `{costSoFar, capUsd, queuedStories[]}` | Autorun pausado por cap PRD |
| `smoke_fail` | `{storyId, outputTail}` | tsc falhou |
| `smoke_rollback` | `{storyId, commitReverted}` | Reset HEAD~1 feito |
| `diff_oversize_review_needed` | `{storyId, loc, files, max}` | Oversized — pausa |
| `touches_mismatch` | `{storyId, expected[], actual[], extraCreated[]}` | Warning |
| `memory_appended` | `{storyId, learningsCount}` | Memory entry escrita |
| `hitl_strategy_set` | `{strategy}` | No início do autorun |
| `hitl_retry` | `{storyId, attempt, diagnosticHint}` | Retry-once disparado |

## 9 · UX

**Aba "Memory" no PRD detail (extensão de FE-010):**

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚒  forge-engine · run-abc123    [HUD] [DAG] [TaskList] [Memory]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ── memory.jsonl ──                                                 │
│                                                                     │
│  ✓ FE-001 · spec parser           25m · $0.18 · 2 learnings        │
│    files: src/lib/forge/spec/schema.ts, parser.ts                  │
│    learnings: "yaml lib retorna line 1-indexed; col 0-indexed"     │
│                                                                     │
│  ✓ FE-002 · iter-0 planner        28m · $0.42 · 1 learning         │
│    files: src/lib/forge/planner.ts                                 │
│    learnings: "Agent Explore subagent_type aceita prompt mas       │
│                ignora isolation flag em plan-mode"                  │
│                                                                     │
│  ✗ FE-003 · migrations            killed · $1.04                   │
│    smoke_failed: 1; cost_cap_hit_story (cap $1.00)                 │
│    output_tail: "error TS2304: Cannot find name 'ProjectInsight'"  │
│                                                                     │
│  ▶ FE-004 · orchestrator          retry-once · attempt 2/2         │
│    diagnosticHint from previous: "smoke_fail line 42 in foo.ts"    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Header global ganha indicador autopilot live:**

```
🟢 Forge ready · 1 autorun · $2.30 / $10 · retry-once
```

**Sonner toasts** pros eventos high-severity: `cost_cap_hit_prd`, `diff_oversize_review_needed`, pivot.

Padrões UI (memory `project_ui_patterns`):
- Aba Memory render via existing TaskSheet pattern (FE-010 tem aba Diff; Memory é irmã)
- Status chips coloridos (verde=passes, vermelho=killed, amarelo=needs-review, azul=running)
- Eventos high-severity em Sonner, não modal
- Optimistic não aplicável (read-only feed)

## 10 · Integrações

| Sistema | Integração | Direção |
|---|---|---|
| prd-forge-engine FE-004 | Orchestrator estende (plumb gates) | autopilot → FE-004 |
| prd-forge-engine FE-005 | Worker spawn — autopilot watcha cost stream + pode kill | autopilot → child_process |
| prd-forge-engine FE-006 | Anti-pattern grep (já existe); autopilot roda na sequência | sequencial |
| prd-forge-engine FE-007 | Hooks emitem novos `kind`s no events.jsonl + Supabase upload | autopilot → FE-007 |
| prd-forge-engine FE-008 | Stream-json cost parser — autopilot reusa pra cap tracking | autopilot → FE-008 |
| prd-forge-engine FE-010 | UI consome events.jsonl via dual-track — ganha aba Memory | autopilot → UI |
| Git | `git reset --hard HEAD~1`, `git worktree remove --force` | autopilot → git |
| Filesystem | `.forge/<runId>/memory.jsonl`, `meta.json` | autopilot → FS |

## 11 · Faseamento

**Fase 1 (este PRD) — Autopilot v1:** 6 stories, ~2h45min. Plumb completo dos gates + memory + HITL + caps no orchestrator. Sequencial (1 worker por vez). Filesystem-first.

**Fase 2 (PRD futuro):**
- Paralelismo-aware caps: PRD cap divide budget entre workers concorrentes
- Memory.jsonl com summarization Haiku (cap absoluto eleva pra 8 entries)
- LLM pivot diagnosis (`pivot-required.md` enriquecido com hipótese gerada)
- Pause/resume via web UI

**Fase ∞:**
- Adaptive caps (aprende custo médio por profile, ajusta auto)
- Memory upload pra Supabase como audit canônico
- Multi-PRD orchestration (Vitoria Planning Ceremony dispatcha vários autopilots)

**Fase 1 entrega mais que o sistema atual** porque:
- (a) memory.jsonl elimina redescoberta cross-story (FE-013 ForgeLearning é cross-RUN; memory.jsonl é cross-STORY dentro de 1 run — granularidade diferente, complementar)
- (b) cost caps eliminam runaway financeiro
- (c) smoke gate catches breakage entre stories (lacuna do FE-004)
- (d) 3 HITL strategies eliminam o all-or-nothing do "para na 1ª fail"
- (e) diff size / touches mismatch dão sinal de scope creep que humano sentiria só no PR review

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| SIGTERM no `claude -p` deixa worktree corrompida (mid-write) | Média | Alto | Try-catch no `worktree remove --force`; log erro com path pro builder limpar manualmente. Memory entry registra `cleanupFailed: true`. |
| Sliding window inflate prompt em PRDs com 20+ stories | Baixa | Médio | Cap absoluto: 5 entries OU 3000 tokens (whichever first). Tokens calculados via `summary.length / 4` (heurística OK pra cap). Excedente: read-on-demand via Read tool. |
| Smoke tsc lento (>30s em repo grande) bloqueia autorun | Média | Médio | tsc `--incremental` (já default no tsconfig.json — verificar). Flag `--skip-smoke`. Timeout 60s default. |
| Cost parser quebra (Claude muda stream-json format) → caps não disparam | Baixa | Alto | Adapter pattern em `cost-parser.ts` (FE-008 já planeja). Fallback: se cost não parseable após 30s, log warn + desliga cap (não kill). Lock `@anthropic-ai/claude-code` version. |
| Diff size false positive em refactors legítimos | Alta | Médio | `needs-human-review` é PAUSE, não FAIL. Builder destrava. Builders aprendem o threshold do projeto e ajustam via flag. |
| Memory.jsonl cresce ilimitado (PRDs gigantes) | Baixa | Baixo | Rotation: se file > 1MB, move pra `.forge/<runId>/memory-archive/` e começa novo. Load window respeita só o file ativo. |
| Touches mismatch ruído (import path autoedit) | Alta | Baixo | Filtra warnings: só destaca arquivos **criados** (new), não edits em existentes. Imports atualizados pelo IDE/LLM são edits — silencia. |
| HITL `full-auto` + PRD bug = 12 stories de retry inútil | Média | Alto | D21 pivot detection (FE-004) ainda triggera em 2 fails consecutivas mesma story — fail-safe. PRD cap (D4) é cinto-e-suspensório. |
| Cost cap PRD muito baixo (builder esquece) → autorun pausa cedo demais | Média | Baixo | Header UI mostra `costSoFar / capUsd`. Sonner toast em 80%. Builder ajusta on-the-fly via re-dispatch com novo cap. |
| `git reset --hard HEAD~1` apaga commit de outra story acidentalmente | Baixa | Catastrófico | Pré-condição: orchestrator só executa rollback se `HEAD~1` for o commit da story atual (verifica via `git log -1 --format=%s` matching pattern `forge — <storyId>`). Senão: erro fatal + abort autorun. |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| Custo médio por story | `avg(costUsd)` from `.forge/<runId>/memory.jsonl` (jq aggregate) | < $0.50 p50 |
| Custo médio por PRD | `sum(costUsd)` per autorun | < $5 p50 |
| Memory reduz redescoberta | Tokens_in (do stream-json) iter 2+ vs iter 1, ambos com memoryEntries.length > 0 vs 0 | iter N ≤ iter 1 × 0.8 |
| Smoke gate catch rate | `% stories onde smoke_fail evento após worker exit code 0` | > 0% (proves it catches) |
| HITL conservative default funcionando | Audit query: `SELECT count(*) FROM ForgeRun WHERE meta->>'hitlStrategy'='full-auto' AND startedBy != automated_dispatch` | ≤ 5% (most builders na default) |
| Cost cap fire rate | `% runs onde cost_cap_hit_prd` no events.jsonl | < 10% (alto = caps muito apertados) |
| Diff size review pausa rate | `% stories needs-human-review` | < 5% (alto = threshold errado) |
| Pivot rate | `% PRDs onde pivot disparou` | < 15% (alto = qualidade Spec ruim) |
| Autorun finish rate | `% PRDs onde autorun_done.ok = true` | ≥ 70% |
| Tempo médio por story | `avg(durationMs)` from memory | < 8 min |
| Time-to-pivot | `min(elapsed)` em PRDs que pivotaram | < 20min (pivot rápido > insistir) |

## 14 · Open questions

- **OQ1**: MemoryEntry deve incluir `transcript_excerpt` (últimos 250 chars do worker output)? Trade-off: contexto denso vs token bloat. *(decide na FAP-001)*
- **OQ2**: Smoke gate deveria incluir `pnpm lint`? Tradeoff: lint demora mais + falsos positivos por warnings vs pegar mais bugs. *(decide na FAP-003 — provavelmente não em v1, opt-in via flag em Phase 2)*

## 15 · Referências

- [docs/prd/backlog/prd-forge-engine.md](prd-forge-engine.md) — engine core, especialmente FE-004 (orchestrator), FE-005 (worker), FE-006 (profiles), FE-007 (hooks), FE-008 (cost), FE-013 (learnings)
- [volund-forge-sandbox/docs/specs/autorun.md](../../../../volund-forge-sandbox/docs/specs/autorun.md) — spec sandbox origem, 5 seções
- [volund-forge-sandbox/scripts/forge/exec-prd.ts](../../../../volund-forge-sandbox/scripts/forge/exec-prd.ts) — autorun sandbox atual (baseline)
- Memory `feedback_role_helpers_postgres` — exemplo concreto de gotcha que memory.jsonl pegaria
- Memory `project_zordon_ops_pipeline` — D23 builders pagam Claude (motivação do cost cap)
- AGENTS.md — bloco "PRDs — escrever pra Ralph" + UI patterns

## 16 · Stories implementáveis

```yaml
- id: FAP-001
  title: Memory.jsonl writer + sliding-window injector
  description: |
    src/lib/forge/memory.ts: exporta appendMemory(runId, entry), loadMemoryWindow(runId).
    MemoryEntry shape: { story: string; title: string; summary: string;
    filesTouched: string[]; learnings: string[]; cost: { tokensIn, tokensOut, usd };
    durationMs: number; passes: boolean; killed?: boolean; smokeFailed?: boolean;
    diffStats?: { loc, files, mismatches } }.
    Sliding window: últimas 5 entries por ordem cronológica + TODAS as entries com
    learnings.length > 0 (deduped por story id). Cap absoluto: 3000 tokens
    (heurística: summary.length + learnings.join.length divide por 4).
    Truncate summary se exceder.
    loadMemoryWindow retorna { entries: MemoryEntry[]; asPromptString: string }.
    asPromptString formato: header 'CONTEXT FROM PREVIOUS STORIES IN THIS PRD:' +
    bullet list por entry com story id, summary, learnings.
  acceptanceCriteria:
    - "src/lib/forge/memory.ts exporta appendMemory + loadMemoryWindow"
    - "Memory file path: .forge/<runId>/memory.jsonl"
    - "MemoryEntry shape documentado em type export"
    - "Sliding window: 10 entries appended → loadMemoryWindow retorna 5 mais recentes + extras com learnings"
    - "Cap absoluto: força truncate de summary se total > 3000 tokens"
    - "asPromptString começa com 'CONTEXT FROM PREVIOUS STORIES IN THIS PRD:'"
    - "Entries com learnings: [] não-vazias aparecem mesmo se >5 atrás"
    - "Test: append 10 entries (2 com learnings) → loadMemoryWindow retorna 5 + 2 (dedup)"
    - "appendMemory é idempotente por (runId, story) — re-append mesma story substitui"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 25
  touches:
    - src/lib/forge/memory.ts
    - src/lib/forge/memory.test.ts
  agentProfile: wiring

- id: FAP-002
  title: Cost caps com kill mid-flight (CostGuard class)
  description: |
    src/lib/forge/cost-caps.ts: exporta CostGuard class.
    Constructor: { storyCapUsd: number; prdCapUsd: number; currentPrdCostUsd: number }.
    Métodos:
      - watchWorker(child: ChildProcess, costStreamSource: AsyncIterable<CostDelta>):
        async loop sobre stream → accumula → se story cost > cap, emit 'cap_hit_story'
        + child.kill('SIGTERM') + setTimeout(10000, () => child.kill('SIGKILL'))
      - checkPrdCap(): { ok: boolean; remaining: number; warn?: boolean } — true se
        próximo spawn comfortavelmente cabe. warn=true se já passou de 80%.
      - getStoryCost(): number
    Plumb no orchestrator (FE-004):
      - antes de spawn: checkPrdCap() — se !ok, pause autorun + emit cost_cap_hit_prd
      - durante spawn: watchWorker(child, parseCostStream(child.stdout))
      - após kill: worktree remove --force + memory entry { killed: true, cost: final }
    Defaults: $1.00 story, $10.00 PRD. Override via CLI flag --cost-cap-story=<n>
    --cost-cap-prd=<n> ou env FORGE_COST_CAP_STORY / FORGE_COST_CAP_PRD.
  acceptanceCriteria:
    - "CostGuard class em src/lib/forge/cost-caps.ts"
    - "watchWorker emite event 'cap_hit_story' quando excede"
    - "SIGTERM enviado primeiro; SIGKILL após 10s sem exit"
    - "Worktree removed via git worktree remove --force após kill"
    - "Memory entry persiste { killed: true, cost: final accumulated }"
    - "Orchestrator pausa autorun (não próximo spawn) quando PRD cap atingido"
    - "CLI flag --cost-cap-story=X aplica override"
    - "Env FORGE_COST_CAP_PRD aplica override"
    - "Warn event emit em 80% do cap (story OU prd)"
    - "Test smoke: setar cap=$0.05, mock cost stream excedendo → 'cap_hit_story' emit + child SIGTERM called"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [FAP-001]
  estimateMinutes: 30
  touches:
    - src/lib/forge/cost-caps.ts
    - src/lib/forge/cost-caps.test.ts
    - src/lib/forge/orchestrator.ts
  agentProfile: wiring

- id: FAP-003
  title: Smoke gate tsc + rollback strategy
  description: |
    src/lib/forge/gates/smoke.ts: exporta runSmokeGate(runId, storyId, lastCommitSha).
    Returns { ok: boolean; output: string; rolledBack: boolean; commitReverted?: string }.
    1. Spawn `npx tsc --noEmit --incremental` no repo root, timeout configurável
       (default 60s via env FORGE_SMOKE_TIMEOUT_MS, override --smoke-timeout-ms)
    2. Captura stdout+stderr (concat, tail 500 chars no output field)
    3. Se exit 0: return { ok: true, output: '', rolledBack: false }
    4. Se exit != 0:
        a. Verifica `git log -1 --format=%s` matches pattern 'forge — <storyId>' (segurança)
        b. Se match: `git reset --hard HEAD~1`, `git worktree remove --force <path>`,
           emit smoke_fail + smoke_rollback, return { ok: false, rolledBack: true,
           commitReverted: lastCommitSha }
        c. Se não match: emit error 'rollback_aborted_safety_check', NÃO faz reset,
           return { ok: false, rolledBack: false }
    Flag --skip-smoke pula gate: emit warning event 'smoke_skipped', return { ok: true }.
  acceptanceCriteria:
    - "src/lib/forge/gates/smoke.ts exporta runSmokeGate"
    - "Default timeout 60s; override via FORGE_SMOKE_TIMEOUT_MS ou --smoke-timeout-ms"
    - "On tsc fail: verifica HEAD~1 message match 'forge — <storyId>' antes de reset"
    - "Safety check fail: emit 'rollback_aborted_safety_check', NÃO reset"
    - "Safety check pass + tsc fail: git reset --hard HEAD~1 + worktree remove"
    - "Output field: tail 500 chars do tsc output (stdout+stderr concat)"
    - "Flag --skip-smoke pula gate, emit smoke_skipped warning"
    - "Smoke success NÃO emit (silent ok); fail emit 'smoke_fail' + 'smoke_rollback'"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [FAP-002]
  estimateMinutes: 30
  touches:
    - src/lib/forge/gates/smoke.ts
    - src/lib/forge/gates/smoke.test.ts
    - src/lib/forge/orchestrator.ts
  agentProfile: wiring

- id: FAP-004
  title: HITL strategy switch (conservative/retry-once/full-auto)
  description: |
    src/lib/forge/hitl.ts: exporta:
      - type HitlStrategy = 'conservative' | 'retry-once' | 'full-auto'
      - type FailureCtx = { storyId; failureKind: 'smoke' | 'verifiable' | 'anti-pattern' | 'cost' | 'diff'; output?; consecutiveFailures: number; attemptIndex: number }
      - type HitlDecision = { action: 'stop' | 'retry' | 'continue'; diagnosticHint?: string }
      - applyStrategy(strategy: HitlStrategy, ctx: FailureCtx): HitlDecision
    Lógica:
      - conservative: action='stop' em qualquer fail (ignora kind)
      - retry-once (default): se attemptIndex < 2, action='retry' com diagnosticHint
        (= output tail + failureKind). Senão action='stop'.
      - full-auto: action='continue'; deixa FE-004 D21 (consecutiveFailures >= 2 mesma story)
        decidir pivot.
    Orchestrator (FE-004) persiste strategy em .forge/<runId>/meta.json no início do autorun.
    CLI flag: forge run <slug> --hitl=<conservative|retry-once|full-auto>.
    Default: retry-once.
    Retry: re-spawn worker mesma story com prompt header extra:
    'PREVIOUS ATTEMPT FAILED — diagnostic hint: <hint>'.
  acceptanceCriteria:
    - "src/lib/forge/hitl.ts exporta applyStrategy + tipos"
    - ".forge/<runId>/meta.json contém { hitlStrategy } no início do autorun"
    - "Default = retry-once se flag ausente"
    - "Retry-once: attemptIndex=1 retorna retry; attemptIndex=2 retorna stop"
    - "Conservative: qualquer fail retorna stop"
    - "Full-auto: sempre continue (deixa pivot decidir)"
    - "diagnosticHint inclui failureKind + tail output (limit 200 chars)"
    - "Retry header injetado no prompt do worker re-spawn"
    - "Event 'hitl_retry' emit no re-spawn com { storyId, attempt, diagnosticHint }"
    - "Event 'hitl_strategy_set' emit no início com { strategy }"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [FAP-003]
  estimateMinutes: 25
  touches:
    - src/lib/forge/hitl.ts
    - src/lib/forge/hitl.test.ts
    - src/lib/forge/orchestrator.ts
  agentProfile: wiring

- id: FAP-005
  title: Diff size + touches mismatch reporters
  description: |
    src/lib/forge/gates/diff-review.ts: exporta runDiffReview(runId, storyId, story).
    Returns { ok: boolean; oversize: boolean; mismatches: string[]; stats: { loc, files, newFiles, modifiedFiles } }.
    1. `git diff joao-dev...HEAD --stat` → parse último line para extrair LOC + files count
    2. Se loc > maxLoc OR files > maxFiles:
        - oversize=true → emit 'diff_oversize_review_needed' + orchestrator marca run
          status='needs-human-review' (pausa, não fail)
    3. `git diff --name-only --diff-filter=A joao-dev...HEAD` → arquivos NEW (created)
    4. Compara newFiles com story.touches[]:
        - newFiles NOT in story.touches → mismatches[]
        - mismatches.length > 0 → emit 'touches_mismatch' warning (NÃO bloqueia)
    5. Adicione mismatches + stats no próximo memory entry (campo diffStats)
    Defaults: maxLoc=500, maxFiles=20. Override via --max-loc, --max-files
    ou env FORGE_MAX_LOC / FORGE_MAX_FILES.
    Modified files NÃO entram em mismatch (silencia ruído de import autoedit).
  acceptanceCriteria:
    - "src/lib/forge/gates/diff-review.ts exporta runDiffReview"
    - "oversize=true se loc>500 OR files>20 (defaults)"
    - "Mismatches: SÓ arquivos novos (--diff-filter=A), não edits"
    - "Pause em oversize: orchestrator marca run status='needs-human-review' e não pega próxima story"
    - "touches_mismatch event lista expected + actual + extraCreated"
    - "Memory entry inclui diffStats: { loc, files, mismatches }"
    - "Flags --max-loc, --max-files override defaults"
    - "Env FORGE_MAX_LOC override default"
    - "Mismatches.length=0: NÃO emit (silent)"
    - "Test: story.touches=[a.ts], worker criou a.ts + b.ts → mismatches=['b.ts']"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [FAP-004]
  estimateMinutes: 25
  touches:
    - src/lib/forge/gates/diff-review.ts
    - src/lib/forge/gates/diff-review.test.ts
    - src/lib/forge/orchestrator.ts
  agentProfile: wiring

- id: FAP-006
  title: Autopilot CLI flag surface + UI Memory tab + E2E smoke + docs
  description: |
    1. CLI scripts/forge/cli.ts ganha flags em `forge run`:
       --hitl=<conservative|retry-once|full-auto>
       --cost-cap-story=<usd>, --cost-cap-prd=<usd>
       --max-loc=<n>, --max-files=<n>
       --skip-smoke, --smoke-timeout-ms=<n>
       Defaults documentados em --help.
    2. POST /api/forge/runs (FE-014) extension: aceita body fields acima
       (Zod schema atualizado em src/lib/forge/api-schemas.ts).
    3. UI: aba "Memory" no PRD detail render via existing tab pattern
       (similar a Diff em FE-011). Source: SSE eventos kind starts with 'memory_'
       ou polling fallback no .forge/<runId>/memory.jsonl via existing
       /api/forge/runs/[id]/stream.
       Component: src/app/(dashboard)/forge/_components/memory-tab.tsx.
       Lista MemoryEntry como Card por story, com chips de status.
    4. Smoke E2E em package.json script test:autopilot-e2e:
       cria PRD seed mockado com 3 stories (1 ok, 1 oversized, 1 cost-runaway).
       Roda autorun com defaults → asserta: story 2 pausa em needs-human-review,
       story 3 (com --cost-cap-story=$0.01) killed.
    5. Docs: append em docs/runbooks/forge-runbook.md seção "Autopilot gates"
       (3-4 parágrafos): o que são os 5 gates, ordem de execução, como tunar
       defaults, como debug eventos via events.jsonl.
  acceptanceCriteria:
    - "forge run --help lista todas as flags (--hitl, --cost-cap-story, --cost-cap-prd, --max-loc, --max-files, --skip-smoke, --smoke-timeout-ms)"
    - "src/lib/forge/api-schemas.ts Zod schema aceita os campos novos"
    - "src/app/(dashboard)/forge/_components/memory-tab.tsx renderiza memory.jsonl entries"
    - "Tab Memory aparece no PRD detail (extending FE-010 tabs)"
    - "Smoke script:test:autopilot-e2e roda sem erro fatal"
    - "Smoke: cap=$0.01 → 'cap_hit_story' event presente em events.jsonl do run"
    - "Smoke: max-loc=10 → 'diff_oversize_review_needed' event presente"
    - "docs/runbooks/forge-runbook.md ganha seção 'Autopilot gates' (≥3 parágrafos)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "npx tsx scripts/forge/cli.ts run --help 2>&1 | grep -cE 'hitl|cost-cap-story|max-loc'"
      expected: "≥ 3"
  dependsOn: [FAP-005]
  estimateMinutes: 30
  touches:
    - scripts/forge/cli.ts
    - src/lib/forge/api-schemas.ts
    - src/app/(dashboard)/forge/_components/memory-tab.tsx
    - package.json
    - docs/runbooks/forge-runbook.md
  agentProfile: wiring
```

---

```
╔════════════════════════════════════════════════════════════╗
║  END OF PRD · Autopilot ganha cinto-e-suspensórios.        ║
║  Engine roda. Gates verificam. Builder dorme tranquilo.    ║
╚════════════════════════════════════════════════════════════╝
```
