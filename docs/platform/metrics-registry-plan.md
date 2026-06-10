# Metrics Registry — dicionário executável + copiloto de operação

**Problema (3 sintomas do mesmo bug):**

1. O Overview mostra números sem semântica — "PRAZO 4/4" não diz 4 *o quê*;
   tooltips só existem nos segmentos da régua. CEO/head ops não conseguem
   consumir sem tradutor.
2. O [stats-dictionary.md](../features/overview/stats-dictionary.md) já tem
   fórmula + fonte + frase-de-defesa por métrica, mas é **documento morto**:
   a UI hardcoda labels, doc e código driftam silenciosamente.
3. Alpha é executor (sprint planning, tasks, capacity), não analista. Não tem
   acesso a nenhuma métrica derivada (`computeStats()` é invisível pra ele).
   Pergunta "por que o projeto X tá crítico?" → ele recalcula na mão → números
   divergem da tela → confiança zero.

**Solução em uma frase:** o dicionário vira um *registry executável* em código,
do qual derivam a UI (labels/tooltips/thresholds), as tools do Alpha
(mesmos números, mesmas palavras da tela) e o doc gerado — com snapshot
semanal pra série histórica.

## Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | Dicionário = registry TS em `src/lib/metrics/` (SSOT). Markdown **gerado**, nunca editado à mão. | Mudança de KPI = PR revisado, versionado. Governança via git. |
| D2 | Escopo v1 = **saúde de projeto/contrato** + **capacidade & alocação**. Financeiro e custo agêntico ficam pra v2. | Decisão João 2026-06-10. Cobre as perguntas do CEO/head ops dia 1. |
| D3 | Snapshot **semanal desde v1** (toda segunda), tabela `MetricSnapshot`. | Histórico não capturado não volta. "Ritmo está melhorando?" exige série. |
| D4 | Copiloto = **Alpha estendido** com família de tools de métricas. Sem persona nova. | Um ponto de entrada só pra ops; fragmentar experiência custa mais que prompt maior. |
| D5 | Unidade de exibição = **sprint** (sprint = unidade do contrato vendida ao cliente). "Semana" sai do vocabulário de UI. | Sprints são o contrato (voice note 2026-06-10). Seg→dom já é constraint no banco — sprint *é* semana, mas o nome comercial é sprint. |
| D6 | Tooltip de cada stat = a **frase de defesa** do registry. | A defesa já é "como o CEO consome" — vira microcopy, não doc. |
| D7 | Snapshot roda em route handler Next (`/api/cron/metrics-snapshot`), agendado via **pg_cron + pg_net → POST com bearer** — padrão idêntico ao `run-alpha-insights` (`20260520_project_insights_drain_via_next.sql`). | As fórmulas vivem em TS (DAL); pg_cron só dispara HTTP. Reusa o padrão de cron já provado na casa. |
| D8 | Régua ganha **trilho de fases** (commercial → imersão → ops → pós-ops via `phaseChangedAt`) alinhado acima da régua de sprints. | A linha hoje responde "como vai a produção?"; o CEO pergunta "onde este contrato está na jornada?". |
| D9 | Toda resposta numérica do Alpha sobre operação **passa por `compute_metric`** — proibido aritmética de cabeça no prompt. | Auditoria 2026-05-06 já provou que o modelo fabrica totais. Mesma regra do `verify_sprint_distribution`. |

## Arquitetura

```
                    ┌──────────────────────────────┐
                    │  src/lib/metrics/registry.ts │  ◄── SSOT
                    │  MetricDef[] (id, fórmula,   │
                    │  defesa, thresholds, lineage)│
                    └──────┬───────┬───────┬───────┘
                           │       │       │
            ┌──────────────┘       │       └──────────────┐
            ▼                      ▼                      ▼
  StatsSection (UI)        Alpha tools             scripts/gen-metrics-doc
  labels + tooltips     list/compute/explain/      → docs/features/overview/
  + thresholds          trend_metric                 stats-dictionary.md (gerado)
            ▲                      ▲
            └────── mesmos números ┘
                           │
              /api/cron/metrics-snapshot (Vercel cron, seg 06:00 BRT)
                           ▼
                    MetricSnapshot (Postgres)
```

### MetricDef (shape)

```ts
type MetricDef = {
  id: string;                    // "project.pace_gap", "member.utilization"
  name: string;                  // "Pace"
  question: string;              // "estamos no ritmo do contrato?"
  unit: "pp" | "fp" | "pct" | "sprints" | "count" | "fp_per_sprint";
  scope: "project" | "member" | "squad" | "factory";
  compute: (ctx: MetricCtx, scopeId?: string) => Promise<MetricValue>;
  formulaText: string;           // "scopePct − timePct" — exibível pelo agente
  defense: string;               // frase pro CEO — tooltip da UI E resposta do Alpha
  thresholds?: Threshold[];      // ex.: ≥+5 à frente · ≥−5 no ritmo · ≥−15 atrás · <−15 crítico
  lineage: string[];             // ["Sprint", "Task.functionPoints", "sprint_capacity_overview"]
  snapshot: boolean;             // entra no cron semanal?
};

type MetricValue = {
  value: number | null;
  components?: Record<string, number>;  // numerador/denominador — auditável
  asOf: string;
};
```

