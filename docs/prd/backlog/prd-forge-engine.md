```
  ███████╗ ██████╗ ██████╗  ██████╗ ███████╗
  ██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝
  █████╗  ██║   ██║██████╔╝██║  ███╗█████╗
  ██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝
  ██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗
  ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝
        ENGINE · v1 · forge-engine
```

# PRD — Forge Engine (Ralph → Forge fusion)

> Status: `backlog` · Owner: João · Created: 2026-05-30 · Target: 1-2 loops Ralph

---

## 1 · Problema

Hoje o Volund tem **dois sistemas de "agent factory" que não se conversam**:

- **Forge** (`src/app/(dashboard)/forge/*`, 4 tabelas Supabase, UI HUD arcade): observatório de execução agêntica **sem motor real**. Mock storyline roda em loop scriptado — toda a UI é mentira sobre dados que não existem. Fases 1-8 LOCKED, mas a Fase 11 ("Realtime source") nunca foi implementada porque ninguém gera ForgeEvent de verdade.

- **Ralph** (`scripts/ralph/*.sh`, filesystem-as-state): loop autônomo real que executa PRDs via `claude -p` fresh-context. Já entregou ~30 commits funcionais (CTXIMP, CTXSRC). Mas **não tem UI** — observabilidade é `tail -f log.txt`. Sem custo telemetria, sem paralelismo, sem rollback atômico.

A pirâmide de abstrações pra entregar uma feature é alta demais: **Ideia → PRD humano (60min, 16 seções) → §16 stories → prd.json (manual) → iter → commit**. PRDs viraram um culto de certeza que o repo desmente — Ralph descobriu que `Meeting.date ≠ startsAt`, `can_view_project` tem 1 param e não 2, todas afirmadas erradas em PRDs aprovados.

**Fonte de cada problema:**
- Forge runbook §0: "A FORGE é suficiente porque está plugada nos melhores modelos" — mas hoje está plugada em script de mock
- Ralph `scripts/ralph/CLAUDE.md`: nenhum mecanismo de observabilidade ou cost tracking
- `docs/prd/in-progress/prd-context-source-unified.md`: PRD com DDL fantasy desmentida pela iter 5 do próprio Ralph

## 2 · Solução em uma frase

**Forge ganha motor real (Ralph) e Ralph ganha face (Forge UI), unificados num único pipeline `Spec.md → Stories geradas → ForgeTask paralela em worktrees → ForgeEvent realtime → commit + UI live`.**

## 3 · Não-objetivos

- ❌ **Cloud/remote runner** — localhost-first, sem servidor de execução. Phase ∞.
- ❌ **Multi-tenant** — 1 dev por laptop, sem queue compartilhada entre devs.
- ❌ **Substituir Vitor/Vitoria/Alpha** — eles continuam como agentes upstream que produzem Specs.
- ❌ **Reescrever Forge UI** — preservar todas as Fases LOCKED (1-8) da Forge atual; só plugar em dados reais.
- ❌ **Dashboard de custo histórico web** — `forge ps` no terminal + UI live bastam pra v1.
- ❌ **Branching de subagent** (sub-sub-agent árvores N>2) — fica pra Fase ∞ do runbook Forge.
- ❌ **Sumarizar progress.txt automaticamente** — gerenciamento manual basta.
- ❌ **Migration de PRDs existentes pro novo formato Spec.md** — coexistem; PRDs em `docs/prd/{ready,in-progress,blocked}/` continuam rodando via Ralph atual até o fim natural.

## 4 · Personas e jornada

**Charles (CTO, escreve specs):**
> "Tenho uma ideia de feature. Hoje eu gasto 60min escrevendo PRD com DDL e RLS que provavelmente está errado. Quero gastar 5min descrevendo a intenção e deixar o sistema descobrir o resto."

**Builder dev (executa runs):**
> "Quero abrir `/forge`, ver as 5 specs em execução simultânea no laptop, ver token-by-token o que cada agente está fazendo, e poder matar um run que tá desviando do escopo sem perder os outros."

**Vitor (agente upstream, futuro):**
> "Termino uma Design Session com 3 stories aprovadas. Devo emitir uma `Spec.md` pra cada story (não uma só pra todas) e jogar no Forge — daí o Forge cuida do resto."

