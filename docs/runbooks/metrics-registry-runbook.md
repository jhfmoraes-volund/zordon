# METRICS REGISTRY — Runbook

> **Este documento se executa.** Abra numa sessão de Claude Code, detecte a
> primeira fase `[OPEN]`, rode o LOOP até o gate passar, marque `[LOCKED]`,
> avance. Não é PRD — não roda via Ralph; roda aqui, com humano no loop.
>
> **Companion**: [docs/platform/metrics-registry-plan.md](../platform/metrics-registry-plan.md)
> (contexto e porquês). Este runbook é o *como*, autocontido.
>
> **Convenção de commit**: `ZRD-JM-NN: metrics — fase N — <slug>`
> **Push**: `bash scripts/sync-main.sh -m "..."`
> **Migrations**: `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f supabase/migrations/<file>.sql` + atualizar `database.types.ts`

---

## 0 · NORTH STAR — O QUE FICA PRONTO

O CEO abre o Overview e cada número se explica (tooltip = frase de defesa).
Ele pergunta no chat do Alpha *"por que o projeto X tá crítico?"* e recebe
**o mesmo número da tela**, com a conta aberta: *"queimou 100% do contrato e
entregou 5% do escopo — gap de 95pp"*. Pergunta *"o ritmo está melhorando?"*
e recebe série das últimas semanas. Nada disso é prompt-mágica: tudo deriva
de UM registry de métricas em código.

**Cenário de aprovação (teste final, manual):**

1. Overview `/` → drawer de um projeto fixed_scope → STATS diz "Contrato —
   sprint 4/4", tooltip de cada stat explica em 1 frase.
2. Chat Alpha: "por que esse projeto tá crítico?" → chama `compute_metric`,
   resposta cita pace_gap com os mesmos números da tela.
3. Chat Alpha: "qual a utilização da fábrica?" → `compute_metric` factory.
4. Chat Alpha: "o ritmo desse projeto está melhorando?" → `metric_trend`
   com ≥ 2 snapshots.
5. `docs/features/overview/stats-dictionary.md` tem header "GERADO — não
   edite" e bate com o registry.

---

## 1 · DECISÕES TRAVADAS (imutáveis — não rediscutir no meio da fase)

| Dn | Decisão |
|----|---------|
| D1 | Dicionário = registry TS em `src/lib/metrics/` (SSOT). Markdown **gerado** por script, nunca editado à mão. |
| D2 | Escopo v1 = saúde de projeto/contrato + capacidade & alocação. Financeiro e custo agêntico = v2. **Não adicionar métrica fora do catálogo §2.3 sem nova decisão.** |
| D3 | Snapshot semanal desde v1 (`MetricSnapshot`, toda segunda 06:00 BRT). |
| D4 | Copiloto = **Alpha estendido** (família de tools `*_metric`). Sem persona nova. |
| D5 | Unidade de exibição = **sprint** (sprint = unidade do contrato vendida ao cliente). A palavra "semana" sai da UI de stats. Seg→dom já é constraint no banco — sprint *é* a semana, o nome comercial é sprint. |
| D6 | Tooltip de cada stat = a frase de `defense` do registry. Uma fonte, mesma frase na UI e na boca do Alpha. |
| D7 | Snapshot agendado via **pg_cron + pg_net → POST rota Next** com bearer secret — padrão idêntico ao `run-alpha-insights` (ver `supabase/migrations/20260520_project_insights_drain_via_next.sql`). Fórmulas ficam em TS; pg_cron só dispara HTTP. |
| D8 | Régua ganha trilho de fases (commercial → imersão → ops → pós-ops). Exige histórico de transição: tabela `ProjectPhaseEvent` (F5) — `phaseChangedAt` só guarda a última. |
| D9 | **Toda resposta numérica do Alpha sobre operação passa por `compute_metric`.** Proibido aritmética de cabeça no prompt — mesma lição do `verify_sprint_distribution` (auditoria 2026-05-06: modelo fabrica totais). |

---

## 2 · ARQUITETURA & CONTRATOS

### 2.1 Mapa de arquivos

