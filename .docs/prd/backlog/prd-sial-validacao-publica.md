# PRD — SIAL Validação Pública (sem login)

**Reference**: SIAL-PUB
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-decisao-deferir`, `prd-sial-termo-autenticidade`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: validação pública **sem login** com o protocolo/código (RF03, doc §4 Frente 1, §6.4); `codigo_validacao` único, não sequencial, não adivinhável, com **índice próprio** e **view pública mínima** sem dados sensíveis; rate limiting (modelagem §7).
- **[decisão-sessão]**: leitura pública via **view dedicada** no Supabase, exposta por endpoint sem auth.
- **[inferência]**: shape da view, rate limiting, página pública. A validar.

## Demo/Mock (one-shot)

> **Sem gateway externo.** A view e o endpoint são reais em Supabase; a demo usa dados de `prd-sial-mock-data` (autenticações publicadas). Smoke por `scripts/smoke/validacao-publica.ts`: consulta um código válido → válido + termo; código inexistente → não encontrado; confere que a view **não expõe dados sensíveis** (CPF/CNPJ).

## §1 Problema

1. Qualquer pessoa precisa **confirmar a validade** de um documento só com o protocolo/código, **sem cadastro nem login** — é a entrega de fé pública (RF03, doc §4, §6.4).
2. A consulta pública não pode **expor dados sensíveis** nem permitir varredura por códigos sequenciais (modelagem §7).

## §2 Solução em uma frase

Uma página e um endpoint **públicos (sem auth)** que, dado o código de validação, mostram o termo e a confirmação de validade lendo uma **view mínima**, com rate limiting e sem dados sensíveis.

## §3 Não-objetivos

- Geração do termo/código — `prd-sial-decisao-deferir` e `prd-sial-termo-autenticidade`.
- Diretório de profissionais — `prd-sial-diretorio-publico`.

## §4 Personas e jornada

- **Cidadão**: "Quero digitar (ou escanear o QR) o código e ver na hora se o documento é válido, sem me cadastrar."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | Leitura pública por **view** `sial_validacao_publica` que expõe só `codigoValidacao`, status de validade, tipo/identificação não sensível e link do termo | [doc] modelagem §7 |
| D2 | Endpoint **sem auth** `GET /api/publico/validar/:codigo` com **rate limiting** | [doc] §4 (sem login); modelagem §7 |
| D3 | View **não expõe** CPF/CNPJ nem dados pessoais | [doc] §8 (LGPD); modelagem §7 |
| D4 | Código inexistente/não publicado → "não encontrado" (sem vazar existência de processo) | [inferência] |

## §6 Arquitetura

```
[Cidadão] /validar/<codigo>  (sem login)
        │ GET /api/publico/validar/:codigo  (rate limited)
        ▼
   view sial_validacao_publica  (só Autenticacao.publicadoEm IS NOT NULL)
        ├─ válido → { valido:true, tipo, autenticadoEm, termoUrl }
        └─ não encontrado → { valido:false }
```

## §7 Schema

```sql
-- 1) <data>_sial_validacao_publica_view.sql        -- [doc modelagem §7]
CREATE VIEW sial_validacao_publica AS
SELECT
  a."codigoValidacao",
  true AS valido,
  m.dominio AS tipo,                       -- 'livro'/'leiloeiro'/'tradutor' (não sensível)
  pr.numero AS protocolo,
  a."publicadoEm" AS "autenticadoEm",
  a."documentoId"
FROM "Autenticacao" a
JOIN "Processo" p ON p.id = a."processoId"
LEFT JOIN "Metodo" m ON m.id = p."metodoId"
JOIN "Protocolo" pr ON pr."processoId" = p.id
WHERE a."publicadoEm" IS NOT NULL;
-- view sem dados pessoais; acesso público de leitura concedido ao role anônimo
GRANT SELECT ON sial_validacao_publica TO anon;
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET | `/api/publico/validar/:codigo` | **sem auth**, rate limited → `{valido, tipo?, protocolo?, autenticadoEm?, termoUrl?}` |

## §9 UX