## 5 · Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | **Forge passa a executar via Ralph engine, sem fork**. Mock storyline morre na FE-010. | Eliminar duplicidade. Forge UI ganha o backend que sempre precisou. |
| D2 | **ForgeTask = Story** (1:1, mesma row). Adicionar coluna `specId` no `ForgeTask`. | Elimina conversão Story↔ForgeTask. Nomenclatura unificada. |
| D3 | **Spec.md (5 seções) substitui PRD pesado** pra entradas novas. Schema: goal, anchors, constraints, success-signals, non-goals. | Reduz fricção de 60min → 5min. PRDs existentes não migram (coexistem). |
| D4 | **Stories são geradas em iter-0 via plan-mode**, não escritas. Humano aprova DAG antes de exec. | LLM lendo repo + spec > humano lembrando do repo. Plan-mode dá checkpoint barato. |
| D5 | **Worktree por ForgeTask** via `Agent` tool com `isolation:"worktree"`. Stories independentes rodam em paralelo. Merge serializa no orchestrator. | Paralelismo real + rollback atômico (`git worktree remove`). |
| D6 | **`agentProfile: 'db'\|'api'\|'ui'\|'wiring'\|'test'\|'doc'`** por ForgeTask. Cada profile injeta system prompt + skills + memories específicos. | UI agent que ignora `project_ui_patterns.md` é o erro mais caro do Ralph atual. |
| D7 | **ForgeEvent emitido por hooks Claude Code** (`PostToolUse`, `Stop`, `SubagentStop`). Hook escreve em arquivo `.forge/events.jsonl`; watcher Node faz upload pro Supabase. | Não invade prompt. Eventual consistency aceitável. |
| D8 | **Filesystem é state durante o loop; Supabase é state persistido.** `.forge/<run-id>/` é working dir transitório; ao closeout, eventos viram permanentes no DB. | Local rápido + auditoria long-term sem latência. |
| D9 | **Humano nos extremos** preservado: aprova Spec antes do plan; aprova plan antes do run; aprova merge final. Loop autônomo só entre esses gates. | Confiança no autônomo cresce com gates explícitos, não com supervisão contínua. |
| D10 | **Localhost-only.** Orchestrator é processo Node local. Claude Code roda no laptop. Sem auth, sem cloud, sem Docker. | YAGNI. Phase ∞ pra cloud. |
| D11 | **CLI + UI vivem em paralelo**, mesmo state model. CLI = `forge {init\|plan\|run\|ps\|kill\|done}`. UI = `/forge` existente. | Power user no terminal; demo + observability na UI. |
| D12 | **Commit convention**: `ZRD-JM-NN: forge — <task-id> — <slug>`. Memory `feedback_commit_convention.md` respeitada. | Acabar com a dupla língua (`ralph(...)` vs `ZRD-JM-NN`) no git log. |
| D13 | **Cost tracking via `claude -p --output-format=stream-json`**. Hook parser extrai usage + cost por iter. | Claude Code já retorna isso; só precisamos consumir. |
| D14 | **Iter-0 (planner) usa modelo barato (Haiku 4.5)**; iter de execução usa profile-default (Opus 4.7 pra ui/api; Sonnet 4.6 pra db/test). | Plan é leitura + DAG; execução é raciocínio + edição. Custo otimizado. |
| D15 | **Spec.md vive em `docs/specs/<slug>.md`**, NÃO em `docs/prd/`. Estados em filesystem: `specs/{draft,active,done,archive}/`. | Não polui o pipeline PRD legado. |

## 6 · Arquitetura

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            FILESYSTEM (local)                            │
│                                                                          │
│  docs/specs/active/<slug>.md           ← humano escreve, 5 seções        │
│  .forge/<run-id>/                      ← working dir transitório         │
│    ├── plan.jsonl                      ← stories.jsonl gerado iter-0     │
│    ├── events.jsonl                    ← append-only por hook            │
│    ├── tasks/<task-id>/                ← 1 dir por ForgeTask             │
│    │   ├── worktree/                   ← git worktree isolado            │
│    │   ├── transcript.jsonl            ← claude -p stream-json output    │
│    │   └── cost.json                   ← usage agregado                  │
│    └── orchestrator.pid                ← lock pra evitar 2 orchs no run  │
└────────────────┬─────────────────────────────────────────────────────────┘
                 │
                 │ watcher (chokidar) faz upload
                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            SUPABASE (permanente)                         │
│                                                                          │
│  ForgeSpec        ← nova tabela (1 row por spec.md)                      │
│  ForgeRun         ← existente, adiciona costUsd, specId                  │
│  ForgeTask        ← existente, adiciona agentProfile, worktreePath       │
│  ForgeAgent       ← existente, sem mudança                               │
│  ForgeEvent       ← existente, sem mudança                               │
│                                                                          │
│  realtime: ALTER PUBLICATION supabase_realtime ADD TABLE ForgeSpec       │
└────────────────┬─────────────────────────────────────────────────────────┘
                 │ realtime postgres_changes
                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            FORGE UI (Next.js)                            │
│                                                                          │
│  /forge                          ← hub, lista runs ativos no laptop      │
│  /forge/[projectId]              ← observatório (já existe)              │
│  /forge/specs/[slug]             ← visualização da spec + DAG plan       │
│  TaskSheet                       ← Mind/Tools/Metrics + nova aba "Diff"  │
└──────────────────────────────────────────────────────────────────────────┘

       Orchestrator (Node TS local)             Workers (claude -p)
       ──────────────────────                   ─────────────────────
       1. Lê spec.md                            spawned por orquestrador
       2. Spawn iter-0 (plan mode)              em worktree isolado
       3. Apresenta DAG (Spec UI)               profile-aware prompt
       4. Aguarda approve via CLI/UI            hooks emitem events
       5. Spawn workers paralelos               retornam diff + commit
       6. Watch ready signals                   worktree merge serializado
       7. Merge tasks atomicamente
       8. Move spec pra done/
       9. Abre PR via gh

       Inputs externos:                         Outputs externos:
       - DS completion (futuro)                 - git commits joao-dev
       - CLI direta                             - PR pros 2 remotes
       - UI "+ New Spec"                        - ForgeEvent realtime
