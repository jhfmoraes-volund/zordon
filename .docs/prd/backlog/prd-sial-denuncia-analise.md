# PRD — SIAL Denúncia: Análise e Decisão

**Reference**: SIAL-DENA
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-analise`, `prd-sial-denuncia-cadastro`, `prd-sial-tramitacao`, `prd-sial-decisao-deferir`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: buscar denúncia pendente → analisar → criar despacho → assinar → notificar → decisão (tramitar/arquivar/PRORESP) (doc §6A.5); sub-fluxos **idênticos ao requerimento**; **arquivar = mesma sequência do Deferir**; tramitar/receber trâmite genéricos (doc §6A.5, §6A.6); `despacho (processo_id, analise_id, conteudo)` e estados pendente→em_analise→despachada→tramitada/arquivada/proresp (modelagem §3, §4).
- **[decisão-sessão]**: reusa `Analise`, o bloco de tramitação e a cascata de deferir.
- **[inferência]**: schema de `Despacho`, paths. A validar.

## Demo/Mock (one-shot)

> Roda em **mock-mode**. Reusa `Analise` (real), `Tramite` (real) e a cascata de arquivar (E2DOC/Termo/Notificação mock). Smoke por `scripts/smoke/denuncia-analise.ts`: pega denúncia `pendente`, analisa, despacha e decide (arquivar/tramitar/PRORESP) — verificado por SQL nas transições e em `Despacho`.

## §1 Problema

1. Sem fluxo digital, a denúncia **não tem rastreabilidade** nem encaminhamento padronizado (doc §6A.5).
2. A análise da denúncia precisa de **despacho** e de uma **decisão** entre tramitar, arquivar ou PRORESP (doc §6A.5).

## §2 Solução em uma frase

A análise da denúncia: fila de pendentes, despacho, assinatura e decisão (**tramitar / arquivar / PRORESP**), reusando `Analise`, o bloco de tramitação e a cascata de arquivamento.

## §3 Não-objetivos

- Abertura da denúncia — `prd-sial-denuncia-cadastro`.
- O bloco genérico de tramitação — `prd-sial-tramitacao` (aqui só acionado).

## §4 Personas e jornada

- **Resolvedor**: "Quero analisar a denúncia, registrar meu despacho e decidir entre arquivar, tramitar para um setor ou encaminhar à PRORESP."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | `Despacho (processoId, analiseId, conteudo)` registra o parecer da denúncia | [doc] modelagem §3 |
| D2 | Estados: `pendente → em_analise → despachada → {tramitado | arquivado | proresp}` | [doc] §6A.5; modelagem §4 (mapeado aos enums do core) |
| D3 | **Arquivar** reusa a cascata de `prd-sial-decisao-deferir` (autenticação/ficha/E2DOC/publicar/notificar) | [doc] §6A.5 ("Arquivar = mesma sequência do Deferir") |
| D4 | **Tramitar** e **PRORESP** reusam `prd-sial-tramitacao` (PRORESP = área destino) | [doc] §6A.5 |
| D5 | Reusa `Analise` (analistaId/parecer) já existente | [decisão-sessão] |

## §6 Arquitetura

```
GET /api/denuncias/fila → Processo(tipo=denuncia, status=pendente)
POST /api/processos/:id/denuncia/analisar → pendente→em_analise + Analise
POST /api/processos/:id/denuncia/despacho { conteudo } → Despacho + em_analise→despachada
POST /api/processos/:id/denuncia/decidir { decisao }
   ├─ arquivar → cascata de deferir (status arquivado)
   ├─ tramitar → bloco tramitação (status tramitado)
   └─ proresp  → tramitar p/ área PRORESP (status proresp)
```

## §7 Schema

```sql
-- 1) <data>_sial_despacho.sql                      -- [doc modelagem §3]
CREATE TABLE "Despacho" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processoId" uuid NOT NULL REFERENCES "Processo"(id) ON DELETE CASCADE,
  "analiseId" uuid REFERENCES "Analise"(id),
  conteudo text NOT NULL,
  "criadoPor" uuid REFERENCES "Usuario"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Despacho_processo_idx" ON "Despacho" ("processoId");
ALTER TABLE "Despacho" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "despacho_servidor" ON "Despacho" FOR ALL
  USING (sial_is_servidor()) WITH CHECK (sial_is_servidor());
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET | `/api/denuncias/fila` | (servidor) denúncias pendentes |
| POST | `/api/processos/:id/denuncia/analisar` | pendente→em_analise + Analise → 200 |
| POST | `/api/processos/:id/denuncia/despacho` | `{conteudo}` → Despacho + em_analise→despachada → 201 |
| POST | `/api/processos/:id/denuncia/decidir` | `{decisao:'arquivar'|'tramitar'|'proresp', areaDestinoId?}` → executa e transiciona → 200 |

