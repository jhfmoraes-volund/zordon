# PRD — SIAL Decisão: Deferir (autenticação e publicação)

**Reference**: SIAL-DEF
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-identity-access`, `prd-sial-analise`, `prd-sial-documentos`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: deferir = gerar autenticação, atualizar a ficha cadastral, subir a imagem no E2DOC, publicar e notificar (doc §6A.4 "Deferir", §6.3); `autenticacao` 1-1 com processo quando deferido/arquivado; `codigo_validacao` único e não sequencial (modelagem §3, §7, §10).
- **[decisão-sessão]**: a cascata orquestra serviços atrás de interface (Termo, E2DOC, Notificação) — mock no Track A.
- **[inferência]**: schema de `Autenticacao`, geração do `codigoValidacao`, ordem da cascata, paths. A validar.

## Demo/Mock (one-shot)

> Roda em **mock-mode**. A cascata chama `E2docGateway` (mock), `TermoService` (impl em `prd-sial-termo-autenticidade`; no-op seguro até lá) e `NotificacaoService` (impl em `prd-sial-notificacoes`; no-op até lá). O essencial do deferir — transição, `Autenticacao` com código, nova versão de ficha vigente — é real em Supabase. Smoke por `scripts/smoke/decisao-deferir.ts`: defere um processo `em_analise` e confere `deferido` + `Autenticacao` + ficha vigente via SQL.

## §1 Problema

1. O deferimento dispara **várias ações encadeadas** que hoje são manuais e propensas a esquecimento: gerar autenticação, atualizar ficha, subir E2DOC, publicar, notificar (doc §6A.4).
2. O resultado precisa de um **código de validação público, único e não adivinhável** (modelagem §7).
3. A ficha cadastral precisa ser **atualizada e versionada** no deferimento (doc §6.3; modelagem §3).

## §2 Solução em uma frase

A saída **Deferir** do gateway de análise: transiciona o processo para `deferido`, cria a `Autenticacao` com código de validação não sequencial, atualiza a ficha vigente e aciona (via interfaces) a geração do termo, o upload ao E2DOC e a notificação.

## §3 Não-objetivos

- O **layout/PDF** do termo de autenticidade — `prd-sial-termo-autenticidade` (aqui só acionamos via `TermoService`).
- A **página pública** de validação — `prd-sial-validacao-publica` (aqui só geramos o código e publicamos).
- O envio real da **notificação** — `prd-sial-notificacoes` (aqui só o gatilho).
- As saídas **Exigência** e **Tramitar** — PRDs próprios.

## §4 Personas e jornada

- **Resolvedor**: "Quero deferir e que o sistema faça tudo que vem junto — autenticação, ficha, publicação — sem eu esquecer nenhum passo."
- **Requerente**: "Quero ser avisado do deferimento e poder acessar o documento autenticado."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | `Autenticacao` 1-1 com `Processo`, criada no deferir; `codigoValidacao` = token aleatório não sequencial | [doc] modelagem §3, §7, §10 |
| D2 | Cascata do deferir (ordem): transição → `Autenticacao` → ficha vigente → `TermoService.gerar` → `E2docGateway.upload` → publicar (`publicadoEm`) → `NotificacaoService.notificar` | [doc] §6A.4 |
| D3 | `TermoService`/`NotificacaoService` são interfaces com no-op default; impls reais vêm dos PRDs próprios | [decisão-sessão] |
| D4 | Deferir exige `Analise` com `parecer` e processo em `em_analise` | [inferência] (gate de integridade) |
| D5 | Atualizar ficha = nova `FichaCadastralVersao` (vigente=true; anterior vigente=false) | [doc] §6.3; modelagem §3 |

## §6 Arquitetura

```
POST /api/processos/:id/decisao/deferir   (resolvedor, processo em_analise)
   1. valida Analise.parecer
   2. sial_transicao(em_analise → deferido) + Analise.decisao='deferir'
   3. cria Autenticacao(codigoValidacao = token não-seq)
   4. nova FichaCadastralVersao (vigente)            [doc §6.3]
   5. TermoService.gerar(autenticacao) → documentoId  [termo PRD; no-op até lá]
   6. E2docGateway.upload(documento) → e2docId        [mock]
   7. publicar: Autenticacao.publicadoEm = now()
   8. NotificacaoService.notificar(deferimento)        [notif PRD; no-op até lá]
```

## §7 Schema

```sql
-- 1) <data>_sial_autenticacao.sql                 -- [doc modelagem §3/§7/§10]
CREATE TABLE "Autenticacao" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processoId" uuid NOT NULL UNIQUE REFERENCES "Processo"(id) ON DELETE CASCADE,
  "documentoId" uuid REFERENCES "Documento"(id),      -- termo (preenchido pelo TermoService)
  "codigoValidacao" text NOT NULL UNIQUE,             -- não sequencial, não adivinhável
  "publicadoEm" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "Autenticacao_codigo_idx" ON "Autenticacao" ("codigoValidacao");
ALTER TABLE "Autenticacao" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "autenticacao_select" ON "Autenticacao" FOR SELECT USING (EXISTS (
  SELECT 1 FROM "Processo" p WHERE p.id="processoId"
    AND (p."requerenteId"=sial_current_usuario() OR sial_is_servidor())));
