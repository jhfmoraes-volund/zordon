# PRD — SIAL Dashboard Operacional (cockpit)

**Reference**: SIAL-DASH
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-analise`, `prd-sial-analise-gestao`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: o backoffice tem **dashboards** (doc §4); gestão precisa enxergar gargalos; SLA/tempo médio por etapa derivam dos eventos (doc §8; modelagem §8).
- **[decisão-sessão]**: cockpit em tempo quase real, **distinto** do relatório analítico exportável.
- **[inferência]**: conjunto de indicadores, view materializada, paths. A validar.

## Demo/Mock (one-shot)

> **Sem gateway externo.** Agrega `Processo`/`Evento` reais (populados por `prd-sial-mock-data`). Smoke por `scripts/smoke/dashboard-operacional.ts`: métricas batem com os counts do banco; clique num indicador leva à fila filtrada.

## §1 Problema

1. A gestão precisa enxergar **em tempo real** pendentes, em exigência, vencendo SLA, deferidos no período e carga por analista — não só relatório fechado (doc §4).

## §2 Solução em uma frase

Um cockpit operacional com indicadores em tempo quase real (pendentes, em exigência, vencendo, deferidos, carga) e **drill-down** para a fila filtrada, sobre `Processo`/`Evento`.

## §3 Não-objetivos

- Relatórios analíticos/export — `prd-sial-relatorios`.
- Cálculo de prazo/SLA base — `prd-sial-analise-gestao` (consumido aqui).

## §4 Personas e jornada

- **Administrador/Supervisor**: "Quero abrir o painel e ver na hora onde está o gargalo, e clicar pra agir."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | Indicadores: pendentes, em_analise, em_exigencia, vencendo/vencidos, deferidos no período, carga por analista | [doc] §4, §8 |
| D2 | Agregações sobre `Processo`/`Evento`; opcional materialized view p/ performance | [doc §8]; [inferência] |
| D3 | Drill-down: clicar no indicador abre a fila filtrada | [inferência] |
| D4 | Acesso só servidor (RLS) | [doc] RF09 |

## §6 Arquitetura

```
GET /api/dashboard/metrics → counts por status + vencendo (SLA) + carga
GET /api/dashboard/fluxo   → série por status/período (de Evento)
   clique → /analise/fila?status=...
```

## §7 Schema

```sql
-- opcional: materialized view p/ performance  -- [inferência]
CREATE MATERIALIZED VIEW sial_dashboard_metrics AS
SELECT
  status, count(*) AS total
FROM "Processo"
GROUP BY status;
-- refresh agendado/manual; em mock-mode pode ser view simples.
```

> Em demo, uma **view simples** basta; a materialized view é otimização para volume (Track B).

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET | `/api/dashboard/metrics` | (servidor) `{pendentes, emAnalise, emExigencia, vencendo, deferidosPeriodo, cargaPorAnalista[]}` |
| GET | `/api/dashboard/fluxo?de=&ate=` | série temporal por status (de `Evento`) |

## §9 UX

```
┌──── Cockpit ────────────────────────────────────┐
│ [ 12 pendentes ] [ 5 em análise ] [ 3 exigência ]│
│ [ 2 vencendo 🔴 ] [ 28 deferidos no mês ]         │
│ Carga: Maria 12 · João 5 · Ana 9                 │
│ (clicar num cartão → fila filtrada)              │
└────────────────────────────────────────────────────┘
```

## §10 Integrações

- Lê `Processo`/`Evento` (core), SLA de `prd-sial-analise-gestao`.
- Drill-down para `prd-sial-analise` (fila).
- Dados de demo: `prd-sial-mock-data`.

## §11 Faseamento

Fase 1: view/queries de métricas → API metrics + fluxo → painel com cartões + drill-down → smoke (métricas == counts).

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Agregação lenta em volume | M | M | Materialized view + refresh (Track B); índices de status. |
| Métrica divergir da fila | B | M | Mesma fonte (Processo/Evento); smoke compara. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Painel reflete o banco | smoke: metrics == `SELECT status,count(*)` |

## §14 Open questions

- ❓ Quais indicadores a JUCESP prioriza? **Conjunto inicial; refinar.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §4, §8; `Modelagem_de_Dados_SIAL.md` §8.
- DesignSession card "Dashboard operacional".

## §16 Stories implementáveis

```yaml
- id: SIAL-DASH-001
  title: Migration — view de métricas (sial_dashboard_metrics)
  description: Cria a view (ou materialized) de §7 agregando Processo por status.
  acceptanceCriteria:
    - "View sial_dashboard_metrics existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.views WHERE table_name='sial_dashboard_metrics' OR table_name IN (SELECT matviewname FROM pg_matviews WHERE matviewname='sial_dashboard_metrics')"
      expected: ">=1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-DASH-002
  title: Lib de métricas + API metrics/fluxo
  description: src/lib/sial/dashboard.ts (agregações) + GET /api/dashboard/metrics e /fluxo; só servidor.
  acceptanceCriteria:
    - "metrics retorna counts por status + vencendo + carga",
    - "fluxo retorna série por período de Evento",
    - "Não-servidor recebe 403"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DASH-001]
  estimateMinutes: 30
  touches: ["src/lib/sial/dashboard.ts", "src/app/api/dashboard/metrics/route.ts", "src/app/api/dashboard/fluxo/route.ts"]

- id: SIAL-DASH-003
  title: Painel (UI) com cartões + drill-down
  description: Página backoffice com indicadores e clique levando à fila filtrada.
  acceptanceCriteria:
    - "Cartões mostram os indicadores",
    - "Clique abre /analise/fila com filtro",
    - "Carga por analista listada"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DASH-002]
  estimateMinutes: 30
  touches: ["src/app/(backoffice)/dashboard/page.tsx"]

- id: SIAL-DASH-004
  title: Smoke — métricas batem com o banco
  description: scripts/smoke/dashboard-operacional.ts compara metrics com counts diretos.
  acceptanceCriteria:
    - "pendentes == SELECT count(*) status='enviado_analise'",
    - "Painel carrega sem erro"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Processo\" WHERE status='enviado_analise'"
      expected: ">=0"
  dependsOn: [SIAL-DASH-003]
  estimateMinutes: 20
  touches: ["scripts/smoke/dashboard-operacional.ts"]
```

**Total: 4 stories, ~100min (~1h40).**