```
src/lib/metrics/
  types.ts            MetricDef, MetricValue, MetricCtx, Threshold
  registry.ts         METRIC_REGISTRY: MetricDef[] — o dicionário vivo
  compute.ts          computeMetric(id, scopeId?) — resolve ctx, chama def.compute
  project-metrics.ts  defs de projeto (envelopam computeStats do DAL)
  capacity-metrics.ts defs de member/squad/factory (envelopam DAL de capacity)

scripts/gen-metrics-doc.ts          regenera stats-dictionary.md do registry
src/app/api/cron/metrics-snapshot/  rota POST (bearer) — F3
src/lib/agent/tools/alpha-metrics.ts  4 tools — F4
src/components/overview/projetos-board.tsx  consome registry — F2/F5
```

**Regra de ouro:** `computeStats()` ([src/lib/dal/project-overview.ts](../../src/lib/dal/project-overview.ts), fn privada na linha ~267)
**não é reescrito nem movido**. Os `MetricDef.compute` de projeto chamam o
DAL existente e extraem o campo. Refatoração mínima — se uma fórmula precisar
mudar, muda no DAL, e registry/UI/Alpha herdam juntos.

### 2.2 Contratos (copiar literalmente em `types.ts`)

```ts
export type MetricScope = "project" | "member" | "squad" | "factory";

export type Threshold = {
  label: string;                  // "à frente" | "no ritmo" | "atrás" | "crítico"
  tone: "green" | "amber" | "red" | "critical";
  /** valor mínimo (inclusive) pra cair nesta faixa; faixas em ordem decrescente */
  gte: number | null;
};

export type MetricValue = {
  value: number | null;           // null = não computável (ex.: projeto sem FP)
  components?: Record<string, number>; // numerador/denominador — auditável
  asOf: string;                   // ISO date
};

export type MetricDef = {
  id: string;                     // "project.pace_gap" — namespace = scope
  name: string;                   // "Pace"
  question: string;               // "estamos no ritmo do contrato?"
  unit: "pp" | "fp" | "pct" | "sprints" | "count" | "fp_per_sprint";
  scope: MetricScope;
  formulaText: string;            // "scopePct − timePct" — exibível
  defense: string;                // frase pro CEO — tooltip da UI E resposta do Alpha
  lineage: string[];              // tabelas/views fonte
  thresholds?: Threshold[];
  snapshot: boolean;              // entra no cron semanal?
  compute: (ctx: MetricCtx, scopeId?: string) => Promise<MetricValue>;
};
```

`MetricCtx` carrega o client supabase (admin no cron, user-scoped na UI/Alpha)
e cache por request (não recomputar `computeStats` 10× pra 10 métricas do
mesmo projeto — computar 1× e fatiar).

### 2.3 Catálogo v1 — EXATAMENTE estas 18 métricas

Fonte das fórmulas de projeto: [stats-dictionary.md](../features/overview/stats-dictionary.md)
(que após F1 passa a ser gerado deste catálogo). `defense` abaixo é a frase
final — copiar como está.

**Projeto/contrato (11) — todas extraídas de `computeStats()`:**

