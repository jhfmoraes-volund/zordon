# PRD — SIAL Relatórios Customizáveis

**Reference**: SIAL-REL
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-analise`, `prd-sial-analise-gestao`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: relatórios **customizáveis com filtros (datas, categorias)** (doc §7 Relatórios); SLA e tempo médio por etapa derivados da tabela `evento` (doc §8; modelagem §4/§8).
- **[inferência]**: builder de relatório, relatórios salvos, export CSV, paths. A validar.

## Demo/Mock (one-shot)

> **Sem gateway externo.** Consultas reais sobre `Processo`/`Analise`/`Evento` (dados de `prd-sial-mock-data`). Smoke por `scripts/smoke/relatorios.ts`: gera um relatório com filtro de período e confere linhas + export CSV.

## §1 Problema

1. A gestão precisa de **relatórios com filtros** (datas, categorias, método, área) e indicadores de **SLA/produtividade**, exportáveis (doc §7, §8).

## §2 Solução em uma frase

Um builder de relatórios analíticos com filtros, indicadores de tempo médio por etapa (de `Evento`) e **export CSV**, com relatórios salvos para reuso.

## §3 Não-objetivos

- Cockpit em tempo real — `prd-sial-dashboard-operacional`.
- Cálculo base de SLA — `prd-sial-analise-gestao`.

## §4 Personas e jornada

- **Administrador**: "Quero um relatório de tempo médio de análise por método no último trimestre, e exportar."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | Relatórios pré-definidos parametrizáveis (tempo médio por etapa, volume por método/status/área) | [doc] §7, §8 |
| D2 | Filtros: período, método/dominio, área, status | [doc] §7 |
| D3 | Tempo por etapa derivado das transições em `Evento` | [doc §8]; modelagem §8 |
| D4 | Export CSV; `RelatorioSalvo` guarda config reutilizável | [inferência] |
| D5 | Acesso servidor/admin (RLS) | [doc] RF09 |

## §6 Arquitetura

```
POST /api/relatorios/gerar { tipo, filtros } → query sobre Processo/Analise/Evento → linhas
GET  /api/relatorios/:id/export.csv          → CSV
RelatorioSalvo (config) → reusar
```

## §7 Schema

```sql
-- 1) <data>_sial_relatorio_salvo.sql               -- [inferência]
CREATE TABLE "RelatorioSalvo" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  tipo text NOT NULL,
  filtros jsonb NOT NULL DEFAULT '{}'::jsonb,
  "criadoPor" uuid REFERENCES "Usuario"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "RelatorioSalvo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "relatorio_servidor" ON "RelatorioSalvo" FOR ALL
  USING (sial_is_servidor()) WITH CHECK (sial_is_servidor());
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/relatorios/gerar` | `{tipo, filtros}` → `{colunas, linhas}` |
| GET | `/api/relatorios/export?tipo=&filtros=` | CSV |
| GET/POST | `/api/relatorios/salvos` | lista/salva config |

## §9 UX

```
┌──── Relatórios ────────────────────────────────┐
│ Tipo [Tempo médio por etapa ▾]                  │
│ Período [01/04]–[30/06]  Método [Todos ▾]       │
│ [ Gerar ]   [ Exportar CSV ]   [ Salvar ]       │
│ ─────────────────────────────────────────────── │
│ Método   | etapa      | tempo médio | volume     │
│ Livro    | análise    | 1.8 dias    | 120        │
└──────────────────────────────────────────────────┘
```

## §10 Integrações

- Lê `Processo`/`Analise`/`Evento` (core/análise); SLA de `prd-sial-analise-gestao`.
- Dados de demo: `prd-sial-mock-data`.

## §11 Faseamento

Fase 1: queries dos relatórios (volume + tempo médio) → API gerar → export CSV → relatórios salvos → UI → smoke.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Consulta pesada em período longo | M | M | Índices; limitar janela; materializar (Track B). |
| Tempo por etapa impreciso | M | M | Derivar estritamente das transições em `Evento`; validar amostras. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Relatórios gerados | log |
| Tempo médio por etapa disponível | query sobre `Evento` retorna valores |

## §14 Open questions

- ❓ Conjunto oficial de relatórios exigidos pela JUCESP? **Inicial; refinar.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §7, §8; `Modelagem_de_Dados_SIAL.md` §4, §8.
- DesignSession card "Relatórios customizáveis".

## §16 Stories implementáveis

```yaml
- id: SIAL-REL-001
  title: Migration — RelatorioSalvo (+ RLS)
  description: Cria RelatorioSalvo conforme §7 com policy de servidor.
  acceptanceCriteria:
    - "Tabela RelatorioSalvo com filtros jsonb",
    - "Policy relatorio_servidor existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='RelatorioSalvo'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-REL-002
  title: Queries de relatório (volume + tempo médio por etapa)
  description: src/lib/sial/relatorios.ts com geradores parametrizados sobre Processo/Analise/Evento.
  acceptanceCriteria:
    - "Tempo médio por etapa calculado de Evento",
    - "Volume por método/status/área",
    - "Filtros de período/método/área aplicados"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 30
  touches: ["src/lib/sial/relatorios.ts"]

- id: SIAL-REL-003
  title: API gerar + export CSV + salvos
  description: POST gerar, GET export (CSV), GET/POST salvos.
  acceptanceCriteria:
    - "gerar retorna {colunas, linhas}",
    - "export retorna CSV válido",
    - "salvar/reusar config funciona"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-REL-001, SIAL-REL-002]
  estimateMinutes: 30
  touches: ["src/app/api/relatorios/gerar/route.ts", "src/app/api/relatorios/export/route.ts", "src/app/api/relatorios/salvos/route.ts"]

- id: SIAL-REL-004
  title: UI de relatórios + smoke
  description: Tela com filtros, tabela e export; scripts/smoke/relatorios.ts gera com filtro e confere.
  acceptanceCriteria:
    - "Gerar mostra tabela",
    - "Export baixa CSV",
    - "Smoke: relatório de período retorna linhas"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-REL-003]
  estimateMinutes: 30
  touches: ["src/app/(backoffice)/relatorios/page.tsx", "scripts/smoke/relatorios.ts"]
```

**Total: 4 stories, ~105min (~1h45).**