```

**Componentes (cada caixa = arquivo/serviço real):**

| Componente | Path | Responsabilidade |
|---|---|---|
| Spec validator | `src/lib/forge/spec/validator.ts` | Lê spec.md, valida schema 5-seções, retorna AST |
| Planner | `src/lib/forge/planner.ts` | Chama `claude -p` em plan-mode com spec+repo, parseia stories.jsonl |
| Orchestrator | `src/lib/forge/orchestrator.ts` (Node CLI) | Loop principal: pick task → spawn worker → watch → merge |
| Worker spawner | `src/lib/forge/worker.ts` | `Agent` tool wrapper com worktree isolation + subagent_type |
| Hook handlers | `.claude/hooks/forge-event-emit.ts` | PostToolUse/Stop emit ForgeEvent em events.jsonl |
| Event watcher | `src/lib/forge/event-uploader.ts` | chokidar watch + Supabase insert |
| CLI | `scripts/forge/cli.ts` | Comandos `init/plan/run/ps/kill/done` |
| Forge UI Hub update | `src/app/(dashboard)/forge/page.tsx` | Já existe, switch mock → real source |
| TaskSheet Diff tab | `src/app/(dashboard)/forge/_components/task-sheet/diff-tab.tsx` | Nova aba, mostra diff acumulado da worktree |

## 7 · Schema (DDL + migrations atômicas)

**Migration 1 — Criar `ForgeSpec`:**

```sql
-- supabase/migrations/20260530a_create_forge_spec.sql
CREATE TABLE "ForgeSpec" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"     uuid REFERENCES "Project"(id) ON DELETE CASCADE,
  slug            text NOT NULL UNIQUE,
  path            text NOT NULL,           -- ex: docs/specs/active/forge-engine.md
  goal            text NOT NULL,           -- §1 do spec
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','active','planning','running','done','archived')),
  "specHash"      text NOT NULL,           -- sha256 do .md, pra cache de plan
  "createdBy"     uuid NOT NULL REFERENCES "Member"(id),
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "ForgeSpec_project_idx" ON "ForgeSpec"("projectId", "createdAt" DESC);
CREATE INDEX "ForgeSpec_status_idx" ON "ForgeSpec"(status);

ALTER TABLE "ForgeSpec" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ForgeSpec_select" ON "ForgeSpec"
  FOR SELECT USING (
    public.is_manager()
    OR "projectId" IS NULL  -- specs sem projeto: todo Builder vê
    OR public.can_view_project("projectId")
  );

CREATE POLICY "ForgeSpec_mutate" ON "ForgeSpec"
  FOR ALL USING (
    public.is_manager()
    OR "createdBy" = (auth.jwt() ->> 'sub')::uuid
    OR ("projectId" IS NOT NULL AND public.can_edit_tasks("projectId"))
  ) WITH CHECK (
    public.is_manager()
    OR "createdBy" = (auth.jwt() ->> 'sub')::uuid
    OR ("projectId" IS NOT NULL AND public.can_edit_tasks("projectId"))
  );

ALTER PUBLICATION supabase_realtime ADD TABLE "ForgeSpec";
```

**Migration 2 — Adicionar campos no `ForgeTask`:**

```sql
-- supabase/migrations/20260530b_forge_task_engine_fields.sql
ALTER TABLE "ForgeTask"
  ADD COLUMN "specId"        uuid REFERENCES "ForgeSpec"(id) ON DELETE SET NULL,
  ADD COLUMN "agentProfile"  text CHECK ("agentProfile" IN
                             ('db','api','ui','wiring','test','doc')),
  ADD COLUMN "worktreePath"  text,
  ADD COLUMN "dependsOn"     uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN "verifiable"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "passes"        boolean NOT NULL DEFAULT false;