| id | unit | fórmula | defense |
|----|------|---------|---------|
| `project.sprints_total` | sprints | segundas entre mondayOf(startDate) e mondayOf(endDate), inclusivo | "O contrato é de N sprints — sprint é semana fechada seg→dom, constraint no banco. Contrato de N semanas *é* contrato de N sprints." |
| `project.sprints_elapsed` | sprints | segundas decorridas, clamp [0, total] | "O calendário queima sozinho — o contrato não espera ninguém apertar play." |
| `project.time_pct` | pct | elapsed ÷ total | "X% do tempo comprado já passou." |
| `project.sprints_closed` | count | sprints `completed` OU endDate < hoje | "De N sprints compradas, X foram executadas até o fim." |
| `project.done_pct` | pct | closed ÷ total | "Avanço guiado por sprint — o dado universal da fábrica (FP existe em ~1/3 dos projetos)." |
| `project.holes` | count | semanas decorridas sem sprint cobrindo a segunda | "Sprint do contrato queimada sem produção formalizada. Não acusa ninguém — mostra o fato." |
| `project.scope_pct` | pct | Σ FP done ÷ Σ FP de tasks vivas | "Contra o escopo de hoje — cliente adicionou escopo, % cai, e é honesto que caia." |
| `project.avg_fp_per_sprint` | fp_per_sprint | Σ done ÷ n, últimas 6 fechadas com planned > 0 | "Ritmo real recente da linha — o time como está agora." |
| `project.utilization` | pct | Σ done ÷ Σ capacity, mesma janela | "De cada 100 FP de capacidade alocada, quantos viraram entrega." |
| `project.pace_gap` | pp | scopePct − timePct | "Queimei X% do tempo e entreguei Y% do escopo: Zpp de gap. Uma subtração, zero opinião." Thresholds: ≥+5 à frente · ≥−5 no ritmo · ≥−15 atrás · <−15 crítico. |
| `project.projected_end_sprint` | sprints | elapsed + ceil((fpTotal − fpDone) ÷ avgFp) | "No ritmo médio recente, a matemática termina na sprint X. Não é palpite: é divisão." |

**Capacidade & alocação (7) — DAL: `sprint_capacity_overview` + lógica de `getProjectCapacityForOpsTool` ([alpha-planner.ts](../../src/lib/agent/tools/alpha-planner.ts)); extrair o miolo pra `src/lib/dal/` se a tool for a única dona hoje:**

| id | unit | fórmula | defense |
|----|------|---------|---------|
| `member.utilization` | pct | Σ done ÷ Σ capacity do builder, janela 6 sprints fechadas | "De cada 100 FP que este builder tinha de capacidade, quantos viraram entrega." |
| `member.committed_vs_capacity` | pct | Σ committed cross-projeto ÷ capacityTotal, sprint corrente | "Quanto da capacidade do builder já está prometida — acima de 100% é overbooking." |
| `squad.utilization` | pct | Σ done ÷ Σ capacity dos membros do squad, janela 6 | "O squad como unidade: capacidade alocada virando entrega." |
| `factory.utilization` | pct | média de `project.utilization` das linhas ativas | "A fábrica inteira: média das linhas ativas (já é a 'média da fábrica' do ribbon)." |
| `factory.builders_allocated` | count | Members `position='product-builder'` com alocação ativa / total | "Quantos builders estão em linha de produção agora." |
| `factory.lines_active` | count | projetos em fase produtiva (immersion/ops) | "Linhas de produção rodando." |
| `factory.clients_active` | count | distinct clients de linhas ativas (sem internos/eval) | "Clientes com produção ativa." |

⚠ Vieses conhecidos ficam na `defense` quando existirem (ex.: capacity
reflete alocação corrente — time que mudou no meio carrega viés; congelar
por sprint = v2). Honestidade > marketing.

### 2.4 Vocabulário (D5) — tabela de substituição da F2

| Hoje | Vira |
|------|------|
| label "Prazo" · `4/4` · "100% do prazo" | label "Contrato" · `sprint 4/4` · "100% do contrato consumido" |
| "1 semana queimada sem sprint" | "1 sprint do contrato queimada sem produção" |
| tooltip de segmento "Semana de DD/MM" | "Sprint de DD/MM" |
| "projeção: termina na sprint 22 (18 além do contrato)" | mantém (já fala sprint) + tooltip com formulaText |
| sub "últimas 6 fechadas" | "ritmo das últimas 6 sprints fechadas" |

---

## 3 · O LOOP (toda fase, sem atalho)

```
   ┌────────────────────────────────────────────────────────┐
   │  1. BUILD    código mínimo da fase                     │
   │  2. SMOKE    npx tsc --noEmit && npx eslint <paths>    │
   │  3. GATE     bata TODOS os checks da fase. Falhou? → 1 │
   │  4. COMMIT   ZRD-JM-NN: metrics — fase N — <slug>      │
   │  5. PUSH     bash scripts/sync-main.sh -m "..."        │
   │  6. LOCK     marque [LOCKED] no header da fase AQUI    │
   └────────────────────────────────────────────────────────┘
```

