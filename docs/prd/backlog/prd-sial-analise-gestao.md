# PRD — SIAL Gestão da Análise (redistribuição, anotações, SLA)

**Reference**: SIAL-AGES
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-identity-access`, `prd-sial-analise`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: alta performance e tempo de resposta, **relatórios de SLA e tempo médio por etapa** (doc §8; modelagem §4/§8 — eventos alimentam SLA).
- **[inferência/operacional]**: **redistribuição** de protocolos entre analistas e **anotações internas** são necessidades operacionais (cards da DS), **não explícitas no TR** — marcadas como inferência a validar.
- **[inferência]**: schema de `NotaInterna`/`PrazoConfig`, atribuição, paths.

## Demo/Mock (one-shot)

> **Sem gateway externo.** Tudo real em Supabase; alertas de SLA usam o `NotificacaoService` (no-op até `prd-sial-notificacoes`). Smoke por `scripts/smoke/analise-gestao.ts`: atribui um protocolo, adiciona nota interna, calcula prazo/vencimento via SQL.

## §1 Problema

1. Sem **atribuição**, protocolos ficam órfãos ou concentrados; ausências paralisam a fila (operacional).
2. O conhecimento da análise some em **e-mail/telefone** — falta registrar **notas internas** no protocolo (operacional).
3. O doc exige **SLA e tempo médio por etapa** (doc §8); sem prazos e alertas não há gestão por desempenho.

## §2 Solução em uma frase

Camada de gestão da fila de análise: **atribuição/redistribuição** de protocolos, **anotações internas** (não expostas ao requerente) e **SLA/prazos com alertas** de vencimento, sobre os eventos do núcleo.

## §3 Não-objetivos

- Dashboard/relatórios — `prd-sial-dashboard-operacional`, `prd-sial-relatorios` (consomem isto).
- Envio real de alerta — `prd-sial-notificacoes`.

## §4 Personas e jornada

- **Administrador/Supervisor**: "Quero distribuir a fila e ver quem está sobrecarregado, e ser avisado do que vai vencer."
- **Resolvedor**: "Quero anotar contexto da análise e marcar um colega, sem o requerente ver."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | `Processo.responsavelId` (atribuição) + ação de (re)atribuir; visão de carga por analista | [inferência/operacional] |
| D2 | `NotaInterna (processoId, autorId, texto, mencionados)` — **nunca** exposta ao requerente | [inferência/operacional]; [doc §8 separação interno] |
| D3 | `PrazoConfig (metodo/etapa → dias)`; prazo do item calculado a partir das transições em `Evento` | [doc §8] (SLA); modelagem §4/§8 |
| D4 | Alertas de vencimento via `NotificacaoService` (no-op até notificações) | [doc §8]; [decisão-sessão] |

## §6 Arquitetura

```
Processo.responsavelId  ← POST /api/processos/:id/atribuir { usuarioId }
NotaInterna (processoId) ← POST /api/processos/:id/notas   (interna)
PrazoConfig (metodo,etapa) → prazo calculado na fila (Evento) → alerta se vencendo
```

## §7 Schema

```sql
-- 1) <data>_sial_processo_responsavel.sql          -- [inferência/operacional]
ALTER TABLE "Processo" ADD COLUMN "responsavelId" uuid REFERENCES "Usuario"(id);
CREATE INDEX "Processo_responsavel_idx" ON "Processo" ("responsavelId");
```

```sql
-- 2) <data>_sial_nota_interna.sql                   -- [inferência/operacional]; interna por design
CREATE TABLE "NotaInterna" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processoId" uuid NOT NULL REFERENCES "Processo"(id) ON DELETE CASCADE,
  "autorId" uuid REFERENCES "Usuario"(id),
  texto text NOT NULL,
  mencionados uuid[] DEFAULT '{}',
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "NotaInterna_processo_idx" ON "NotaInterna" ("processoId");
ALTER TABLE "NotaInterna" ENABLE ROW LEVEL SECURITY;
-- só servidores leem/escrevem; requerente NUNCA vê
CREATE POLICY "nota_interna_servidor" ON "NotaInterna" FOR ALL
  USING (sial_is_servidor()) WITH CHECK (sial_is_servidor());
```

```sql
-- 3) <data>_sial_prazo_config.sql                   -- [doc §8 SLA]
CREATE TABLE "PrazoConfig" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "metodoDominio" text,                  -- null = default
  etapa text NOT NULL,                   -- ex.: 'analise'
  "diasPrazo" integer NOT NULL CHECK ("diasPrazo" > 0),
  UNIQUE ("metodoDominio", etapa)
);
ALTER TABLE "PrazoConfig" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prazo_admin" ON "PrazoConfig" FOR ALL
  USING (sial_has_perfil('administrador')) WITH CHECK (sial_has_perfil('administrador'));