-- leitura pública é feita por view dedicada em prd-sial-validacao-publica (sem dados sensíveis)
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/processos/:id/decisao/deferir` | (resolvedor) → executa a cascata → 200 `{autenticacao}`; 409 se não estiver em_analise; 422 sem parecer |
| GET | `/api/processos/:id/autenticacao` | → autenticação do processo (interno) |

## §9 UX

```
┌──── Decisão — protocolo 2026-000123 ───────────────┐
│ Parecer: deferido conforme análise                  │
│ [ Confirmar deferimento ]                            │
│  ao confirmar: gera autenticação, atualiza ficha,    │
│  publica e notifica o requerente.                    │
└──────────────────────────────────────────────────────┘
✓ Deferido — código de validação: 7F3K-9Qsome-token
```

## §10 Integrações

- `prd-sial-analise`: o botão Deferir do gateway chama este endpoint.
- `prd-sial-termo-autenticidade`: implementa `TermoService.gerar`.
- `prd-sial-documentos`: `E2docGateway` para subir o termo.
- `prd-sial-notificacoes`: implementa `NotificacaoService`.
- `prd-sial-validacao-publica`: lê `Autenticacao.codigoValidacao`.

## §11 Faseamento

Fase 1: schema `Autenticacao` → DAL deferir (transição + autenticação + ficha) → interfaces Termo/Notificação (no-op) + E2DOC (mock) → API → smoke. A cascata fica completa quando termo/notificações plugam.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Cascata parcial (falha no meio) deixa estado inconsistente | M | A | Transação no essencial (transição+autenticação+ficha); termo/E2DOC/notif assíncronos e idempotentes (PRD resiliência). |
| Código de validação adivinhável | B | A | Token aleatório longo, UNIQUE, índice; leitura pública por view mínima (PRD validação). |
| Deferir sem análise/parecer | M | M | Gate D4 (422). |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Processos deferidos | `SELECT count(*) FROM "Processo" WHERE status='deferido'` |
| Todo deferido tem autenticação | `SELECT count(*) FROM "Processo" p WHERE p.status='deferido' AND NOT EXISTS (SELECT 1 FROM "Autenticacao" a WHERE a."processoId"=p.id)` → 0 |

## §14 Open questions

- ❓ Quais documentos exatamente sobem ao E2DOC no deferimento? **A confirmar com a JUCESP.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §6.3, §6A.4; `Modelagem_de_Dados_SIAL.md` §3, §7, §10.
- DesignSession card "Decisão: Deferir".

## §16 Stories implementáveis

```yaml
- id: SIAL-DEF-001
  title: Migration — tabela Autenticacao (+ RLS, código único)
  description: Cria Autenticacao conforme §7 com codigoValidacao UNIQUE e policy interna.
  acceptanceCriteria:
    - "Autenticacao.processoId UNIQUE e FK CASCADE"
    - "codigoValidacao UNIQUE com índice"
    - "Policy autenticacao_select existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_indexes WHERE indexname='Autenticacao_codigo_idx'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-DEF-002
  title: Interfaces TermoService + NotificacaoService (no-op default)
  description: src/lib/sial/services/{termo,notificacao}.ts com no-op seguro; impls reais nos PRDs próprios.
  acceptanceCriteria:
    - "TermoService.gerar e NotificacaoService.notificar existem e não quebram"
    - "Default no-op retorna sem efeito colateral"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 20
  touches: ["src/lib/sial/services/termo.ts", "src/lib/sial/services/notificacao.ts"]

- id: SIAL-DEF-003
  title: gerarCodigoValidacao — token não sequencial
  description: util que gera token aleatório legível e não adivinhável; checa colisão.
  acceptanceCriteria:
    - "Gera token >= 16 chars não sequencial"
    - "Regera em caso de colisão"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 15
  touches: ["src/lib/sial/codigo-validacao.ts"]

- id: SIAL-DEF-004
  title: DAL deferir — cascata completa
  description: src/lib/sial/dal/deferir.ts orquestra transição + Autenticacao + ficha vigente + Termo/E2DOC/Notificação (interfaces).
  acceptanceCriteria:
    - "Exige em_analise + Analise.parecer (senão erro)"
    - "Cria Autenticacao e nova FichaCadastralVersao vigente"
    - "Chama E2docGateway (mock) e os serviços (no-op) sem quebrar"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DEF-001, SIAL-DEF-002, SIAL-DEF-003]
  estimateMinutes: 30
  touches: ["src/lib/sial/dal/deferir.ts"]

- id: SIAL-DEF-005
  title: API deferir + autenticacao + types
  description: POST /api/processos/:id/decisao/deferir, GET autenticacao; regenera types.
  acceptanceCriteria:
    - "Deferir fora de em_analise retorna 409"
    - "Sem parecer retorna 422"
    - "Sucesso retorna 200 com autenticacao"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DEF-004]
  estimateMinutes: 25
  touches: ["src/app/api/processos/[id]/decisao/deferir/route.ts", "src/app/api/processos/[id]/autenticacao/route.ts", "src/lib/supabase/database.types.ts"]

- id: SIAL-DEF-006
  title: Smoke — deferimento end-to-end (mock)
  description: scripts/smoke/decisao-deferir.ts defere um processo em_analise e valida a cascata essencial.
  acceptanceCriteria:
    - "Processo fica deferido"
    - "Autenticacao criada com codigoValidacao"
    - "Nova FichaCadastralVersao vigente"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Autenticacao\" a JOIN \"Processo\" p ON p.id=a.\"processoId\" WHERE p.status='deferido'"
      expected: ">=1"
  dependsOn: [SIAL-DEF-005]
  estimateMinutes: 25
  touches: ["scripts/smoke/decisao-deferir.ts"]
```

**Total: 6 stories, ~135min (~2h15).**