**Regras transversais (valem em toda fase):**

- Métrica só existe se está no registry. UI não renderiza stat fora dele.
- `stats-dictionary.md` nunca é editado à mão após F1 — só via gen script.
- Nenhuma mudança de fórmula sem atualizar `defense` junto.
- UI patterns da casa: `Tooltip` de `src/components/ui/`, nunca lib nova.

---

## 4 · FASES

| # | Tema | Status |
|---|------|--------|
| 1 | Registry core + doc gerado | `[LOCKED]` |
| 2 | UI consome registry (vocabulário sprint + tooltips) | `[OPEN]` |
| 3 | MetricSnapshot + cron | `[OPEN]` |
| 4 | Alpha analyst (4 tools + prompt D9 + eval) | `[OPEN]` |
| 5 | Trilho de fases na régua | `[OPEN]` |

Ordem: 1 → 2 → 3 → 4 → 5. F3 pode rodar antes de F2 se a sessão preferir
backend-first; F4 depende de F1+F3 (trend); F5 depende de F2.

---

### FASE 1 — REGISTRY CORE `[LOCKED]` (2026-06-10)

**Objetivo:** o dicionário vira código executável; o markdown vira gerado.
Zero mudança visível na UI.

**Tarefas:**

- [x] `src/lib/metrics/types.ts` — contratos do §2.2, literais.
- [x] `src/lib/metrics/project-metrics.ts` — 11 defs do §2.3. `compute` chama
      o caminho público do DAL que já produz `ProjectStats` (expor um
      `getProjectStats(projectId)` em `project-overview.ts` que envelopa o
      pipeline existente sem duplicar query — `computeStats` continua privada).
- [x] `src/lib/metrics/capacity-metrics.ts` — 7 defs. Lógica de utilização
      histórica não existia na tool (que faz planejamento corrente) — miolo
      novo em `src/lib/dal/capacity.ts`; tool intacta, views compartilhadas.
- [x] `src/lib/metrics/registry.ts` — `METRIC_REGISTRY` agregando os 18 +
      helpers `getMetricDef(id)`, `listMetricDefs(scope?)`.
- [x] `src/lib/metrics/compute.ts` — `computeMetric(ctx, id, scopeId?)` com
      cache por request (1 fetch de stats por projeto, N fatias).
- [x] `scripts/gen-metrics-doc.ts` — regenera
      `docs/features/overview/stats-dictionary.md` a partir do registry,
      com header `<!-- GERADO por scripts/gen-metrics-doc.ts — NÃO EDITE -->`,
      mantendo a organização por pergunta (tempo? saída? ritmo?) + seções
      novas de capacidade. Rodar e commitar o doc regenerado.

**Acceptance gate:**

- [x] `npx tsc --noEmit` clean
- [x] `npx eslint src/lib/metrics scripts/gen-metrics-doc.ts` clean
- [x] `npx tsx scripts/gen-metrics-doc.ts && git diff --exit-code docs/features/overview/stats-dictionary.md` → idempotente (md5 igual em gerações consecutivas)
- [x] Sanity manual: `project.pace_gap` computado pros 7 projetos contract →
      bate com o badge (HITz −95pp, Zelar −57pp; via
      `npx tsx --tsconfig tsconfig.eval.json`, shim de server-only)
- [x] 18 métricas no registry, ids exatamente como §2.3

**Commit:** `ZRD-JM-NN: metrics — fase 1 — registry executável + doc gerado`

---

### FASE 2 — UI CONSOME REGISTRY `[OPEN]`

**Objetivo:** resolver a confusão original do Overview. Labels, tooltips e
thresholds saem do registry; vocabulário vira sprint (D5, tabela §2.4).

**Tarefas:**

- [ ] `StatsSection`/`StatCol` ([projetos-board.tsx](../../src/components/overview/projetos-board.tsx))
      recebem `metricId` e puxam `name`/`defense`/`unit` de `getMetricDef` —
      tooltip via `Tooltip` de `src/components/ui/`.
