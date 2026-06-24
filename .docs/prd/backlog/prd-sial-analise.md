# PRD — SIAL Análise (fila e tela com sincronização externa)

**Reference**: SIAL-ANA
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (React + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-identity-access`, `prd-sial-documentos`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: buscar pendentes de análise (fila) → exibição dos dados → sincronização com links externos → analisar → decisão (doc §6.3, §6A.3); visualizações por perfil/método (RF09); `analise: id, processo_id, analista_id, decisao, parecer` (modelagem §3).
- **[decisão-sessão]**: fila/tela como app único de backoffice; RLS por perfil.
- **[inferência]**: `SincronizacaoGateway`, claim de análise (em_analise), filtros da fila, paths. A validar.

## Demo/Mock (one-shot)

> Roda em **mock-mode**. O `SincronizacaoGateway` vem de `getGateways()`: stub devolve dados externos determinísticos por fonte (SEFAZ/Receita/mainframe) com status `ok` e `sincronizadoEm`, simulando inclusive uma fonte fora. Fila/análise/parecer são reais em Supabase. Smoke por `scripts/smoke/analise.ts`: iniciar análise (`enviado_analise→em_analise`), sincronizar, gravar parecer, via SQL. Integrações reais = Track B.

## §1 Problema

1. Sem uma **fila única** de pendentes, o analista não sabe o que priorizar nem o que está atrasado (doc §6.3, §6A.3 passo 1).
2. O analista precisa dos **dados sincronizados com sistemas externos** (SEFAZ, Receita, mainframe) para decidir com informação atualizada; conferência manual é lenta e sujeita a erro (doc §6A.3 passos 2-3).
3. A análise precisa registrar **quem analisou e o parecer** (modelagem §3) e abrir o gateway de decisão.

## §2 Solução em uma frase

A fila de protocolos pendentes e a tela de análise com **sincronização de dados externos**, que cria a `Analise` (analista + parecer) e abre o gateway de decisão (deferir/exigência/tramitar).

## §3 Não-objetivos

- As **decisões** em si — `prd-sial-decisao-deferir`, `prd-sial-exigencia`, `prd-sial-tramitacao` (este PRD abre o gateway e registra a análise).
- A **implementação real** das integrações externas — `prd-sial-integracao-*` (aqui `SincronizacaoGateway` stub).
- Redistribuição/anotações/SLA — `prd-sial-analise-gestao`.

## §4 Personas e jornada

- **Resolvedor**: "Quero abrir minha fila, entrar no protocolo com os dados já conferidos nas fontes externas, registrar meu parecer e decidir."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | Fila = `Processo` com `status='enviado_analise'`, filtrável por método/prazo, visível por perfil (RF09) | [doc] §6A.3; RF09 |
| D2 | Abrir análise faz claim: `enviado_analise → em_analise` e cria/abre `Analise(analistaId)` | [doc] §6A.3; [inferência] no claim |
| D3 | `SincronizacaoGateway` busca dados externos (SEFAZ/Receita/mainframe) — stub aqui, com `sincronizadoEm` por fonte | [doc] §6A.3 p3; [inferência] |
| D4 | `Analise.decisao` ∈ exigencia/deferir/tramitar/arquivar/proresp; preenchida pelas PRDs de decisão | [doc] modelagem §3 |
| D5 | Adiciona a FK `Exigencia.analiseId → Analise` (adiada em `prd-sial-exigencia`) | [decisão-sessão] (fecha FK adiada) |

## §6 Arquitetura

```
GET /api/analise/fila?metodo=&prazo=  → Processo(status=enviado_analise) [RLS por perfil]
        │
POST /api/processos/:id/analise/iniciar → claim: enviado_analise→em_analise + Analise(analistaId)
        │
GET /api/processos/:id/analise → dados + SincronizacaoGateway.sync(SEFAZ/Receita/mainframe)
        │
POST /api/processos/:id/analise/parecer {parecer}
        │
        ▼ abre gateway de decisão → (deferir | exigência | tramitar)  [PRDs próprios]
```

## §7 Schema

```sql
-- 1) <data>_sial_analise.sql                       -- [doc modelagem §3]
CREATE TABLE "Analise" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processoId" uuid NOT NULL REFERENCES "Processo"(id) ON DELETE CASCADE,
  "analistaId" uuid REFERENCES "Usuario"(id),
  decisao text CHECK (decisao IN ('exigencia','deferir','tramitar','arquivar','proresp')),
  parecer text,
  "iniciadaEm" timestamptz NOT NULL DEFAULT now(),
  "decididaEm" timestamptz
);
CREATE INDEX "Analise_processo_idx" ON "Analise" ("processoId");
ALTER TABLE "Analise" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "analise_servidor" ON "Analise" FOR ALL
  USING (sial_is_servidor()) WITH CHECK (sial_is_servidor());