CREATE POLICY "prazo_read" ON "PrazoConfig" FOR SELECT USING (sial_is_servidor());
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/processos/:id/atribuir` | `{usuarioId}` → seta responsável → 200 |
| GET | `/api/analise/carga` | (admin) carga por analista |
| GET/POST | `/api/processos/:id/notas` | lista/cria nota interna (servidor) |
| GET/POST | `/api/admin/prazos` | (admin) configura prazos |
| GET | `/api/analise/vencendo` | itens vencendo/vencidos (calculado de Evento) |

## §9 UX

```
┌──── Fila — gestão ─────────────────────────────┐
│ Carga: Maria 12 · João 5 · Ana 9   [redistribuir]│
│ 2026-000123  resp: Maria  ⏳ vence em 1d         │
│ 2026-000124  resp: —      🔴 vencido             │
└──────────────────────────────────────────────────┘
Notas internas (não visíveis ao requerente):
 • @João pode confirmar o NIRE? — Maria, 14:10
```

## §10 Integrações

- Lê `Evento` (núcleo) para prazos; escreve em `Notificacao` (via serviço) para alertas.
- Consumido por `prd-sial-dashboard-operacional` e `prd-sial-relatorios`.

## §11 Faseamento

Fase 1: atribuição (`responsavelId`) + carga → notas internas → `PrazoConfig` + cálculo de vencimento + alerta (no-op) → smoke.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Nota interna vazar ao requerente (LGPD/operacional) | B | A | RLS só servidor; nunca exposta em endpoints do portal; teste anti-vazamento. |
| Prazo mal configurado gera alerta-spam | M | B | Config por método/etapa; default conservador; agrupar alertas. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Carga por analista | `SELECT "responsavelId", count(*) FROM "Processo" WHERE status IN ('enviado_analise','em_analise') GROUP BY 1` |
| Itens vencidos | cálculo prazo (PrazoConfig) vs Evento |
| Notas por processo | `SELECT count(*) FROM "NotaInterna"` |

## §14 Open questions

- ❓ Redistribuição automática (balanceamento) ou só manual? **Manual no MVP; automático a validar.**
- ❓ Regras de prazo oficiais por método? **Config genérica até a JUCESP definir.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §8; `Modelagem_de_Dados_SIAL.md` §4, §8.
- DesignSession cards "Redistribuição de protocolos", "Anotações internas", "SLA/prazos + alertas".

## §16 Stories implementáveis

```yaml
- id: SIAL-AGES-001
  title: Migration — Processo.responsavelId
  description: ALTER add responsavelId + índice (§7 (1)).
  acceptanceCriteria:
    - "Coluna responsavelId (FK Usuario) existe"
    - "Índice Processo_responsavel_idx existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.columns WHERE table_name='Processo' AND column_name='responsavelId'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-AGES-002
  title: Migration — NotaInterna (+ RLS só servidor)
  description: Cria NotaInterna conforme §7 (2); policy só servidor.
  acceptanceCriteria:
    - "Tabela NotaInterna existe com mencionados uuid[]"
    - "Policy nota_interna_servidor existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='NotaInterna'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-AGES-003
  title: Migration — PrazoConfig (+ RLS)
  description: Cria PrazoConfig conforme §7 (3) com UNIQUE (metodoDominio, etapa).
  acceptanceCriteria:
    - "UNIQUE (metodoDominio, etapa)"
    - "Policies prazo_admin e prazo_read existem"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='PrazoConfig'"
      expected: "2"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-AGES-004
  title: Atribuição/redistribuição (API + carga)
  description: POST /api/processos/:id/atribuir + GET /api/analise/carga.
  acceptanceCriteria:
    - "Atribuir seta responsavelId e grava Evento",
    - "Carga retorna contagem por analista",
    - "Só servidor/admin"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-AGES-001]
  estimateMinutes: 25
  touches: ["src/app/api/processos/[id]/atribuir/route.ts", "src/app/api/analise/carga/route.ts"]

- id: SIAL-AGES-005
  title: Notas internas (API + UI)
  description: GET/POST /api/processos/:id/notas + componente de notas; nunca exposto ao requerente.
  acceptanceCriteria:
    - "Servidor cria/lê notas",
    - "Endpoint do portal NUNCA retorna notas",
    - "Menção registra usuários"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-AGES-002]
  estimateMinutes: 30
  touches: ["src/app/api/processos/[id]/notas/route.ts", "src/components/sial/notas-internas.tsx"]

- id: SIAL-AGES-006
  title: SLA — config + cálculo de vencimento + alerta (no-op)
  description: GET/POST /api/admin/prazos, GET /api/analise/vencendo (calcula de Evento), alerta via NotificacaoService.
  acceptanceCriteria:
    - "Admin configura prazo por método/etapa",
    - "vencendo lista itens próximos/estourados",
    - "Alerta chama NotificacaoService (no-op ok)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-AGES-003]
  estimateMinutes: 30
  touches: ["src/app/api/admin/prazos/route.ts", "src/app/api/analise/vencendo/route.ts", "src/lib/sial/sla.ts"]

- id: SIAL-AGES-007
  title: Smoke — gestão da análise + types
  description: scripts/smoke/analise-gestao.ts atribui, anota e calcula prazo; types.
  acceptanceCriteria:
    - "Atribuição persiste",
    - "Nota interna criada e invisível ao requerente",
    - "Item vencido aparece em /vencendo"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"NotaInterna\""
      expected: ">=1"
  dependsOn: [SIAL-AGES-004, SIAL-AGES-005, SIAL-AGES-006]
  estimateMinutes: 25
  touches: ["scripts/smoke/analise-gestao.ts", "src/lib/supabase/database.types.ts"]
```

**Total: 7 stories, ~165min (~2h45).**
