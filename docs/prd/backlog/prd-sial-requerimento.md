# PRD — SIAL Requerimento (motor de formulário por método)

**Reference**: SIAL-REQ
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (React + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-identity-access`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: porta de entrada única por método (doc §6A.2, RF08/RF09), preenchimento assistido da ficha (doc §6.1 passo 3), salvamento de rascunho (doc §9), `Cadastro`/`ficha_cadastral_versao`/`requerimento` (modelagem §3).
- **[decisão-sessão]**: form renderizado de schema JSONB sobre Supabase.
- **[inferência]**: schema concreto das tabelas, autosave com debounce, interface `CadastroLookup`, código 422 no submit, paths de API. A validar com a JUCESP.

## Demo/Mock (one-shot)

> Roda em **mock-mode** (`SIAL_MOCK=1`, ver `prd-sial-app-shell`). O `CadastroLookup` vem de `getGateways()` (stub que devolve uma ficha determinística). Smoke 100% mock por `scripts/smoke/requerimento.ts` (`npm run smoke requerimento`): cria requerimento, autosave, busca ficha, submit → `aguardando_pagamento` via SQL. Impl real (Receita) = Track B, mesma interface.

## §1 Problema

1. Leiloeiros e tradutores são atendidos **manualmente** hoje; cada serviço tem fluxo próprio e desconectado (doc §6A.2).
2. A porta de entrada deveria ser **uma só**, mudando apenas os campos conforme o método escolhido (doc §6A.2, RF08/RF09).
3. Redigitar dados que a Junta já tem é **atrito e fonte de erro** (doc §6.1 passo 3).
4. Formulários longos com dependência externa: se algo falha, o usuário **não pode perder o que preencheu** (doc §9).

## §2 Solução em uma frase

Um motor de requerimento que renderiza o formulário a partir do `schemaFormulario` do método escolhido, com preenchimento assistido da ficha cadastral e salvamento de rascunho, criando o `Processo` (tipo=requerimento) até o envio para análise.

## §3 Não-objetivos

- Editor do `schemaFormulario` (admin cria/edita campos) — `prd-sial-parametrizacao`.
- Campos e regras **específicos** de Livro/Leiloeiro/Tradutor — PRDs de domínio (consomem este motor).
- Pagamento e assinatura — PRDs próprios (este motor entrega o processo pronto para essas etapas).
- Validação real de CNPJ na Receita — `prd-sial-integracao-receita` (aqui stub).

## §4 Personas e jornada

- **Requerente**: "Quero escolher o que preciso, preencher um formulário que já vem com meus dados, e poder parar e voltar sem perder nada."

## §5 Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | Formulário **renderizado do `Metodo.schemaFormulario`** (JSONB); valores em `Processo.dados` | Modelagem §5; motor configurável sem deploy. |
| D2 | `Requerimento` é tabela fina (1:1 com Processo) com `dominio`; o resto vive em `Processo.dados` | Subtipo do núcleo (modelagem §3). |
| D3 | Rascunho = `Processo.status='rascunho'` + **autosave** com debounce em `Processo.dados` | Resiliência (doc §9); reusa a state machine do core. |
| D4 | Ficha assistida via `Cadastro` + `FichaCadastralVersao` (vigente bool) | Versiona histórico (modelagem §3, §11.2). |
| D5 | `submit` valida campos obrigatórios do schema e transiciona para `aguardando_pagamento` | Gate antes do boleto; transição passa por `sial_transicao`. |
| D6 | Validação de CNPJ atrás de interface `CadastroLookup` (stub trocável) | Desacopla do PRD de integração Receita. |

## §6 Arquitetura

```
[Requerente] escolhe método ──► GET /api/metodos
        │
        ▼
POST /api/requerimentos {metodoId, dominio}
        ├─ cria Processo(tipo=requerimento, status=rascunho)
        ├─ cria Protocolo (numero)
        └─ cria Requerimento(processoId, dominio)
        │
        ▼
[DynamicForm] renderiza de Metodo.schemaFormulario
        │  autosave (debounce) ──► PUT /api/requerimentos/:id { dados }
        │  ficha assistida ─────► GET /api/cadastros/:documento (CadastroLookup stub)
        ▼
POST /api/requerimentos/:id/submit
        └─ valida obrigatórios ► sial_transicao(rascunho → aguardando_pagamento)
```

## §7 Schema

```sql
-- 1) <data>_sial_requerimento.sql
CREATE TABLE "Requerimento" (
  "processoId" uuid PRIMARY KEY REFERENCES "Processo"(id) ON DELETE CASCADE,
  dominio text NOT NULL CHECK (dominio IN ('livro','leiloeiro','tradutor')),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "Requerimento" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "requerimento_select" ON "Requerimento" FOR SELECT USING (EXISTS (
  SELECT 1 FROM "Processo" p WHERE p.id="processoId"
    AND (p."requerenteId"=sial_current_usuario() OR sial_is_servidor())));
```

```sql
-- 2) <data>_sial_cadastro.sql
CREATE TABLE "Cadastro" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('empresa','leiloeiro','tradutor')),
  documento text NOT NULL,                 -- CNPJ/CPF
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, documento)
);
ALTER TABLE "Cadastro" ENABLE ROW LEVEL SECURITY;
```

```sql
-- 3) <data>_sial_ficha_versao.sql
CREATE TABLE "FichaCadastralVersao" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cadastroId" uuid NOT NULL REFERENCES "Cadastro"(id) ON DELETE CASCADE,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  vigente boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "FichaVersao_cadastro_idx" ON "FichaCadastralVersao" ("cadastroId", vigente);
ALTER TABLE "FichaCadastralVersao" ENABLE ROW LEVEL SECURITY;
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/requerimentos` | `{metodoId, dominio}` → cria Processo+Protocolo+Requerimento → 201 `{processoId, protocolo}` |
| GET | `/api/requerimentos/:id` | → `{processo, requerimento, schema, dados}` |
| PUT | `/api/requerimentos/:id` | `{dados}` → autosave (só em rascunho) → 204 |
| POST | `/api/requerimentos/:id/submit` | valida obrigatórios do schema → transition → 200 `{status}`; 422 se faltar campo |
| GET | `/api/cadastros/:documento` | ficha assistida (CadastroLookup) → `{dados}` ou 404 |

## §9 UX

```
┌──── Novo requerimento ────────────────────────┐
│ Método: [ Livro ▾ ]                            │
│ ───────────────────────────────────────────── │
│ (campos renderizados do schema do método)      │
│  CNPJ [__________] [Buscar dados]  ✓ preenchido│
│  Período [__/__]   Folhas [____]               │
│                                                 │
│  ⟳ salvo automaticamente · 14:02               │
│                          [ Enviar para análise]│
└─────────────────────────────────────────────────┘
```

## §10 Integrações

- Consome `Metodo.schemaFormulario` (de `prd-sial-parametrizacao`) e a state machine do core.
- `prd-sial-pagamento`: pega o processo em `aguardando_pagamento`.
- PRDs de domínio (Livro/Leiloeiro/Tradutor) estendem o schema e os campos específicos.
- `prd-sial-integracao-receita`: substitui o stub `CadastroLookup`.

## §11 Faseamento

Fase 1: schema (3 tabelas) → criação do requerimento → form dinâmico + autosave → ficha assistida (stub) → submit com validação → smoke. Entrega o fluxo de criação ponta-a-ponta até o gate de pagamento.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Schema de método malformado quebra o render | M | M | Validar schema na leitura; fallback de campo genérico; erro amigável. |
| Autosave concorrente sobrescreve dados | M | M | Salvar só em rascunho; last-write com updatedAt; debounce. |
| Ficha assistida indisponível (Receita fora) | M | B | Stub + degradação: permite preencher manual; alinha com PRD resiliência. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Taxa de conclusão (rascunho → enviado) | `SELECT count(*) FILTER (WHERE status<>'rascunho')::float/count(*) FROM "Processo" WHERE tipo='requerimento'` |
| Uso de ficha assistida | log de hits em `/api/cadastros/:documento` |
| Rascunhos abandonados | `SELECT count(*) FROM "Processo" WHERE tipo='requerimento' AND status='rascunho' AND "updatedAt" < now()-interval '30 days'` |

## §14 Open questions

- ❓ (gap G2) Portal único x portais por domínio. **Assumido portal único com método (D1).**
- ❓ (gap G9) Ficha precisa de versionamento. **Assumido sim (D4); validar com a JUCESP.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §6A.2, §6.1; `Modelagem_de_Dados_SIAL.md` §3, §5.
- DesignSession cards "Motor de Requerimento unificado", "Preenchimento assistido", "Salvamento de rascunho".

## §16 Stories implementáveis

```yaml
- id: SIAL-REQ-001
  title: Migration — tabela Requerimento (1:1 Processo) + RLS
  description: Cria Requerimento conforme §7 (1) com CHECK de dominio e policy de SELECT.
  acceptanceCriteria:
    - "Requerimento.processoId é PK e FK ON DELETE CASCADE"
    - "Policy requerimento_select existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='Requerimento'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-REQ-002
  title: Migration — Cadastro + FichaCadastralVersao
  description: Cria as duas tabelas de §7 (2,3) com índice por (cadastroId, vigente) e RLS on.
  acceptanceCriteria:
    - "Cadastro tem UNIQUE (tipo, documento)"
    - "FichaCadastralVersao tem coluna vigente boolean"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.columns WHERE table_name='FichaCadastralVersao' AND column_name='vigente'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-REQ-003
  title: DAL requerimento — create, get, updateDados, submit
  description: src/lib/sial/dal/requerimento.ts. create faz Processo+Protocolo+Requerimento numa transação; submit valida obrigatórios do schema e chama sial_transicao.
  acceptanceCriteria:
    - "createRequerimento cria as 3 entidades atomicamente"
    - "submit rejeita quando faltam campos obrigatórios do schema"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-REQ-001]
  estimateMinutes: 30
  touches: ["src/lib/sial/dal/requerimento.ts"]