```
┌──── Validar autenticidade ────────────────┐
│ Código / protocolo: [______________] [🔍] │
│ ─────────────────────────────────────────│
│ ✓ DOCUMENTO VÁLIDO                         │
│ Livro · Protocolo 2026-000123              │
│ Autenticado em 13/05/2026                  │
│ [ Ver termo ]                              │
└──────────────────────────────────────────────┘
(código inválido → "Documento não encontrado")
```

## §10 Integrações

- Lê `Autenticacao` (de `prd-sial-decisao-deferir`) via view.
- Termo (link) de `prd-sial-termo-autenticidade`; QR do termo aponta para esta página.
- Roda na frente `(publico)` do `prd-sial-app-shell`.

## §11 Faseamento

Fase 1: view pública mínima → endpoint sem auth + rate limiting → página pública + leitura de QR → smoke (válido/inválido/sem-dados-sensíveis).

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Varredura por força bruta de códigos | M | M | Código não sequencial longo + rate limiting + sem enumeração (D4). |
| Vazamento de dado sensível na view | B | A | View lista colunas explicitamente; teste garante ausência de CPF/CNPJ. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Consultas públicas | log de hits no endpoint |
| View sem dado sensível | teste/smoke que falha se CPF/CNPJ aparecer |
| Taxa de "válido" vs "não encontrado" | métrica do endpoint |

## §14 Open questions

- ❓ Aceitar busca por número de protocolo além do código? **Assumido código; protocolo como alternativa a validar.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §4 (RF03), §6.4, §8; `Modelagem_de_Dados_SIAL.md` §7.
- DesignSession card "Validação pública de autenticidade"; risco R4.

## §16 Stories implementáveis

```yaml
- id: SIAL-PUB-001
  title: Migration — view sial_validacao_publica (+ GRANT anon)
  description: Cria a view mínima de §7 e concede SELECT ao role anônimo.
  acceptanceCriteria:
    - "View sial_validacao_publica existe"
    - "View não inclui colunas de CPF/CNPJ/dados pessoais"
    - "anon tem SELECT na view"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.views WHERE table_name='sial_validacao_publica'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-PUB-002
  title: Rate limiting util
  description: src/lib/sial/rate-limit.ts (por IP/janela) reutilizável no endpoint público.
  acceptanceCriteria:
    - "Bloqueia após N hits na janela"
    - "Resetа após a janela"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 20
  touches: ["src/lib/sial/rate-limit.ts"]

- id: SIAL-PUB-003
  title: API pública GET /api/publico/validar/:codigo
  description: Endpoint sem auth lendo a view, com rate limiting; não vaza existência de processo.
  acceptanceCriteria:
    - "Código válido retorna {valido:true, tipo, protocolo, autenticadoEm}"
    - "Código inexistente retorna {valido:false}"
    - "Excesso de requisições retorna 429"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-PUB-001, SIAL-PUB-002]
  estimateMinutes: 25
  touches: ["src/app/api/publico/validar/[codigo]/route.ts"]

- id: SIAL-PUB-004
  title: Página pública de validação + leitura de QR
  description: Página em (publico) com campo de código e resultado; aceita ?codigo= do QR.
  acceptanceCriteria:
    - "Sem login, mostra válido/não encontrado",
    - "QR /validar?codigo= preenche e consulta automaticamente",
    - "Link 'Ver termo' abre o documento"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-PUB-003]
  estimateMinutes: 30
  touches: ["src/app/(publico)/validar/page.tsx"]

- id: SIAL-PUB-005
  title: Smoke — validação pública (válido/inválido/sem-dados-sensíveis)
  description: scripts/smoke/validacao-publica.ts consulta código válido e inválido e checa ausência de dados sensíveis.
  acceptanceCriteria:
    - "Código publicado retorna valido:true",
    - "Código aleatório retorna valido:false",
    - "Resposta não contém CPF/CNPJ"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.columns WHERE table_name='sial_validacao_publica' AND column_name IN ('documento','cpf','cnpj')"
      expected: "0"
  dependsOn: [SIAL-PUB-004]
  estimateMinutes: 20
  touches: ["scripts/smoke/validacao-publica.ts"]
```

**Total: 5 stories, ~115min (~2h).**