- [ ] Aplicar TODAS as substituições do §2.4 (régua, badges, subs, rolling).
- [ ] `PaceBadge` lê thresholds do registry (não mais do `PACE_META` local).
- [ ] Tooltip na régua-como-conjunto (hoje só por segmento): 1 frase do que
      a linha é — "1 segmento = 1 sprint do contrato; cor = entrega real".
- [ ] Ribbon do topo: cada item com `metricId` + tooltip de defesa.
- [ ] Modos `rolling` e `none` continuam funcionando (degradação intacta).

**Acceptance gate:**

- [ ] `npx tsc --noEmit` && eslint nos arquivos tocados clean
- [ ] Browser: drawer de projeto fixed_scope mostra "Contrato · sprint 4/4",
      hover em cada stat mostra a defense; nenhum "semana" visível em stats
- [ ] Browser: projeto continuous (rolling) e projeto em commercial (none)
      renderizam sem regressão
- [ ] Mobile 375px: tooltips acessíveis (tap), grid 3 col não quebra
- [ ] Zero string de label/defesa hardcoded restante no componente (grep)

**Commit:** `ZRD-JM-NN: metrics — fase 2 — UI lê registry, vocabulário sprint`

---

### FASE 3 — SNAPSHOT SEMANAL `[OPEN]`

**Objetivo:** começar a gravar história. A partir desta fase, "está
melhorando?" tem resposta.

**Tarefas:**

- [ ] Migration `supabase/migrations/20260610_metric_snapshot.sql` (DDL
      exato no plano §MetricSnapshot): tabela + UNIQUE
      (`metricId`,`scope`,`scopeId`,`capturedAt`) + RLS (read: `is_manager()`;
      write: service role only). Rodar via psql. Atualizar `database.types.ts`.
- [ ] `src/app/api/cron/metrics-snapshot/route.ts` — POST, bearer secret
      próprio (`METRICS_CRON_TOKEN` no `.env`), padrão calcado em
      [run-alpha-insights/route.ts](../../src/app/api/cron/run-alpha-insights/route.ts):
      itera registry `where snapshot=true`, computa por escopo (todos os
      projetos ativos, members alocados, squads, factory), upsert no UNIQUE.
      Response `{ ok, written, skipped, errors }`.
- [ ] Migration `supabase/migrations/20260610b_metric_snapshot_cron.sql` —
      `cron.schedule` + `net.http_post` pra rota, segundas 06:00 BRT
      (09:00 UTC), padrão de `20260520_project_insights_drain_via_next.sql`
      (url + token via `app_settings`).
- [ ] Disparo manual documentado:
      `curl -X POST -H "Authorization: Bearer $METRICS_CRON_TOKEN" <host>/api/cron/metrics-snapshot`

**Acceptance gate:**

- [ ] Migrations rodadas via psql sem erro; types atualizados
- [ ] POST manual → 200, `written` ≈ nº projetos ativos × métricas project
      + members + 4 factory
- [ ] POST repetido no mesmo dia → idempotente (0 duplicatas, UNIQUE segura)
- [ ] `select * from cron.job` mostra o agendamento
- [ ] Sem bearer → 401

**Commit:** `ZRD-JM-NN: metrics — fase 3 — MetricSnapshot + cron semanal`

---

### FASE 4 — ALPHA ANALYST `[OPEN]`

**Objetivo:** o copiloto. Alpha responde qualquer pergunta do catálogo com
os números da tela — nunca de cabeça.

**Tarefas:**

- [ ] `src/lib/agent/tools/alpha-metrics.ts` com 4 funções `*ForOpsTool`:
      - `list_metrics()` → catálogo (id, name, question, scope, unit)
      - `compute_metric({ id, scopeId? })` → `MetricValue` + `defense` +
        `formulaText`. Scope `project|member|squad` **exige** scopeId
        (route-context injeta hint, tool valida e erra claro se faltar).
      - `explain_metric({ id })` → formulaText, lineage, thresholds, defense
      - `metric_trend({ id, scopeId?, weeks = 8 })` → série de `MetricSnapshot`
- [ ] Wire em `assembleAlphaTools` ([alpha/tools.ts](../../src/lib/agent/agents/alpha/tools.ts))
      — tools de leitura, disponíveis sempre (sem gate de capability write).
