# PRD — SIAL Termo de Autenticidade (artefato + QR)

**Reference**: SIAL-TERMO
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: `prd-sial-documentos`, `prd-sial-decisao-deferir`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: o termo de autenticidade é o **resultado final** que comprova validade e pode ser checado publicamente (doc §2, §7 "Autenticação de Protocolo"); gerado no deferimento (doc §6A.4); `codigo_validacao` público (modelagem §7).
- **[decisão-sessão]**: gerado pelo módulo de documentos (template+dados) e armazenado como `Documento`.
- **[inferência]**: layout do termo, QR apontando para a validação pública, vínculo `Autenticacao.documentoId`. A validar (layout precisa de revisão jurídica).

## Demo/Mock (one-shot)

> Roda em **mock-mode**. Implementa o `TermoService.gerar` (interface de `prd-sial-decisao-deferir`) usando o `documento-gen` + `StorageGateway` mock de `prd-sial-documentos`. O PDF é gerado de verdade (template + dados + QR); só o destino (Storage/E2DOC) é mock. Smoke por `scripts/smoke/termo-autenticidade.ts`: defere → termo gerado e vinculado à `Autenticacao` via SQL.

## §1 Problema

1. O **termo de autenticidade** é o artefato central do produto e precisa ser **íntegro e verificável** (doc §2, §7).
2. Sem o documento gerado com **código e QR**, o requerente não tem o que apresentar e a validação pública não tem o que mostrar.

## §2 Solução em uma frase

Gera o **Termo de Autenticidade** (PDF padronizado com dados do processo, código de validação e QR apontando para a validação pública), implementando o `TermoService` acionado no deferimento.

## §3 Não-objetivos

- A página pública de validação — `prd-sial-validacao-publica` (o QR aponta para ela).
- O motor genérico de geração/Storage — `prd-sial-documentos` (aqui só o template do termo).
- Layout jurídico final — a validar com a JUCESP (template parametrizável).

## §4 Personas e jornada

- **Requerente**: "Quero baixar o termo do meu documento autenticado, com um QR que qualquer um pode conferir."
- **Cidadão**: "Quero escanear o QR e confirmar a validade."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | `TermoService.gerar(autenticacao)` cria um `Documento(tipo=termo_autenticidade, origem=gerado)` e preenche `Autenticacao.documentoId` | [doc] §6A.4; [decisão-sessão] |
| D2 | Termo carrega o `codigoValidacao` + **QR** com a URL pública `/validar/<codigo>` | [doc] §7; [inferência] no QR |
| D3 | Layout via template parametrizável (header JUCESP, dados do processo, código, QR, data) | [doc] §6A.1 (gerar a partir dos dados); [inferência] no layout |
| D4 | Geração é **idempotente** por autenticação (não duplica termo) | [inferência] |

## §6 Arquitetura

```
deferir → TermoService.gerar(autenticacao)
   ├─ monta dados (processo, protocolo, requerente, data)
   ├─ gera QR(URL pública /validar/<codigo>)
   ├─ documento-gen(template "termo", dados+QR) → PDF → StorageGateway
   ├─ cria Documento(tipo=termo_autenticidade)
   └─ Autenticacao.documentoId = documento.id
```

## §7 Schema

Sem tabela nova — reusa `Documento` e preenche `Autenticacao.documentoId`. **[decisão-sessão]** (evita tabela redundante).

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/processos/:id/termo` | (interno/idempotente) gera o termo se faltar → 201 `{documentoId}` |
| GET | `/api/processos/:id/termo` | → signed URL do termo (via documentos) |

## §9 UX

```
┌──── Termo de Autenticidade ───────────────┐
│  JUNTA COMERCIAL DO ESTADO DE SÃO PAULO    │
│  Protocolo 2026-000123 · Livro Diário      │
│  Autenticado em 13/05/2026                 │
│                                            │
│  Código de validação: 7F3K-9Q...           │
│            ┌─────────┐                     │
│            │ ▣▣ QR ▣ │  validar online     │
│            └─────────┘                     │
└──────────────────────────────────────────────┘
[ Baixar termo (PDF) ]
```

## §10 Integrações

- Implementa `TermoService` de `prd-sial-decisao-deferir`.
- Usa `documento-gen` + `StorageGateway` de `prd-sial-documentos`.
- QR aponta para `prd-sial-validacao-publica`.

## §11 Faseamento

Fase 1: template do termo → geração de QR → `TermoService.gerar` (idempotente) → vínculo na `Autenticacao` → endpoints → smoke. O QR aponta para a rota pública (entregue no PRD de validação).

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Layout do termo sem validade jurídica | M | A | Template parametrizável + revisão jurídica antes de produção. |
| Termo duplicado em re-deferimentos | B | M | Geração idempotente por autenticação (D4). |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Deferidos com termo gerado | `SELECT count(*) FROM "Autenticacao" WHERE "documentoId" IS NOT NULL` |

## §14 Open questions

- ❓ Layout/conteúdo oficial do termo? **Template até a JUCESP fixar.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §2, §6A.1, §6A.4, §7; `Modelagem_de_Dados_SIAL.md` §7.
- DesignSession card "Geração do Termo de Autenticidade".

## §16 Stories implementáveis

```yaml
- id: SIAL-TERMO-001
  title: Gerador de QR (URL pública de validação)
  description: src/lib/sial/qr.ts que gera um QR (dataURL/SVG) para /validar/<codigo>.
  acceptanceCriteria:
    - "Gera QR a partir de uma URL"
    - "URL aponta para /validar/<codigo>"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 20
  touches: ["src/lib/sial/qr.ts"]

- id: SIAL-TERMO-002
  title: Template do termo + TermoService.gerar
  description: src/lib/sial/services/termo-impl.ts implementa TermoService usando documento-gen + StorageGateway; idempotente por autenticação.
  acceptanceCriteria:
    - "Gera Documento(tipo=termo_autenticidade) com dados+QR"
    - "Preenche Autenticacao.documentoId"
    - "Chamar 2x não duplica o termo"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-TERMO-001]
  estimateMinutes: 30
  touches: ["src/lib/sial/services/termo-impl.ts"]

- id: SIAL-TERMO-003
  title: API gerar/obter termo + ligar ao deferir
  description: POST/GET /api/processos/:id/termo; registra a impl como TermoService usado por deferir.
  acceptanceCriteria:
    - "POST gera o termo se faltar (idempotente)"
    - "GET retorna signed URL"
    - "Deferir passa a gerar o termo automaticamente"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-TERMO-002]
  estimateMinutes: 25
  touches: ["src/app/api/processos/[id]/termo/route.ts", "src/lib/sial/services/termo.ts"]

- id: SIAL-TERMO-004
  title: Smoke — termo no deferimento
  description: scripts/smoke/termo-autenticidade.ts defere e confere o termo gerado e vinculado.
  acceptanceCriteria:
    - "Após deferir, Autenticacao.documentoId preenchido"
    - "Documento do tipo termo_autenticidade existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Autenticacao\" WHERE \"documentoId\" IS NOT NULL"
      expected: ">=1"
  dependsOn: [SIAL-TERMO-003]
  estimateMinutes: 20
  touches: ["scripts/smoke/termo-autenticidade.ts"]
```

**Total: 4 stories, ~95min (~1h35).**