```

```sql
-- 2) <data>_sial_exigencia_analise_fk.sql           -- [decisão-sessão] fecha FK adiada
ALTER TABLE "Exigencia"
  ADD CONSTRAINT "Exigencia_analise_fk"
  FOREIGN KEY ("analiseId") REFERENCES "Analise"(id);
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET | `/api/analise/fila` | (servidor) `?metodo=&prazo=&status=` → Processos pendentes (RLS por perfil) |
| POST | `/api/processos/:id/analise/iniciar` | claim → em_analise + cria Analise → 200 |
| GET | `/api/processos/:id/analise` | → processo + dados + sincronização externa + documentos |
| POST | `/api/processos/:id/analise/sincronizar` | re-sincroniza fontes externas → `{fontes:[{nome,sincronizadoEm,ok}]}` |
| POST | `/api/processos/:id/analise/parecer` | `{parecer}` → grava parecer (decisão vem nas PRDs de decisão) |

## §9 UX

```
┌──── Fila de análise ─────────────────────────────┐
│ Método [Todos ▾]  Prazo [Vencendo ▾]              │
│ 2026-000123  Livro      ⏳ 1d   [analisar]        │
│ 2026-000124  Leiloeiro  🔴 vencido [analisar]     │
└────────────────────────────────────────────────────┘
┌──── Análise — 2026-000123 ───────────────────────┐
│ Dados do requerimento ......                       │
│ Sincronização: SEFAZ ✓ 14:02 · Receita ✓ · MF ⚠   │
│ Documentos: [requerimento.pdf] [comprovante.pdf]   │
│ Parecer: [__________________]                      │
│ Decisão:  [ Deferir ] [ Exigência ] [ Tramitar ]   │
└────────────────────────────────────────────────────┘
```

## §10 Integrações

- `SincronizacaoGateway` → `prd-sial-integracao-sefaz`/`-receita`/`-mainframe` (stub aqui).
- Abre os gateways de decisão: `prd-sial-decisao-deferir`, `prd-sial-exigencia`, `prd-sial-tramitacao`.
- Fecha a FK `Exigencia.analiseId`.
- Lê `Documento` de `prd-sial-documentos`.

## §11 Faseamento

Fase 1: schema `Analise` (+ FK exigência) → fila com filtros + RLS → iniciar análise (claim) → tela com sync (stub) → parecer → smoke. As decisões plugam nas PRDs próprias.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Fonte externa fora deixa o analista sem dado | M | M | Mostrar dado em cache + carimbo + aviso; permitir decidir com ressalva (PRD resiliência). |
| Dois analistas pegam o mesmo protocolo | M | M | Claim marca em_analise + analista; concorrência tratada na transição. |
| Fila lenta com muitos processos | M | M | Índices status/prazo; paginação. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Tamanho da fila por método | `SELECT m.dominio, count(*) FROM "Processo" p JOIN "Metodo" m ON m.id=p."metodoId" WHERE p.status='enviado_analise' GROUP BY 1` |
| Tempo médio enviado→em_analise (espera na fila) | derivado da tabela `Evento` (transições) |
| Análises por analista | `SELECT "analistaId", count(*) FROM "Analise" GROUP BY 1` |