- [ ] Prompt ([alpha/prompt.ts](../../src/lib/agent/agents/alpha/prompt.ts)),
      seção nova "Métricas de operação": (a) regra D9 verbatim — *qualquer
      resposta numérica sobre operação passa por `compute_metric`, nunca
      calcule você mesmo*; (b) responda com a `defense` e ofereça a conta
      (`components`) se questionado; (c) "está melhorando?" → `metric_trend`.
- [ ] Eval: criar `src/eval/alpha/cases/` (primeira suite do Alpha — seguir
      estrutura de `src/eval/vitoria/`) com ≥ 4 cases:
      1. "por que o projeto X tá crítico?" → DEVE chamar `compute_metric(project.pace_gap)`
      2. "qual a utilização da fábrica?" → `compute_metric(factory.utilization)`
      3. "o ritmo do X está melhorando?" → `metric_trend`
      4. pergunta numérica respondida SEM tool call → FALHA (anti-D9)

**Acceptance gate:**

- [ ] tsc/eslint clean
- [ ] Chat real: as 4 perguntas do cenário §0 funcionam; números batem com
      o Overview aberto lado a lado
- [ ] Pergunta de métrica sem projeto no contexto → Alpha pergunta qual
      projeto (não chuta scopeId)
- [ ] Eval cases passam
- [ ] `bash scripts/calibrate/calibrate.sh alpha status` segue ok

**Commit:** `ZRD-JM-NN: metrics — fase 4 — alpha analyst tools + D9`

---

### FASE 5 — TRILHO DE FASES NA RÉGUA `[OPEN]`

**Objetivo:** a linha conta a história do contrato inteiro (D8): onde ele
está na jornada commercial → imersão → ops → pós-ops, com a régua de sprints
alinhada embaixo cobrindo só o trecho produtivo.

**Pré-requisito de dado:** `phaseChangedAt` guarda só a ÚLTIMA transição —
não dá pra desenhar o trilho com ele.

**Tarefas:**

- [ ] Migration `ProjectPhaseEvent` (id, projectId FK, phase, enteredAt,
      RLS espelhando leitura de Project) + backfill: 1 evento por projeto
      com a phase atual e `enteredAt = phaseChangedAt` (fallback `createdAt`).
- [ ] `PUT /api/projects/[id]` ([route.ts](../../src/app/api/projects/[id]/route.ts)):
      onde hoje estampa `phaseChangedAt`, inserir também o `ProjectPhaseEvent`.
- [ ] Componente `PhaseTrack` em `src/components/overview/` — banda fina
      acima da `Regua`: segmentos proporcionais ao tempo em cada fase
      (eventos + hoje), tooltip por fase ("Imersão — desde DD/MM, Xd"),
      fase corrente destacada. Projetos pré-backfill mostram trilho de 1
      fase — honesto, melhora sozinho daqui pra frente.
- [ ] Alinhamento visual: régua de sprints começa onde imersão começa
      (sprints nascem na imersão — fica visualmente óbvio).

**Acceptance gate:**

- [ ] Migration via psql + types atualizados
- [ ] Mudar phase de um projeto de teste → evento novo na tabela → trilho
      reflete sem reload manual de cache
- [ ] tsc/eslint clean; browser: drawer mostra trilho + régua alinhados;
      mobile 375px ok
- [ ] Tooltip de cada fase com data de entrada e dias decorridos

**Commit:** `ZRD-JM-NN: metrics — fase 5 — trilho de fases (ProjectPhaseEvent)`

---

## 5 · FORA DE ESCOPO (não deixe a sessão derivar)

- Métricas financeiras/margem, custo agêntico — v2 (D2).
- Dashboard de BI novo — a UI é o Overview + Alpha.
- Edição de métrica via UI — SSOT é código (D1).
- Baseline de escopo original (scope-creep tracking) — v2.
- Snapshot intra-semana por evento (fechamento de sprint) — v1.1 se a foto
  de segunda se provar grossa demais. Risco aceito conscientemente.
