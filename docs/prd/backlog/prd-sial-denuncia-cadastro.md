# PRD — SIAL Denúncia: Cadastro e Abertura

**Reference**: SIAL-DEN
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-identity-access`, `prd-sial-diretorio-publico`, `prd-sial-documentos`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: cidadão escolhe denunciar leiloeiro/tradutor, **busca o profissional**, cadastra a denúncia, gera documentos e envia para análise (doc §6.5, §6A.5); `denuncia` é subtipo de `processo`: `denunciante_id, alvo_tipo (leiloeiro/tradutor), alvo_id, descricao` (modelagem §3).
- **[decisão-sessão]**: reusa o núcleo de Processo (tipo=denuncia) e o motor de documentos.
- **[inferência]**: schema de `Denuncia`, anexos como `Documento`, paths. A validar.

## Demo/Mock (one-shot)

> Roda em **mock-mode**. Busca do alvo via diretório público (real). Anexos de prova usam `StorageGateway` mock. Smoke por `scripts/smoke/denuncia-cadastro.ts`: cidadão busca profissional, cria denúncia, anexa prova, envia → `Processo(tipo=denuncia, status=pendente)` via SQL.

## §1 Problema

1. A denúncia é **fluxo novo** e hoje não tem canal digital estruturado (doc §6.5, §6A.5).
2. O cidadão precisa **encontrar o profissional**, descrever a denúncia e **anexar provas**, gerando um protocolo que entra na análise.

## §2 Solução em uma frase

Permite ao cidadão abrir uma **denúncia** contra leiloeiro/tradutor — buscando o alvo, descrevendo, anexando provas — criando um `Processo(tipo=denuncia)` que entra na fila de análise, reusando o motor genérico.

## §3 Não-objetivos

- A **análise** da denúncia (despacho, arquivar/tramitar/PRORESP) — `prd-sial-denuncia-analise`.
- Diretório de profissionais — `prd-sial-diretorio-publico` (aqui só consome a busca).

## §4 Personas e jornada

- **Denunciante**: "Quero achar o leiloeiro, descrever o que aconteceu, anexar provas e enviar — e acompanhar pelo protocolo."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | `Denuncia` 1:1 com `Processo(tipo=denuncia)`: `denuncianteId`, `alvoTipo`, `alvoId`, `descricao` | [doc] modelagem §3 |
| D2 | `alvoTipo` ∈ leiloeiro/tradutor; `alvoId` referencia `Cadastro` | [doc] §6.5; gap G12 (só leiloeiro/tradutor?) |
| D3 | Provas são `Documento(origem=upload)` ligados ao processo | [doc] §6.5; [decisão-sessão] |
| D4 | Enviar: cria/usa `Processo` e transiciona para `pendente` (estado inicial da denúncia) | [doc] §6A.5; modelagem §4 |
| D5 | Denunciante pode ser externo autenticado (dev-auth na demo) | [inferência] |

## §6 Arquitetura

```
[Denunciante] busca alvo (diretório público)
   POST /api/denuncias { alvoTipo, alvoId, descricao }
     ├─ cria Processo(tipo=denuncia, status=rascunho) + Protocolo
     └─ cria Denuncia(denuncianteId, alvoTipo, alvoId, descricao)
   POST .../documentos/upload  (provas)
   POST /api/denuncias/:id/enviar → sial_transicao(rascunho → pendente)