- id: SIAL-REQ-004
  title: CadastroLookup — interface + stub
  description: Interface CadastroLookup com implementação stub (retorna ficha vigente do Cadastro local; integração real em PRD Receita).
  acceptanceCriteria:
    - "src/lib/sial/cadastro-lookup.ts exporta a interface e um stub"
    - "Stub busca FichaCadastralVersao vigente por documento"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-REQ-002]
  estimateMinutes: 20
  touches: ["src/lib/sial/cadastro-lookup.ts"]

- id: SIAL-REQ-005
  title: API POST /api/requerimentos + GET /api/requerimentos/:id
  description: Cria o requerimento (rascunho) e lê processo+requerimento+schema+dados.
  acceptanceCriteria:
    - "POST retorna 201 com processoId+protocolo"
    - "GET retorna schema do método junto dos dados"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-REQ-003]
  estimateMinutes: 25
  touches: ["src/app/api/requerimentos/route.ts", "src/app/api/requerimentos/[id]/route.ts"]

- id: SIAL-REQ-006
  title: API PUT /api/requerimentos/:id (autosave) + submit
  description: PUT grava dados só em rascunho; POST submit valida e transiciona.
  acceptanceCriteria:
    - "PUT fora de rascunho retorna 409"
    - "submit com campo obrigatório faltando retorna 422"
    - "submit ok transiciona para aguardando_pagamento"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-REQ-003]
  estimateMinutes: 30
  touches: ["src/app/api/requerimentos/[id]/route.ts", "src/app/api/requerimentos/[id]/submit/route.ts"]