## §14 Open questions

- ❓ Quais fontes são obrigatórias antes de decidir? **A confirmar com a JUCESP.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §6.3, §6A.3; `Modelagem_de_Dados_SIAL.md` §3.
- DesignSession cards "Fila de análise", "Tela de análise com sincronização de dados externos".

## §16 Stories implementáveis

```yaml
- id: SIAL-ANA-001
  title: Migration — tabela Analise (+ RLS)
  description: Cria Analise conforme §7 (1) com CHECK de decisao e policy de servidor.
  acceptanceCriteria:
    - "decisao CHECK (exigencia/deferir/tramitar/arquivar/proresp)"
    - "Policy analise_servidor existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='Analise'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-ANA-002
  title: Migration — FK Exigencia.analiseId → Analise
  description: Fecha a FK adiada do PRD exigência (§7 (2)).
  acceptanceCriteria:
    - "Constraint Exigencia_analise_fk existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_name='Exigencia_analise_fk'"
      expected: "1"
  dependsOn: [SIAL-ANA-001]
  estimateMinutes: 10
  touches: ["supabase/migrations/"]

- id: SIAL-ANA-003
  title: SincronizacaoGateway — interface + stub
  description: src/lib/sial/sincronizacao-gateway.ts com sync(processo) → fontes [{nome, sincronizadoEm, ok}] (stub determinístico).
  acceptanceCriteria:
    - "Retorna status por fonte (SEFAZ/Receita/mainframe)"
    - "Fonte fora retorna ok=false sem lançar"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 25
  touches: ["src/lib/sial/sincronizacao-gateway.ts"]

- id: SIAL-ANA-004
  title: API fila de análise (filtros + RLS)
  description: GET /api/analise/fila com filtros método/prazo/status; só servidor (RLS).
  acceptanceCriteria:
    - "Retorna processos enviado_analise",
    - "Filtro por método funciona",
    - "Não-servidor recebe 403"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-ANA-001]
  estimateMinutes: 25
  touches: ["src/app/api/analise/fila/route.ts"]

- id: SIAL-ANA-005
  title: API iniciar análise (claim) + parecer + sincronizar
  description: POST iniciar (enviado_analise→em_analise + Analise), POST parecer, POST sincronizar.
  acceptanceCriteria:
    - "iniciar faz claim e cria Analise com analistaId",
    - "iniciar em processo já em_analise por outro retorna 409",
    - "sincronizar retorna status por fonte"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-ANA-001, SIAL-ANA-003]
  estimateMinutes: 30
  touches: ["src/app/api/processos/[id]/analise/iniciar/route.ts", "src/app/api/processos/[id]/analise/parecer/route.ts", "src/app/api/processos/[id]/analise/sincronizar/route.ts"]

- id: SIAL-ANA-006
  title: Tela de fila + tela de análise + types + smoke
  description: Fila com filtros e tela de detalhe (dados+sync+documentos+parecer+botões de decisão). Regenera types; smoke.
  acceptanceCriteria:
    - "Fila abre o protocolo na tela de análise",
    - "Sincronização mostra status por fonte",
    - "Smoke: iniciar análise move para em_analise e grava parecer"
  verifiable:
    - kind: manual_browser
      command_or_query: "Resolvedor abre a fila, entra num protocolo, sincroniza, grava parecer"
      expected: "processo em em_analise, Analise criada"
  dependsOn: [SIAL-ANA-004, SIAL-ANA-005]
  estimateMinutes: 30
  touches: ["src/app/(backoffice)/analise/page.tsx", "src/app/(backoffice)/analise/[id]/page.tsx", "src/lib/supabase/database.types.ts"]
```

**Total: 6 stories, ~140min (~2h20).**