CREATE INDEX "ForgeTask_spec_idx" ON "ForgeTask"("specId");
CREATE INDEX "ForgeTask_profile_idx" ON "ForgeTask"("agentProfile");
```

**Migration 3 — Adicionar `costUsd` agregado em `ForgeRun`:**

```sql
-- supabase/migrations/20260530c_forge_run_cost_agg.sql
ALTER TABLE "ForgeRun"
  ADD COLUMN "costUsdTotal"    numeric(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "tokensInTotal"   bigint NOT NULL DEFAULT 0,
  ADD COLUMN "tokensOutTotal"  bigint NOT NULL DEFAULT 0,
  ADD COLUMN "specId"          uuid REFERENCES "ForgeSpec"(id) ON DELETE SET NULL;

CREATE INDEX "ForgeRun_spec_idx" ON "ForgeRun"("specId");
```

**Migration 4 — Trigger que agrega cost de tasks pro run:**

```sql
-- supabase/migrations/20260530d_forge_cost_aggregate_trigger.sql
CREATE OR REPLACE FUNCTION public.forge_run_recompute_cost(p_run_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE "ForgeRun" SET
    "costUsdTotal"    = COALESCE((SELECT SUM("costUsd")    FROM "ForgeTask" WHERE "runId" = p_run_id), 0),
    "tokensInTotal"   = COALESCE((SELECT SUM("tokensIn")   FROM "ForgeTask" WHERE "runId" = p_run_id), 0),
    "tokensOutTotal"  = COALESCE((SELECT SUM("tokensOut")  FROM "ForgeTask" WHERE "runId" = p_run_id), 0)
  WHERE id = p_run_id;
$$;

CREATE OR REPLACE FUNCTION public.forge_task_cost_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."runId" IS NOT NULL THEN
    PERFORM public.forge_run_recompute_cost(NEW."runId");
  END IF;
  RETURN NEW;
END$$;

CREATE TRIGGER "ForgeTask_cost_propagate"
AFTER INSERT OR UPDATE OF "costUsd","tokensIn","tokensOut" ON "ForgeTask"
FOR EACH ROW EXECUTE FUNCTION public.forge_task_cost_trigger();
```

**Pós-migration**: regenerar `src/lib/supabase/database.types.ts` via `npm run db:types`.

## 8 · APIs

| Método | Path | Async? | Contrato |
|---|---|---|---|
| POST | `/api/forge/specs` | sync | `{slug, projectId?, path}` → `{id, specHash}` |
| GET | `/api/forge/specs/:id` | sync | → `{spec, plan?, runs[]}` |
| POST | `/api/forge/specs/:id/plan` | **async (202+jobId)** | `{useCache: boolean}` → 202 jobId; poll em `/api/jobs/:jobId` retorna `{stories[], dag}` |
| POST | `/api/forge/specs/:id/approve-plan` | sync | `{planVersion: int}` → muda spec.status='running' |
| POST | `/api/forge/runs` | **async (202+jobId)** | `{specId, maxIter?}` → 202 jobId, run spawned async |
| GET | `/api/forge/runs/:id` | sync | → `{run, tasks[], agents[]}` |
| POST | `/api/forge/runs/:id/kill` | sync | → `{killed: bool}` |
| POST | `/api/forge/tasks/:id/retry` | **async** | → 202 jobId |
| GET | `/api/forge/tasks/:id/diff` | sync | → `{patch: string, files[]}` |
| GET | `/api/jobs/:jobId` | sync | → `{status, result?}` |

**Eventos emitidos (via realtime):**

| Channel | Trigger |
|---|---|
| `ForgeSpec:*` | INSERT/UPDATE de spec |
| `ForgeRun:*` | status change |
| `ForgeTask:*` | status/progress/cost change |
| `ForgeEvent:*` | append (thought/tool/status/done) |

## 9 · UX

**Tela 1 — `/forge` Hub (atualização)**

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚒  FORGE        ──  3 runs ativos  ──  $4.27 hoje  ──  [+ New]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📋  context-source-unified           ████████░░░░  8/15  $1.20    │
│      4 tasks running · ARCHITECT · DB · API · UI                    │
│                                                                     │
│  📋  forge-engine                     ██████░░░░░░  6/12  $2.85    │
│      3 tasks running · DB · WIRING · UI                             │
│                                                                     │
│  📋  mobile-layout-pass               queued                $0.00   │
│      not started                                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Tela 2 — `/forge/specs/[slug]` (nova)**

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚒  Spec · forge-engine                              [Approve Plan] │
├─────────────────────────────────────────────────────────────────────┤
│  Goal: Forge ganha motor real (Ralph) e Ralph ganha face            │
│                                                                     │
│  ── Generated DAG (12 stories) ─────────────────────────────────    │
│                                                                     │
│  FE-001 ──┬── FE-002 ──┬── FE-004 ─── FE-007 ──┐                    │
│           │            │                        ├── FE-010 ─── ...  │
│           └── FE-003   └── FE-005 ─── FE-006 ──┘                    │
│                                                                     │
│  Ready to claim: FE-001 (doc, 25min)                                │
│  Profile distribution: 5 wiring · 3 ui · 2 db · 2 doc               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Tela 3 — TaskSheet com aba "Diff" (atualização)**

```
┌─────────────────────────────────────────────────────────────────────┐
│  #007  hook emite ForgeEvent           wiring · running · 0:23     │
│                                          ──── tokens ─── cost ──    │
│                                            842/2.1k    $0.12        │
├─────────────────────────────────────────────────────────────────────┤
│  [Mind]  [Tools]  [Metrics]  [Diff]                                 │
│                                                                     │
│  +++ .claude/hooks/forge-event-emit.ts                              │
│  + import { writeFileSync, appendFileSync } from "fs";              │
│  + export async function onPostToolUse(input) {                     │
│  +   appendFileSync(eventsPath(input.runId), JSON.stringify({...})) │
│  + }                                                                │
│                                                                     │
│  +++ supabase/migrations/20260530b_forge_task_engine_fields.sql     │
│  + ALTER TABLE "ForgeTask" ADD COLUMN "agentProfile" text...        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 10 · Integrações

| Sistema | Integração | Direção |
|---|---|---|
| Claude Code CLI | `claude -p` spawn via `Agent` tool com `subagent_type` + `isolation:"worktree"` | Ralph → Claude |
| Supabase Realtime | postgres_changes em 5 tabelas Forge | DB → UI |
| Git | `git worktree add/remove`, `gh pr create` | Orchestrator → Git |
| Design Session | Trigger Postgres em DS.status='completed' (futuro, fase ∞) | DS → Forge |
| Vitor | Endpoint que Vitor chama pra criar `ForgeSpec` (futuro, fase ∞) | Vitor → Forge |
| Composio | Nenhum (irrelevante neste PRD) | — |
| Memory system | UI agent profile lê `memory/project_ui_patterns.md` automaticamente | Profile → Worker |

## 11 · Faseamento

**Fase 1 — Engine core (FE-001 a FE-008)**: spec parser, planner, orchestrator, worker, hooks, cost tracking. CLI mínima. Forge UI continua em mock. **Entrega: rodar uma spec inteira no terminal, fim a fim, paridade funcional com Ralph atual.**

**Fase 2 — UI plugada (FE-009 a FE-012)**: Forge UI consome dados reais (não mock). TaskSheet ganha aba Diff. CLI ganha comando `done` que abre PR. **Entrega: demo visual de uma spec rodando em paralelo no laptop.**

**Fase 3 — Migração soft (post-merge, não neste PRD)**: documentar Ralph atual como deprecated, atualizar `AGENTS.md`, mover skill `/ralph` pra `/forge`. Apagar `scripts/ralph/*.sh`.

**Fase ∞ — Ambição futura**: DS → Spec auto-trigger, Vitor produz specs, multi-projeto paralelo, cloud runner.

**Fase 1 entrega mais que o sistema atual** porque (a) paralelismo real via worktree (Ralph atual é serial), (b) cost telemetry (Ralph atual não tem), (c) profile specialization (Ralph atual é genérico). Fase 2 entrega visibilidade que nem Ralph nem Forge tinham.

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Hook do Claude Code não dispara confiável em `claude -p` | Média | Alta | Hook escreve em arquivo local first; uploader é eventual consistency. Fallback: parsing de stdout stream-json. |
| Worktrees em paralelo geram merge conflicts ao final | Alta | Alta | Merge serializa no orchestrator (queue). Conflito = task vira `error`, humano resolve no checkpoint. Stories independentes (sem `dependsOn` comum) raramente tocam mesmos arquivos por design. |
| Plan-mode iter-0 produz DAG ruim (stories grandes demais ou cíclicas) | Média | Alta | Validador rejeita: `estimateMinutes > 30` ou ciclo no DAG. Humano aprova antes de exec. Cache de plan por specHash. |
| `agentProfile=ui` ainda ignora `project_ui_patterns.md` | Média | Alta | System prompt do profile injeta memory inline (não link). Verifiable check: grep no diff por `ResponsiveSheet`/`Field` quando há modal/form. |
| Cost telemetry desliga porque Claude Code mudou output format | Baixa | Médio | Adapter pattern em `cost-parser.ts`. Lock em versão min do `@anthropic-ai/claude-code`. |
| Supabase upload assíncrono cria gap visual no UI | Média | Médio | Buffer local na store frontend; renderiza eventos local-first, reconcile com server. Padrão já existe no `ForgeStore`. |
| `ForgeTask.dependsOn uuid[]` + DAG topological em SQL fica lento | Baixa | Médio | Cache DAG em memória do orchestrator. Recompute só na criação. |
| 2 orchestrators rodando no mesmo run = race | Média | Catastrófico | `orchestrator.pid` lock file; CLI `forge ps` detecta zumbis. |
| Migration 2 (ALTER ForgeTask) trava prod no deploy | Baixa | Alto | `ADD COLUMN ... DEFAULT` com defaults inlinetes em Postgres 11+ é instant. Validado. |
| Convenção de commit do worker mudar (esquecer prefix) | Média | Baixo | Hook PreCommit valida pattern `^ZRD-JM-\d+: forge —`. |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| Spec → first commit (tempo) | `ForgeRun.startedAt - ForgeSpec.createdAt`, query SQL | < 10min p50 |
| Stories passes rate por run | `SELECT count(*) FILTER (WHERE passes) * 100.0 / count(*) FROM ForgeTask WHERE runId=?` | ≥ 80% |
| Cost p99 por task | `percentile_cont(0.99) WITHIN GROUP (ORDER BY costUsd) FROM ForgeTask` | < $0.50 |
| Cost total por spec | `SELECT SUM("costUsdTotal") FROM ForgeRun WHERE specId=?` | < $5 p50 |
| Worktree merge conflict rate | `SELECT count(*) FILTER (WHERE status='error' AND meta->>'failure'='merge_conflict') / count(*) FROM ForgeTask` | < 10% |
| UI render budget mantido | `window.__forgeMetrics.render_ms_p95` (Fase 13 do runbook atual) | ≤ 4ms |
| Paralelismo efetivo | `max(concurrent ForgeTask status='running' por run)` via histograma | ≥ 3 |
| Spec authoring time (autorrelato) | Form opcional pós-merge, salva em `meta.specAuthoringMinutes` | < 10min p50 |
| Forge UI hub bounce rate | Google Analytics `/forge` page time-on-page | > 60s |

## 14 · Open questions

- **OQ1**: Modelo do iter-0 (planner) — Haiku 4.5 dá conta de DAG-gen com qualidade? Validar na FE-002. *(decide na Fase 1)*
- **OQ2**: Hooks do Claude Code — versão atual permite hook customizado por `Agent` spawn? Confirmar API antes de FE-007. *(decide na Fase 1)*
- **OQ3**: Spec.md schema final — 5 seções é suficiente? Ou precisamos de §6 "deps externas" pra Composio/Supabase auth configs? *(decide na FE-001)*

## 15 · Referências

- **Forge runbook**: [docs/runbooks/forge-runbook.md](../../runbooks/forge-runbook.md)
- **Ralph runbook**: [docs/runbooks/ralph-process.md](../../runbooks/ralph-process.md)
- **Ralph skill**: [.claude/skills/ralph/SKILL.md](../../../.claude/skills/ralph/SKILL.md)
- **Forge sandbox app**: [src/app/(dashboard)/forge/](../../../src/app/(dashboard)/forge/)
- **Forge store/types**: [src/lib/forge/](../../../src/lib/forge/)
- **UI patterns memory**: `memory/project_ui_patterns.md`
- **Commit convention memory**: `memory/feedback_commit_convention.md`
- **Last successful Ralph run (proof of concept)**: commit `85bd145` (CTXSRC-010), 10/10 streak

## 16 · Stories implementáveis

```yaml
- id: FE-001
  title: Spec.md schema + parser + validator
  description: |
    Define schema canônico do spec.md (5 seções: goal, anchors, constraints,
    success-signals, non-goals) em Zod. Parser TS que lê .md → AST. Validator
    com erros úteis (linha + coluna). CLI `forge spec validate <path>`.
  acceptanceCriteria:
    - "src/lib/forge/spec/schema.ts exporta SpecSchema (Zod) e parseSpec(path: string): Spec"
    - "src/lib/forge/spec/validator.ts: validateSpec(path) retorna { ok, errors[], spec? }"
    - "scripts/forge/cli.ts ganha subcomando 'spec validate <path>' que exit 0 se ok, 1 se errors"
    - "Erros incluem line:col da seção que falhou"
    - "Spec exemplo em docs/specs/example.md passa validação"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "node scripts/forge/cli.js spec validate docs/specs/example.md"
      expected: "exit 0, prints ✓"
  dependsOn: []
  estimateMinutes: 25
  touches: [src/lib/forge/spec/schema.ts, src/lib/forge/spec/validator.ts, scripts/forge/cli.ts, docs/specs/example.md]
  agentProfile: doc

- id: FE-002
  title: Iter-0 planner (spec → stories.jsonl via plan-mode)
  description: |
    Função planner(spec): spawns claude -p com prompt que lê spec + scaneia repo
    relevante (via anchors) e produz stories.jsonl válido. Usa plan-mode flag.
    Output: array de stories com id, title, deps, verifiable, agentProfile,
    estimateMinutes, touches. Valida DAG sem ciclo. Rejeita story > 30min.
  acceptanceCriteria:
    - "src/lib/forge/planner.ts exporta plan(specPath): Promise<{stories, dag}>"
    - "Stories válidas conforme StorySchema (subset de FE-001 schema)"
    - "Detecta ciclo no dependsOn e retorna erro com lista de ids no ciclo"
    - "Estimate > 30 vira erro com nome da story"
    - "CLI 'forge plan <slug>' invoca e grava em .forge/<slug>/plan.jsonl"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "node scripts/forge/cli.js plan example && cat .forge/example/plan.jsonl | jq '.[0].id'"
      expected: "string non-empty"
  dependsOn: [FE-001]
  estimateMinutes: 30
  touches: [src/lib/forge/planner.ts, scripts/forge/cli.ts]
  agentProfile: wiring

- id: FE-003
  title: Migration — ForgeSpec table + ForgeTask new fields + cost agg
  description: |
    4 migrations atômicas (uma por arquivo) conforme §7. Roda via psql DIRECT_URL.
    Regenera database.types.ts. Smoke RLS com 2 usuários.
  acceptanceCriteria:
    - "supabase/migrations/20260530a_create_forge_spec.sql aplicado, tabela ForgeSpec existe"
    - "supabase/migrations/20260530b_forge_task_engine_fields.sql adicionou specId, agentProfile, worktreePath, dependsOn, verifiable, passes em ForgeTask"
    - "supabase/migrations/20260530c_forge_run_cost_agg.sql adicionou costUsdTotal, tokensInTotal, tokensOutTotal, specId em ForgeRun"
    - "supabase/migrations/20260530d_forge_cost_aggregate_trigger.sql criou trigger funcional"
    - "src/lib/supabase/database.types.ts contém ForgeSpec + novos campos"
    - "RLS smoke: usuário sem ProjectAccess não consegue SELECT em ForgeSpec do projeto X"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.tables WHERE table_name='ForgeSpec'"
      expected: "1"
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.columns WHERE table_name='ForgeTask' AND column_name IN ('specId','agentProfile','worktreePath','dependsOn','verifiable','passes')"
      expected: "6"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 25
  touches: [supabase/migrations/20260530a_create_forge_spec.sql, supabase/migrations/20260530b_forge_task_engine_fields.sql, supabase/migrations/20260530c_forge_run_cost_agg.sql, supabase/migrations/20260530d_forge_cost_aggregate_trigger.sql, src/lib/supabase/database.types.ts]
  agentProfile: db

- id: FE-004
  title: Orchestrator TS local (substitui ralph.sh)
  description: |
    Node CLI service local. Lê .forge/<run-id>/plan.jsonl, pega tasks ready
    (deps satisfeitas + sem worker ativo), spawn workers paralelos (até maxConcurrency),
    aguarda completion, merge worktree serializado, atualiza Supabase via DAL.
    Lock via orchestrator.pid. Limit padrão: 3 paralelos.
  acceptanceCriteria:
    - "src/lib/forge/orchestrator.ts exporta runOrchestrator({specId, maxConcurrency=3})"
    - "Lock pid em .forge/<run-id>/orchestrator.pid impede 2 instâncias"
    - "Pick task: ready (passes=false, deps todos passes=true) + lex order como tiebreak"
    - "Merge serializado: enquanto worktree A faz merge, worktree B espera"
    - "Falha de task não derruba o run; conta como error e segue próximas ready"
    - "Suporta SIGINT graceful: termina workers ativos, marca status='aborted'"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "node scripts/forge/cli.js run example --dry-run"
      expected: "lista de tasks a executar, sem spawnar"
  dependsOn: [FE-002, FE-003]
  estimateMinutes: 30
  touches: [src/lib/forge/orchestrator.ts, src/lib/forge/dal/run.ts, scripts/forge/cli.ts]
  agentProfile: wiring

- id: FE-005
  title: Worker spawn via Agent + isolation worktree
  description: |
    Função spawnWorker(task) que usa Claude Code Agent tool com isolation='worktree'
    e subagent_type baseado em task.agentProfile. Worktree path padrão:
    .forge/<run-id>/tasks/<task-id>/worktree. Branch: forge/<run-id>/<task-id>.
    Worker recebe prompt customizado por profile (FE-006). Output: { commitSha, diffPath, cost }.
  acceptanceCriteria:
    - "src/lib/forge/worker.ts exporta spawnWorker(task: ForgeTask): Promise<WorkerResult>"
    - "Worktree é criado em .forge/<run-id>/tasks/<task-id>/worktree antes do spawn"
    - "Branch nomeado forge/<run-id>/<task-id> criado limpo de joao-dev"
    - "Após commit no worktree, é mergeable em joao-dev (sem conflito interno do worker)"
    - "Falha de worker remove worktree mas preserva log em .forge/<run-id>/tasks/<task-id>/error.log"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "git worktree list | grep .forge"
      expected: "list contains worktree paths after a test run"
  dependsOn: [FE-004]
  estimateMinutes: 25
  touches: [src/lib/forge/worker.ts]
  agentProfile: wiring

- id: FE-006
  title: Subagent profiles (db/api/ui/wiring/test/doc) com prompts injetados
  description: |
    Cada profile tem um system prompt customizado (src/lib/forge/profiles/<name>.ts)
    que injeta: memories relevantes (ui → project_ui_patterns.md, db → Supabase rules),
    skills disponíveis (db → supabase MCP, ui → render checklist), tom + constraints.
    Worker (FE-005) carrega profile.systemPrompt e passa pro Agent.
  acceptanceCriteria:
    - "src/lib/forge/profiles/index.ts exporta getProfile(name): Profile"
    - "Cada profile tem: systemPrompt, allowedTools[], requiredMemories[], maxRetries"
    - "UI profile prompt menciona explicitamente: ResponsiveSheet, Field, useOptimisticCollection"
    - "DB profile prompt menciona: psql DIRECT_URL, atomic migrations, RLS via helpers"
    - "Testes em src/lib/forge/profiles/__tests__/ validam que cada prompt > 500 chars"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "node -e \"console.log(require('./src/lib/forge/profiles/index.ts').getProfile('ui').systemPrompt.length)\""
      expected: "number > 500"
  dependsOn: [FE-005]
  estimateMinutes: 30
  touches: [src/lib/forge/profiles/index.ts, src/lib/forge/profiles/db.ts, src/lib/forge/profiles/api.ts, src/lib/forge/profiles/ui.ts, src/lib/forge/profiles/wiring.ts, src/lib/forge/profiles/test.ts, src/lib/forge/profiles/doc.ts]
  agentProfile: wiring

- id: FE-007
  title: Hooks emitem ForgeEvent (PostToolUse + Stop)
  description: |
    Hook script .claude/hooks/forge-event-emit.ts intercepta PostToolUse, Stop,
    SubagentStop. Lê env var FORGE_RUN_ID + FORGE_TASK_ID injetadas pelo worker
    (FE-005). Append em .forge/<run-id>/events.jsonl. Watcher (chokidar) faz
    upload pro Supabase ForgeEvent.
  acceptanceCriteria:
    - ".claude/hooks/forge-event-emit.ts existe e é registrado em .claude/settings.json"
    - "Hook escreve linha jsonl com { runId, taskId, ts, kind, payload } por evento"
    - "src/lib/forge/event-uploader.ts: watcher Node faz upload batch (10 evs ou 200ms)"
    - "Idempotência: re-upload de evento existente é no-op (UNIQUE constraint runId+seq)"
    - "Sem run ativo: hook é no-op (não falha)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"ForgeEvent\" WHERE \"runId\" = (SELECT id FROM \"ForgeRun\" ORDER BY \"createdAt\" DESC LIMIT 1)"
      expected: "> 0 after a run completes"
  dependsOn: [FE-005, FE-003]
  estimateMinutes: 25
  touches: [.claude/hooks/forge-event-emit.ts, .claude/settings.json, src/lib/forge/event-uploader.ts]
  agentProfile: wiring

- id: FE-008
  title: Cost tracking via stream-json output
  description: |
    Worker (FE-005) invoca claude -p com --output-format=stream-json. Parser
    em src/lib/forge/cost-parser.ts extrai usage.input_tokens, output_tokens,
    cache_read, cache_creation por evento. Calcula USD baseado em pricing table
    por modelo. Salva em ForgeTask.{tokensIn, tokensOut, costUsd}. Trigger
    (FE-003) propaga pro ForgeRun.
  acceptanceCriteria:
    - "src/lib/forge/cost-parser.ts exporta parseCost(stream): Promise<CostSummary>"
    - "Pricing table em src/lib/forge/pricing.ts com Opus/Sonnet/Haiku 4.x"
    - "Worker resultado inclui { cost: { tokensIn, tokensOut, usd } }"
    - "Após cada task, ForgeTask.costUsd persistido via DAL"
    - "Trigger SQL agregou ForgeRun.costUsdTotal corretamente"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "SELECT \"costUsdTotal\" FROM \"ForgeRun\" WHERE id=(SELECT \"runId\" FROM \"ForgeTask\" WHERE \"costUsd\">0 LIMIT 1)"
      expected: "value > 0"
  dependsOn: [FE-005, FE-003]
  estimateMinutes: 20
  touches: [src/lib/forge/cost-parser.ts, src/lib/forge/pricing.ts, src/lib/forge/worker.ts]
  agentProfile: wiring

- id: FE-009
  title: CLI surface (forge init/plan/run/ps/kill/done)
  description: |
    scripts/forge/cli.ts com subcomandos via commander.js. Comandos:
    - `forge init <slug>` — wizard interativo, escreve docs/specs/draft/<slug>.md
    - `forge plan <slug>` — invoca planner, mostra DAG ASCII, pede approve
    - `forge run <slug> [--max-iter N]` — spawn orchestrator
    - `forge ps` — lista runs ativos, custo to-date, ETA
    - `forge kill <run-id|task-id>` — abort
    - `forge done <run-id>` — closeout: merge final + gh pr create
  acceptanceCriteria:
    - "scripts/forge/cli.ts compila via tsc"
    - "package.json bin: { forge: 'scripts/forge/cli.js' }"
    - "Cada subcomando responde a --help"
    - "`forge ps` em terminal mostra tabela com run id, slug, progress, cost, eta"
    - "`forge done` invoca gh pr create com título correto"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "node scripts/forge/cli.js --help"
      expected: "lista todos os subcomandos"
  dependsOn: [FE-004, FE-007, FE-008]
  estimateMinutes: 30
  touches: [scripts/forge/cli.ts, package.json]
  agentProfile: wiring

- id: FE-010
  title: Forge UI consome ForgeEvent real (não mock)
  description: |
    Implementa RealtimeForgeSource (Fase 11 do runbook Forge antigo). Toggle no
    provider: useForgeSource('mock'|'realtime'). Default em prod: realtime.
    Backfill inicial (SELECT events ORDER BY seq) + live subscribe. Reconcile
    gap. Reconnect retoma do lastSeq.
  acceptanceCriteria:
    - "src/lib/forge/sources/realtime.ts implementa ForgeSource interface"
    - "Backfill ≤ 500ms pra runs com ≤ 1000 eventos"
    - "Wifi off por 5s reconnect sem duplicar seq"
    - "2 abas no mesmo run: estado idêntico após 30s"
    - "Toggle ?source=mock ainda funciona pra demo"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl localhost:3000/forge && echo OK"
      expected: "page loads with realtime source"
  dependsOn: [FE-007]
  estimateMinutes: 30
  touches: [src/lib/forge/sources/realtime.ts, src/lib/forge/sources/index.ts, src/hooks/use-forge-store.tsx]
  agentProfile: ui

- id: FE-011
  title: TaskSheet ganha aba Diff
  description: |
    Aba "Diff" na TaskSheet (4ª aba, após Metrics). Mostra git diff acumulado
    da worktree daquela task. Fetch via endpoint GET /api/forge/tasks/:id/diff
    que lê do worktree (se task running) ou do commit (se task done).
    Renderização: markdown code block com syntax highlight, file-by-file.
  acceptanceCriteria:
    - "src/app/(dashboard)/forge/_components/task-sheet/diff-tab.tsx existe"
    - "GET /api/forge/tasks/[id]/diff retorna { patch: string, files: string[] }"
    - "Para task running: lê via 'git -C <worktreePath> diff joao-dev...HEAD'"
    - "Para task done: lê via 'git show <commitSha>'"
    - "Aba só aparece se task.status != 'queued' (sem diff ainda)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl -I localhost:3000/api/forge/tasks/test-id/diff"
      expected: "200 or 404 (route exists)"
  dependsOn: [FE-010]
  estimateMinutes: 25
  touches: [src/app/(dashboard)/forge/_components/task-sheet/diff-tab.tsx, src/app/api/forge/tasks/[id]/diff/route.ts]
  agentProfile: ui

- id: FE-012
  title: Closeout — branch merge + gh pr create + spec move
  description: |
    `forge done <run-id>` implementa rito 4 (closeout). Steps:
    1. Valida todas as tasks passes=true (senão erro)
    2. Merge branches forge/<run-id>/<task-id> em ordem topológica em joao-dev
    3. Move docs/specs/active/<slug>.md → docs/specs/done/<slug>-YYYYMMDD.md
    4. Push joao-dev em todos os remotes (via sync-main.sh)
    5. gh pr create com título "ZRD-JM-NN: forge — <slug> — closeout"
    6. UPDATE ForgeRun SET status='done', endedAt=now()
  acceptanceCriteria:
    - "Função closeout(runId): Promise<{prUrl, mergedTasks[]}>"
    - "Erro se alguma task passes=false (mensagem lista quais)"
    - "Após sucesso, spec move pra done/ com timestamp"
    - "PR URL retornado é acessível via gh api"
    - "CLI 'forge done <id>' executa todos os steps com confirmação interativa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "node scripts/forge/cli.js done --dry-run <test-run-id>"
      expected: "lista as ações sem executar"
  dependsOn: [FE-009, FE-011]
  estimateMinutes: 20
  touches: [src/lib/forge/closeout.ts, scripts/forge/cli.ts]
  agentProfile: wiring
```

---

```
   ╔════════════════════════════════════════════╗
   ║  END OF SPEC · THE ENGINE WAKES UP.        ║
   ║  Forge ganha alma. Ralph ganha rosto.      ║
   ╚════════════════════════════════════════════╝
```
