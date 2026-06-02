# PRD — SIAL Domínio Tradutor (tradutor juramentado)

**Reference**: SIAL-TRA
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (React + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-requerimento`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: tradutores juramentados têm cadastro e requerimentos próprios; módulo TRADUTORES é revisado/novo (doc §3.1, §6A.1); requerimento `dominio=tradutor` (modelagem §3).
- **[inferência]**: campos do método tradutor (idiomas, habilitação) e validações. A validar com a JUCESP.

## Demo/Mock (one-shot)

> Roda em **mock-mode**. O `HabilitacaoLookup` vem de `getGateways()` (stub). Sem tabela nova (reusa `Cadastro`+JSONB). Smoke por `scripts/smoke/dominio-tradutor.ts`: requerimento de tradutor com idiomas/habilitação → `aguardando_pagamento` via SQL.

## §1 Problema

1. Tradutores juramentados são atendidos **manualmente** hoje e o módulo é tratado como revisado/novo (doc §3.1, §6A.1).
2. O tradutor tem **cadastro próprio** (idiomas, dados de habilitação) que difere de livro e leiloeiro.

## §2 Solução em uma frase

Especializa o motor de requerimento para o domínio **Tradutor**, com método e ficha próprios (idiomas, habilitação), produzindo um `Processo(tipo=requerimento, dominio=tradutor)`.

## §3 Não-objetivos

- Assinatura e análise — PRDs próprios.
- Validação externa da habilitação do tradutor — stub aqui; fonte a confirmar.

## §4 Personas e jornada

- **Requerente (tradutor)**: "Quero abrir meu requerimento informando meus idiomas e habilitação, sem ir presencialmente à Junta."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | Domínio tradutor via `Requerimento(dominio=tradutor)`; ficha em `Cadastro(tipo=tradutor)` + `dados` JSONB | [doc] modelagem §3 |
| D2 | Campos do método: `idiomas` (lista), `numeroHabilitacao`, `dataHabilitacao` | [doc] §3.1; [inferência] lista exata |
| D3 | Validação de habilitação atrás de interface (stub) | [inferência] |
| D4 | Seed do `Metodo` (dominio=tradutor) com `schemaFormulario` | [decisão-sessão] |

## §6 Arquitetura

```
Metodo(dominio=tradutor) ──► motor de requerimento (DynamicForm)
POST /api/requerimentos {dominio:tradutor}
   ├─ cria Requerimento(dominio=tradutor)
   └─ vincula/cria Cadastro(tipo=tradutor) + FichaCadastralVersao
   ▼ submit valida idiomas/habilitação → aguardando_pagamento
```

## §7 Schema

```sql
-- 1) <data>_sial_metodo_tradutor_seed.sql         -- [decisão-sessão]; campos [doc §3.1]+[inferência]
INSERT INTO "Metodo" (nome, dominio, "schemaFormulario", ativo) VALUES
('Tradutor Juramentado', 'tradutor', '{
  "campos": [
    {"key":"idiomas","label":"Idiomas","type":"multiselect","required":true},
    {"key":"numeroHabilitacao","label":"Número de habilitação","type":"text","required":true},
    {"key":"dataHabilitacao","label":"Data de habilitação","type":"date","required":false}
  ]
}'::jsonb, true);
```

> Não cria tabela nova: reusa `Cadastro(tipo='tradutor')` + `FichaCadastralVersao` (de `prd-sial-requerimento`) e `Processo.dados`. **[decisão-sessão]** — evita explosão de tabelas por domínio quando os campos cabem no híbrido JSONB.

## §8 APIs

Reusa integralmente as APIs do motor de requerimento (dominio=tradutor). Adiciona:

| Método | Path | Contrato |
|--------|------|----------|
| GET | `/api/validacao/habilitacao/:numero` | (stub) → `{valido:boolean}` |

## §9 UX

```
┌──── Requerimento de tradutor ───────────────────┐
│ Idiomas [ Inglês ✕ ] [ Espanhol ✕ ] [ + ]       │
│ Nº de habilitação [____________]  [Validar]      │
│ Data de habilitação [ __/__/____ ]               │
│                         [ Enviar para análise ]  │
└───────────────────────────────────────────────────┘
```

## §10 Integrações

- Estende `prd-sial-requerimento` (motor, DynamicForm com tipo `multiselect`).
- Validação de habilitação: stub; fonte externa a confirmar.

## §11 Faseamento

Fase 1: seed do método tradutor → suporte a campo `multiselect` no DynamicForm → validação stub → smoke. Sem tabela nova (híbrido JSONB).

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Campos do tradutor exigem estrutura além de JSONB | B | M | Migrar para colunas/tabela só se a JUCESP exigir consulta relacional sobre eles. |
| Sem fonte para validar habilitação | M | B | Stub + flag até confirmação. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Requerimentos de tradutor concluídos | `SELECT count(*) FROM "Requerimento" WHERE dominio='tradutor'` |

## §14 Open questions

- ❓ Lista oficial de idiomas e formato da habilitação? **Genérico até a JUCESP definir.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §3.1, §6A.1; `Modelagem_de_Dados_SIAL.md` §3.
- DesignSession card "Requerimento de Tradutor juramentado".

## §16 Stories implementáveis

```yaml
- id: SIAL-TRA-001
  title: Seed — Metodo tradutor
  description: Insere o método tradutor com schemaFormulario de §7 (1).
  acceptanceCriteria:
    - "Existe Metodo com dominio='tradutor' ativo"
    - "schemaFormulario tem campo idiomas multiselect"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Metodo\" WHERE dominio='tradutor' AND ativo"
      expected: "1"
  dependsOn: []
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-TRA-002
  title: DynamicForm — suporte a campo multiselect
  description: Adiciona o tipo multiselect ao DynamicForm (do PRD requerimento), com chips de seleção.
  acceptanceCriteria:
    - "Campo multiselect renderiza e persiste lista no dados"
    - "Obrigatório vazio marca erro"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 25
  touches: ["src/components/sial/dynamic-form.tsx"]

- id: SIAL-TRA-003
  title: Validação de habilitação (stub) + DAL tradutor
  description: src/lib/sial/dominio/tradutor.ts com validate(dados) e HabilitacaoLookup (stub). Vincula Cadastro(tipo=tradutor).
  acceptanceCriteria:
    - "validate exige idiomas não vazio e numeroHabilitacao",
    - "HabilitacaoLookup stub determinístico"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 25
  touches: ["src/lib/sial/dominio/tradutor.ts"]

- id: SIAL-TRA-004
  title: API validação habilitação + integrar ao submit + smoke
  description: GET /api/validacao/habilitacao/:numero (stub); submit do tradutor roda validate; smoke ponta-a-ponta.
  acceptanceCriteria:
    - "GET retorna {valido}"
    - "submit sem idiomas retorna 422"
    - "Smoke: requerimento de tradutor → aguardando_pagamento"
  verifiable:
    - kind: manual_browser
      command_or_query: "Abrir requerimento de tradutor, preencher idiomas/habilitação, enviar"
      expected: "processo em aguardando_pagamento"
  dependsOn: [SIAL-TRA-001, SIAL-TRA-002, SIAL-TRA-003]
  estimateMinutes: 25
  touches: ["src/app/api/validacao/habilitacao/[numero]/route.ts", "src/lib/sial/dal/requerimento.ts"]
```

**Total: 4 stories, ~90min (~1h30).**