```

## §7 Schema

```sql
-- 1) <data>_sial_denuncia.sql                      -- [doc modelagem §3]
CREATE TABLE "Denuncia" (
  "processoId" uuid PRIMARY KEY REFERENCES "Processo"(id) ON DELETE CASCADE,
  "denuncianteId" uuid REFERENCES "Usuario"(id),
  "alvoTipo" text NOT NULL CHECK ("alvoTipo" IN ('leiloeiro','tradutor')),
  "alvoId" uuid REFERENCES "Cadastro"(id),
  descricao text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Denuncia_alvo_idx" ON "Denuncia" ("alvoTipo","alvoId");
ALTER TABLE "Denuncia" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "denuncia_select" ON "Denuncia" FOR SELECT USING (EXISTS (
  SELECT 1 FROM "Processo" p WHERE p.id="processoId"
    AND (p."requerenteId"=sial_current_usuario() OR sial_is_servidor())));
```

> `Processo.requerenteId` guarda o denunciante (reuso do campo) — **[decisão-sessão]**: evita coluna nova; `Denuncia.denuncianteId` redundante para clareza/consulta.

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/denuncias` | `{alvoTipo, alvoId, descricao}` → cria Processo+Protocolo+Denuncia (rascunho) → 201 |
| GET | `/api/denuncias/:id` | → denúncia + alvo + provas |
| POST | `/api/denuncias/:id/enviar` | valida descrição/alvo → transição rascunho→pendente → 200 |

## §9 UX

```
┌──── Nova denúncia ────────────────────────────┐
│ Profissional: João Leiloeiro (leiloeiro)       │  ← do diretório
│ Descrição: [_____________________________]     │
│ Provas: [ anexar arquivos ]                    │
│                         [ Enviar denúncia ]     │
└─────────────────────────────────────────────────┘
```

## §10 Integrações

- Busca do alvo: `prd-sial-diretorio-publico`.
- Provas: `prd-sial-documentos`.
- Análise: `prd-sial-denuncia-analise` (consome o processo pendente).
- Núcleo: `Processo(tipo=denuncia)` + state machine.

## §11 Faseamento

Fase 1: schema `Denuncia` → criação (rascunho) → anexo de provas → enviar (→pendente) → smoke. A análise pluga depois.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Denúncia caluniosa/spam | M | M | Denunciante autenticado; auditoria em Evento; rate limiting na criação. |
| Alvo inexistente no diretório | M | B | `alvoId` referencia Cadastro; validar na criação. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Denúncias por alvo | `SELECT "alvoTipo", count(*) FROM "Denuncia" GROUP BY 1` |
| Denúncias enviadas (pendentes) | `SELECT count(*) FROM "Processo" WHERE tipo='denuncia' AND status='pendente'` |

## §14 Open questions

- ❓ (gap G12) Denúncia só contra leiloeiro/tradutor, ou também empresa/livro? **Assumido leiloeiro/tradutor (D2); validar.**
- ❓ Denúncia anônima é permitida? **Assumido autenticada; validar com a JUCESP.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §6.5, §6A.5; `Modelagem_de_Dados_SIAL.md` §3, §4.
- DesignSession card "Cadastro e abertura de Denúncia"; gap G12.

## §16 Stories implementáveis

```yaml
- id: SIAL-DEN-001
  title: Migration — tabela Denuncia (+ RLS)
  description: Cria Denuncia conforme §7 com CHECK de alvoTipo e policy de SELECT.
  acceptanceCriteria:
    - "Denuncia.processoId PK e FK CASCADE"
    - "alvoTipo CHECK ('leiloeiro','tradutor')"
    - "Policy denuncia_select existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='Denuncia'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-DEN-002
  title: DAL denúncia — create + enviar
  description: src/lib/sial/dal/denuncia.ts. create faz Processo(tipo=denuncia)+Protocolo+Denuncia; enviar transiciona rascunho→pendente.
  acceptanceCriteria:
    - "create cria as 3 entidades atomicamente"
    - "enviar exige descrição e alvo válido"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DEN-001]
  estimateMinutes: 30
  touches: ["src/lib/sial/dal/denuncia.ts"]

- id: SIAL-DEN-003
  title: API denúncia (criar / obter / enviar)
  description: POST /api/denuncias, GET /:id, POST /:id/enviar.
  acceptanceCriteria:
    - "POST cria denúncia em rascunho",
    - "enviar transiciona para pendente",
    - "alvo inexistente retorna 422"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DEN-002]
  estimateMinutes: 25
  touches: ["src/app/api/denuncias/route.ts", "src/app/api/denuncias/[id]/route.ts", "src/app/api/denuncias/[id]/enviar/route.ts"]

- id: SIAL-DEN-004
  title: Tela de denúncia (busca alvo + descrição + provas)
  description: Página que recebe o alvo (do diretório), coleta descrição, anexa provas (documentos) e envia.
  acceptanceCriteria:
    - "Alvo pré-selecionado vindo do diretório",
    - "Anexo de provas via módulo de documentos",
    - "Enviar cria processo pendente"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DEN-003]
  estimateMinutes: 30
  touches: ["src/app/(portal)/denuncias/nova/page.tsx"]

- id: SIAL-DEN-005
  title: Smoke — abertura de denúncia + types
  description: scripts/smoke/denuncia-cadastro.ts cria e envia uma denúncia; regenera types.
  acceptanceCriteria:
    - "Processo(tipo=denuncia, status=pendente) criado",
    - "Denuncia ligada ao alvo",
    - "Prova anexada como Documento"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Processo\" WHERE tipo='denuncia' AND status='pendente'"
      expected: ">=1"
  dependsOn: [SIAL-DEN-004]
  estimateMinutes: 20
  touches: ["scripts/smoke/denuncia-cadastro.ts", "src/lib/supabase/database.types.ts"]
```

**Total: 5 stories, ~125min (~2h05).**