## §9 UX

```
┌──── Análise de denúncia — 2026-000130 ─────────┐
│ Alvo: João Leiloeiro · Descrição: ...           │
│ Provas: [doc1.pdf]                               │
│ Despacho: [____________________]                 │
│ Decisão: [ Arquivar ] [ Tramitar ] [ PRORESP ]   │
└───────────────────────────────────────────────────┘
```

## §10 Integrações

- `prd-sial-denuncia-cadastro`: fornece o processo pendente.
- `prd-sial-analise`: `Analise`.
- `prd-sial-tramitacao`: tramitar/PRORESP.
- `prd-sial-decisao-deferir`: cascata de arquivar.
- `prd-sial-assinatura`/`prd-sial-notificacoes`: assinatura do despacho e aviso ao profissional.

## §11 Faseamento

Fase 1: schema `Despacho` → fila de denúncias → analisar → despacho → decidir (arquivar/tramitar/PRORESP) → smoke. Reusa cascata e tramitação existentes.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| "Arquivar = Deferir" gerar autenticação indevida | M | M | Seguir doc §6A.5; revisar com a JUCESP se arquivamento realmente emite termo. |
| PRORESP sem área cadastrada | M | B | Garantir área PRORESP no seed/admin (tramitação). |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Denúncias por desfecho | `SELECT status, count(*) FROM "Processo" WHERE tipo='denuncia' GROUP BY 1` |
| Tempo médio pendente→decisão | derivado de `Evento` |

## §14 Open questions

- ❓ Arquivar denúncia realmente emite termo/autenticação? **Seguindo doc §6A.5; validar.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §6A.5, §6A.6; `Modelagem_de_Dados_SIAL.md` §3, §4.
- DesignSession card "Análise de Denúncia (despacho e decisão)".

## §16 Stories implementáveis

```yaml
- id: SIAL-DENA-001
  title: Migration — tabela Despacho (+ RLS)
  description: Cria Despacho conforme §7 com policy de servidor.
  acceptanceCriteria:
    - "Despacho.processoId FK CASCADE; analiseId FK"
    - "Policy despacho_servidor existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='Despacho'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-DENA-002
  title: API fila de denúncias + analisar
  description: GET /api/denuncias/fila e POST analisar (pendente→em_analise + Analise).
  acceptanceCriteria:
    - "Fila lista denúncias pendentes (servidor)"
    - "analisar cria Analise e transiciona"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DENA-001]
  estimateMinutes: 25
  touches: ["src/app/api/denuncias/fila/route.ts", "src/app/api/processos/[id]/denuncia/analisar/route.ts"]

- id: SIAL-DENA-003
  title: API despacho
  description: POST despacho cria Despacho e transiciona em_analise→despachada.
  acceptanceCriteria:
    - "Despacho criado com conteudo",
    - "Processo vira despachada"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DENA-002]
  estimateMinutes: 25
  touches: ["src/app/api/processos/[id]/denuncia/despacho/route.ts"]

- id: SIAL-DENA-004
  title: API decidir (arquivar/tramitar/PRORESP) — reuso
  description: POST decidir roteia para cascata de deferir (arquivar), tramitação (tramitar) ou tramitar p/ PRORESP.
  acceptanceCriteria:
    - "arquivar leva a status arquivado (cascata reusada)",
    - "tramitar/proresp criam Tramite e transicionam",
    - "decisão inválida retorna 422"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DENA-003]
  estimateMinutes: 30
  touches: ["src/app/api/processos/[id]/denuncia/decidir/route.ts"]

- id: SIAL-DENA-005
  title: Tela de análise de denúncia + types + smoke
  description: Tela com alvo/provas/despacho/decisão; types; smoke do fluxo até cada desfecho.
  acceptanceCriteria:
    - "Tela permite despachar e decidir",
    - "Smoke: pendente→...→arquivado e tramitado funcionam"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Despacho\""
      expected: ">=1"
  dependsOn: [SIAL-DENA-004]
  estimateMinutes: 30
  touches: ["src/app/(backoffice)/denuncias/[id]/page.tsx", "scripts/smoke/denuncia-analise.ts", "src/lib/supabase/database.types.ts"]
```

**Total: 5 stories, ~125min (~2h05).**
