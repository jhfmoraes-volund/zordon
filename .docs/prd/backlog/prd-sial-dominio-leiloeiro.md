# PRD — SIAL Domínio Leiloeiro (caução e termo de compromisso)

**Reference**: SIAL-LEI
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (React + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-requerimento`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: leiloeiro tem cadastro, requerimentos e protocolos específicos, incluindo **caução** e **termo de compromisso** (doc §3.1, §6.2); processo manual hoje; requerimento `dominio=leiloeiro` (modelagem §3).
- **[inferência]**: modelar `Caucao` como entidade própria, campos do método leiloeiro, termo de compromisso como documento assinável, validações. A validar com a JUCESP.

## Demo/Mock (one-shot)

> Roda em **mock-mode**. Caução e termo de compromisso são entidades/documentos reais em Supabase; a geração de PDF do termo usa o `StorageGateway` mock (in-memory) de `prd-sial-documentos`. Smoke por `scripts/smoke/dominio-leiloeiro.ts`: cadastro + caução registrada + termo gerado → `aguardando_pagamento` via SQL.

## §1 Problema

1. O fluxo do leiloeiro é hoje **totalmente manual** e tem etapas exclusivas — **caução** e **termo de compromisso** — que os outros domínios não têm (doc §3.1, §6.2).
2. Sem digitalizar essas etapas, o leiloeiro não consegue abrir requerimento online de ponta a ponta.

## §2 Solução em uma frase

Especializa o motor de requerimento para o domínio **Leiloeiro**, adicionando o registro de **caução** e o **termo de compromisso** assinável ao fluxo, produzindo um `Processo(tipo=requerimento, dominio=leiloeiro)`.

## §3 Não-objetivos

- Assinatura do termo em si — `prd-sial-assinatura` (aqui geramos o documento e marcamos a pendência).
- Análise/deferimento — PRDs de análise/decisão.
- Geração/combinação de PDFs do termo — `prd-sial-documentos` (aqui referenciamos o documento).

## §4 Personas e jornada

- **Requerente (leiloeiro)**: "Quero me cadastrar, registrar a caução, assinar o termo de compromisso e enviar meu requerimento, tudo online."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | `Caucao` como entidade própria (valor, status, comprovante) ligada ao processo | [doc] §6.2 (etapa existe); [inferência] modelagem como tabela |
| D2 | Termo de compromisso = `Documento` assinável gerado no fluxo; pendência de assinatura registrada | [doc] §6.2; [inferência] reuso do módulo de documentos |
| D3 | Método leiloeiro com `schemaFormulario` próprio (dados do leiloeiro) | [decisão-sessão] |
| D4 | Caução exige comprovante (referência de arquivo) e tem status `pendente/registrada` | [inferência] |

## §6 Arquitetura

```
Metodo(dominio=leiloeiro) ──► motor de requerimento
POST /api/requerimentos {dominio:leiloeiro}
   ├─ cria Requerimento(dominio=leiloeiro)
   ├─ registra Caucao(processoId, valor, status=pendente, comprovanteRef)
   └─ gera Documento "termo de compromisso" (pendente de assinatura)
   ▼ submit valida caução registrada + termo gerado → aguardando_pagamento
```

## §7 Schema

```sql
-- 1) <data>_sial_caucao.sql                      -- [doc] §6.2 (etapa); [inferência] modelagem
CREATE TABLE "Caucao" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processoId" uuid NOT NULL REFERENCES "Processo"(id) ON DELETE CASCADE,
  valor numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','registrada')),
  "comprovanteRef" text,                          -- referência ao documento/arquivo
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Caucao_processo_idx" ON "Caucao" ("processoId");
ALTER TABLE "Caucao" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "caucao_select" ON "Caucao" FOR SELECT USING (EXISTS (
  SELECT 1 FROM "Processo" p WHERE p.id="processoId"
    AND (p."requerenteId"=sial_current_usuario() OR sial_is_servidor())));
```

```sql
-- 2) <data>_sial_metodo_leiloeiro_seed.sql        -- [decisão-sessão]
INSERT INTO "Metodo" (nome, dominio, "schemaFormulario", ativo) VALUES
('Leiloeiro', 'leiloeiro', '{
  "campos": [
    {"key":"nomeLeiloeiro","label":"Nome do leiloeiro","type":"text","required":true},
    {"key":"matricula","label":"Matrícula","type":"text","required":false},
    {"key":"valorCaucao","label":"Valor da caução","type":"number","required":true}
  ]
}'::jsonb, true);
```

## §8 APIs

Reusa o motor de requerimento. Adiciona:

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/processos/:id/caucao` | `{valor, comprovanteRef}` → registra caução → 201 |
| GET | `/api/processos/:id/caucao` | → caução do processo |
| POST | `/api/processos/:id/termo-compromisso` | gera o documento do termo (pendente de assinatura) → 201 |