`computeStats()` ([project-overview.ts](../../src/lib/dal/project-overview.ts))
**não é reescrito** — as fórmulas ficam onde estão; o registry as envelopa
(metric `compute` chama o DAL existente). Refatoração mínima, drift zero.

### Catálogo v1 (~17 métricas)

**Projeto/contrato (já existem em computeStats — só registrar):**
`project.sprints_total` · `project.sprints_elapsed` · `project.time_pct` ·
`project.sprints_closed` · `project.scope_pct` · `project.holes` ·
`project.avg_fp_per_sprint` · `project.utilization` · `project.pace_gap` ·
`project.projected_end_sprint`

**Capacidade & alocação (novas — DAL de capacity já existe, view `sprint_capacity_overview` + `get_project_capacity`):**
`member.utilization` (done ÷ capacity por builder, janela 6 sprints) ·
`member.committed_vs_capacity` (cross-projeto) ·
`squad.utilization` · `factory.utilization` (média das linhas ativas) ·
`factory.builders_allocated` (alocados/total) ·
`factory.lines_active` · `factory.clients_active`

### MetricSnapshot (DDL)

```sql
CREATE TABLE "MetricSnapshot" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "metricId"  text NOT NULL,
  scope       text NOT NULL,          -- project | member | squad | factory
  "scopeId"   uuid,                   -- NULL p/ factory
  value       numeric,                -- NULL = métrica não computável no momento
  components  jsonb,                  -- numerador/denominador p/ auditoria
  "capturedAt" date NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("metricId", scope, "scopeId", "capturedAt")
);
ALTER TABLE "MetricSnapshot" ENABLE ROW LEVEL SECURITY;
-- leitura: manager+ (is_manager()); escrita: service role only (cron)
```

### Tools do Alpha (família `metrics`)

| Tool | Contrato | Uso |
|------|----------|-----|
| `list_metrics` | → catálogo (id, name, question, scope, unit) | "o que você consegue medir?" |
| `compute_metric` | `{id, scopeId?}` → `MetricValue` + defense | qualquer pergunta numérica do presente |
| `explain_metric` | `{id}` → formulaText, lineage, thresholds, defense | "como esse número é calculado?" |
| `metric_trend` | `{id, scopeId?, weeks}` → série de snapshots | "está melhorando?" / "como estava há 3 semanas?" |

Prompt: regra D9 (nunca aritmética manual) + instrução de responder com a
frase de defesa e oferecer a conta (`components`) quando questionado.
Cada tool nova ganha case em `src/eval/alpha/cases/` (loop de calibração).

## UX — as 3 entregas visíveis

1. **Tooltips com defesa** em cada StatCol, no badge de pace, na régua-como-conjunto
   (hoje só por segmento). "Prazo 4/4" vira **"Contrato — sprint 4 de 4"**.
2. **Trilho de fases** (D8): banda fina acima da régua segmentada por
   commercial/imersão/ops/pós-ops; régua de sprints alinhada embaixo cobrindo
   só imersão+ops — visualmente óbvio que sprint nasce na imersão.
3. **Alpha no Overview**: rota `/` já tem route-context; o chat do Alpha na
   home responde com escopo factory por default.

## Faseamento

| Fase | Entrega | Depende de |
|------|---------|-----------|
| F1 | Registry core: `src/lib/metrics/` + 10 métricas de projeto envelopando computeStats + 7 de capacity + gerador do markdown | — |
| F2 | UI consome registry: vocabulário sprint, tooltips/defesa, thresholds. **Resolve a confusão original do Overview.** | F1 |
| F3 | `MetricSnapshot` migration + `/api/cron/metrics-snapshot` + Vercel cron. Começa a gravar histórico imediatamente. | F1 |
| F4 | Alpha analyst: 4 tools + prompt D9 + eval cases | F1 (trend exige F3) |
| F5 | Trilho de fases na régua (D8) | F2 |

F1+F2 já entregam mais que o sistema atual (tela igual + semântica).
F3 é barato e urgente pelo argumento "histórico não volta".

## Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Registry vira camada burocrática que ninguém atualiza | média | alto | Métrica só existe se registrada (UI não renderiza stat fora do registry); doc gerado falha CI se drift |
| Alpha responde com métrica certa mas escopo errado (projeto A vs B) | média | alto | `compute_metric` exige scopeId explícito quando scope≠factory; route-context injeta hint, mas tool valida |
| Snapshot semanal perde eventos intra-semana (sprint fechada quarta) | baixa | médio | `components` no snapshot + cron também dispara no fechamento de sprint (v1.1 se necessário) |
| Capacity reflete alocação corrente (viés se time mudou) | conhecida | médio | Já documentado no dictionary; congelar por sprint via `SprintCommitment` = v2 |

## Não-objetivos (v1)

- Métricas financeiras/margem e custo agêntico (v2 — D2).
- Dashboard de BI dedicado — a UI é o Overview existente + Alpha.
- Edição de métrica via UI (SSOT é código — D1).
- Baseline de escopo original (scope creep tracking) — v2 do dictionary.

## Execução

Via **runbook** (sessões de Claude Code no IDE, humano no loop — decisão
João 2026-06-10; não é PRD/Ralph):
[docs/runbooks/metrics-registry-runbook.md](../runbooks/metrics-registry-runbook.md)
— 5 fases com gates, contratos literais e catálogo fechado de 18 métricas.