- id: SIAL-REQ-007
  title: API GET /api/cadastros/:documento (ficha assistida)
  description: Endpoint que usa CadastroLookup para retornar a ficha vigente.
  acceptanceCriteria:
    - "Documento existente retorna {dados}"
    - "Inexistente retorna 404"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-REQ-004]
  estimateMinutes: 20
  touches: ["src/app/api/cadastros/[documento]/route.ts"]

- id: SIAL-REQ-008
  title: DynamicForm — renderer a partir do schemaFormulario
  description: Componente React que renderiza campos (text/number/date/select) do schema, com validação de obrigatórios. Usa o padrão Field/FormBody.
  acceptanceCriteria:
    - "Renderiza tipos text, number, date, select"
    - "Campo obrigatório marca erro ao submeter vazio"
    - "Schema desconhecido cai num campo genérico sem quebrar"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 30
  touches: ["src/components/sial/dynamic-form.tsx"]

- id: SIAL-REQ-009
  title: Tela de requerimento — autosave + ficha assistida + submit
  description: Página que monta DynamicForm, faz autosave com debounce (PUT), botão de buscar ficha e enviar para análise.
  acceptanceCriteria:
    - "Autosave dispara após pausa de digitação"
    - "Buscar dados preenche campos da ficha"
    - "Enviar para análise chama submit e navega ao status"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-REQ-006, SIAL-REQ-007, SIAL-REQ-008]
  estimateMinutes: 30
  touches: ["src/app/(portal)/requerimentos/[id]/page.tsx"]

- id: SIAL-REQ-010
  title: Regenerar database.types.ts + smoke do fluxo
  description: Atualiza types; smoke: cria requerimento, autosave, busca ficha, submit → status aguardando_pagamento.
  acceptanceCriteria:
    - "Types incluem Requerimento, Cadastro, FichaCadastralVersao"
    - "Fluxo cria processo e chega em aguardando_pagamento"
  verifiable:
    - kind: manual_browser
      command_or_query: "Criar requerimento de livro, preencher, enviar"
      expected: "processo em aguardando_pagamento, sem perda de dados"
  dependsOn: [SIAL-REQ-009]
  estimateMinutes: 25
  touches: ["src/lib/supabase/database.types.ts", "(end-to-end)"]
```

**Total: 10 stories, ~245min (~4h).**