## §9 UX

```
┌──── Requerimento de leiloeiro ──────────────────┐
│ Nome [________________]  Matrícula [________]    │
│ Caução: valor R$ [______]  comprovante [anexar]  │
│ Termo de compromisso: [ Gerar e assinar ]        │
│   ● caução pendente · ● termo pendente           │
│                         [ Enviar para análise ]  │
└───────────────────────────────────────────────────┘
```

## §10 Integrações

- Estende `prd-sial-requerimento`.
- `prd-sial-documentos`: gera/armazena o termo de compromisso e o comprovante de caução.
- `prd-sial-assinatura`: assinatura do termo.

## §11 Faseamento

Fase 1: schema `Caucao` → seed método leiloeiro → registro de caução + geração do termo (referência) → gate no submit → smoke.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Regras de caução (valor mínimo, tipo) não claras | M | M | Modelar valor/comprovante genéricos; refinar com a JUCESP. |
| Termo de compromisso tem formato legal específico | M | M | Template no módulo de documentos; revisão jurídica antes de produção. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Requerimentos de leiloeiro concluídos | `SELECT count(*) FROM "Requerimento" WHERE dominio='leiloeiro'` |
| Caução registrada vs pendente | `SELECT status, count(*) FROM "Caucao" GROUP BY 1` |

## §14 Open questions

- ❓ Regras de caução (valor mínimo, formas aceitas)? **Genérico até a JUCESP definir.**
- ❓ Conteúdo legal do termo de compromisso? **Template a validar juridicamente.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §3.1, §6.2; `Modelagem_de_Dados_SIAL.md` §3.
- DesignSession card "Requerimento de Leiloeiro (caução e termo de compromisso)".

## §16 Stories implementáveis

```yaml
- id: SIAL-LEI-001
  title: Migration — tabela Caucao (+ RLS)
  description: Cria Caucao conforme §7 (1) com CHECK de status e policy de SELECT.
  acceptanceCriteria:
    - "Caucao.status CHECK ('pendente','registrada')"
    - "FK processoId ON DELETE CASCADE"
    - "Policy caucao_select existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='Caucao'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-LEI-002
  title: Seed — Metodo leiloeiro
  description: Insere o método leiloeiro com schemaFormulario de §7 (2).
  acceptanceCriteria:
    - "Existe Metodo com dominio='leiloeiro' ativo"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Metodo\" WHERE dominio='leiloeiro' AND ativo"
      expected: "1"
  dependsOn: []
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-LEI-003
  title: DAL + API caução (registrar/consultar)
  description: src/lib/sial/dominio/leiloeiro.ts + POST/GET /api/processos/:id/caucao.
  acceptanceCriteria:
    - "POST registra caução com valor e comprovanteRef",
    - "Registrar exige valor > 0"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-LEI-001]
  estimateMinutes: 25
  touches: ["src/lib/sial/dominio/leiloeiro.ts", "src/app/api/processos/[id]/caucao/route.ts"]

- id: SIAL-LEI-004
  title: Geração do termo de compromisso (referência de documento)
  description: POST /api/processos/:id/termo-compromisso cria a referência do documento (pendente de assinatura). Geração de PDF fica no PRD documentos.
  acceptanceCriteria:
    - "Cria referência de documento 'termo_compromisso' pendente"
    - "Não duplica termo se já existir pendente"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-LEI-002]
  touches: ["src/app/api/processos/[id]/termo-compromisso/route.ts"]
  estimateMinutes: 25

- id: SIAL-LEI-005
  title: Gate no submit + types + smoke
  description: submit do leiloeiro exige caução registrada e termo gerado; regenera types; smoke ponta-a-ponta.
  acceptanceCriteria:
    - "submit sem caução registrada retorna 422"
    - "Smoke: cadastro+caução+termo → aguardando_pagamento"
  verifiable:
    - kind: manual_browser
      command_or_query: "Abrir requerimento de leiloeiro, registrar caução, gerar termo, enviar"
      expected: "processo em aguardando_pagamento com caução registrada"
  dependsOn: [SIAL-LEI-003, SIAL-LEI-004]
  estimateMinutes: 30
  touches: ["src/lib/sial/dal/requerimento.ts", "src/lib/supabase/database.types.ts"]
```

**Total: 5 stories, ~115min (~2h).**
