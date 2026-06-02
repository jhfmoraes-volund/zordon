# PRD — SIAL Parametrização de Métodos (form builder)

**Reference**: SIAL-PARAM
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: `prd-sial-core-process` (entidade `Metodo`), `prd-sial-identity-access` (admin)

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: campos e visualizações **parametrizáveis pelo administrador** sem desenvolvimento (RF08/RF09, doc §2 "Método", §4, §7); `metodo.schema_formulario` (JSONB) é o que torna o produto configurável (modelagem §5).
- **[decisão-sessão]**: editor consome a entidade `Metodo` do core; o motor de requerimento já renderiza do schema.
- **[inferência]**: versionamento do schema, validação, preview, paths. A validar (gaps G7/G8).

## Demo/Mock (one-shot)

> **Sem gateway externo.** CRUD e versionamento reais em Supabase. Smoke por `scripts/smoke/parametrizacao.ts`: admin cria/edita um método, valida schema inválido (rejeitado), publica versão e o DynamicForm passa a renderizar os novos campos.

## §1 Problema

1. Sem parametrização, **cada mudança de campo vira projeto de software** (RF08/RF09, doc §2, §4).
2. O administrador precisa criar/alterar **campos, regras e visualizações por método** com segurança (validação + preview), sem quebrar formulários em produção (risco R7).

## §2 Solução em uma frase

Um editor para o administrador criar e versionar o `schemaFormulario` dos métodos (campos, tipos, obrigatoriedade), com validação e preview, alimentando o motor de requerimento — sem deploy.

## §3 Não-objetivos

- O **renderer** do formulário — `prd-sial-requerimento` (DynamicForm já consome o schema).
- Permissões/perfis — `prd-sial-identity-access`.

## §4 Personas e jornada

- **Administrador**: "Quero adicionar um campo a um método, pré-visualizar como o requerente verá e publicar, sem chamar o time de dev."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | Editor opera sobre `Metodo.schemaFormulario` (JSONB) | [doc] modelagem §5; RF08 |
| D2 | **Validação de schema** antes de salvar (campos com key única, tipo válido, options p/ select) | [inferência] (mitiga R7) |
| D3 | **Versionamento**: `MetodoVersao` guarda histórico; publicar troca a versão vigente | [inferência] |
| D4 | **Preview** renderiza o DynamicForm com o schema em edição | [doc] §4 (preview por perfil); [inferência] |
| D5 | Escrita só `administrador` (RLS já definida no core/identity) | [doc] RF09 |

## §6 Arquitetura

```
Admin → editor de schema (campos/tipos/obrigatório/options)
   POST /api/admin/metodos/:id/schema { schema } → valida → MetodoVersao + atualiza vigente
   preview → DynamicForm(schema em edição)
Motor de requerimento já lê Metodo.schemaFormulario vigente.
```

## §7 Schema

```sql
-- 1) <data>_sial_metodo_versao.sql                 -- [inferência] versionamento
CREATE TABLE "MetodoVersao" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "metodoId" uuid NOT NULL REFERENCES "Metodo"(id) ON DELETE CASCADE,
  "schemaFormulario" jsonb NOT NULL,
  versao integer NOT NULL,
  vigente boolean NOT NULL DEFAULT false,
  "publicadoPor" uuid REFERENCES "Usuario"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("metodoId", versao)
);
CREATE INDEX "MetodoVersao_vigente_idx" ON "MetodoVersao" ("metodoId", vigente);
ALTER TABLE "MetodoVersao" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metodo_versao_admin" ON "MetodoVersao" FOR ALL
  USING (sial_has_perfil('administrador')) WITH CHECK (sial_has_perfil('administrador'));
CREATE POLICY "metodo_versao_read" ON "MetodoVersao" FOR SELECT USING (auth.uid() IS NOT NULL);
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET/POST | `/api/admin/metodos` | (admin) lista/cria método |
| PUT | `/api/admin/metodos/:id/schema` | `{schema}` → valida → cria `MetodoVersao` (não vigente) → 200; 422 se inválido |
| POST | `/api/admin/metodos/:id/publicar` | `{versao}` → torna vigente (atualiza `Metodo.schemaFormulario`) → 200 |
| POST | `/api/admin/metodos/:id/preview` | `{schema}` → valida e retorna o schema normalizado p/ preview |

## §9 UX

```
┌──── Editar método: Livro ──────────────────────┐
│ Campos:                                          │
│  • tipoLivro (select) [obrigatório]  [editar]    │
│  • folhas (number) [obrigatório]     [editar]    │
│  [ + adicionar campo ]                           │
│ ───────────── Preview ──────────────             │
│  (DynamicForm renderizado do schema)             │
│ [ Salvar rascunho ]   [ Publicar versão ]        │
└────────────────────────────────────────────────────┘
```

## §10 Integrações

- Alimenta `prd-sial-requerimento` (DynamicForm) e os domínios (livro/leiloeiro/tradutor seedados).
- Escrita restrita a admin (RLS de `prd-sial-identity-access`).

## §11 Faseamento

Fase 1: validação de schema → `MetodoVersao` → CRUD de métodos (admin) → editor + preview → publicar versão → smoke.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Schema inválido quebra o formulário em produção (R7) | M | A | Validação obrigatória (D2) + preview + versionamento (rollback). |
| Campo removido com dados já preenchidos | M | M | Versionar; dados antigos preservados em `Processo.dados`. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Métodos com versão publicada | `SELECT count(DISTINCT "metodoId") FROM "MetodoVersao" WHERE vigente` |
| Edições de schema sem deploy | contagem de `MetodoVersao` criadas |

## §14 Open questions

- ❓ (gap G7) Até onde o admin configura sozinho (campos? regras? fluxos?)? **MVP = campos do formulário; regras/fluxos a validar.**
- ❓ (gap G8) JSONB total vs colunas reais. **Híbrido mantido; revisitar se métodos forem poucos/estáveis.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §2, §4, §7; `Modelagem_de_Dados_SIAL.md` §5.
- DesignSession card "Parametrização de Métodos e formulários"; risco R7; gaps G7/G8.

## §16 Stories implementáveis

```yaml
- id: SIAL-PARAM-001
  title: Migration — MetodoVersao (+ RLS)
  description: Cria MetodoVersao conforme §7 com UNIQUE (metodoId, versao) e policies.
  acceptanceCriteria:
    - "UNIQUE (metodoId, versao)"
    - "Policies metodo_versao_admin e _read existem"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='MetodoVersao'"
      expected: "2"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-PARAM-002
  title: Validação de schemaFormulario
  description: src/lib/sial/schema-validacao.ts (keys únicas, tipos válidos, select com options, obrigatório bool).
  acceptanceCriteria:
    - "Rejeita key duplicada e tipo inválido",
    - "Select sem options é erro",
    - "Retorna lista de erros legível"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 30
  touches: ["src/lib/sial/schema-validacao.ts"]

- id: SIAL-PARAM-003
  title: API métodos CRUD + schema + publicar
  description: GET/POST métodos, PUT schema (valida→MetodoVersao), POST publicar (vigente).
  acceptanceCriteria:
    - "PUT schema inválido retorna 422",
    - "publicar troca a versão vigente e atualiza Metodo.schemaFormulario",
    - "Só admin"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-PARAM-001, SIAL-PARAM-002]
  estimateMinutes: 30
  touches: ["src/app/api/admin/metodos/route.ts", "src/app/api/admin/metodos/[id]/schema/route.ts", "src/app/api/admin/metodos/[id]/publicar/route.ts"]

- id: SIAL-PARAM-004
  title: Editor de método + preview (UI)
  description: Tela admin para editar campos e pré-visualizar com DynamicForm.
  acceptanceCriteria:
    - "Adicionar/editar/remover campo",
    - "Preview renderiza o schema em edição",
    - "Publicar reflete no requerimento"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-PARAM-003]
  estimateMinutes: 30
  touches: ["src/app/(backoffice)/admin/metodos/[id]/page.tsx"]

- id: SIAL-PARAM-005
  title: Smoke — parametrização + types
  description: scripts/smoke/parametrizacao.ts edita um método (válido/ inválido), publica e confere vigente; types.
  acceptanceCriteria:
    - "Schema inválido é rejeitado",
    - "Publicar gera MetodoVersao vigente",
    - "DynamicForm passa a renderizar o novo campo"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"MetodoVersao\" WHERE vigente"
      expected: ">=1"
  dependsOn: [SIAL-PARAM-004]
  estimateMinutes: 25
  touches: ["scripts/smoke/parametrizacao.ts", "src/lib/supabase/database.types.ts"]
```

**Total: 5 stories, ~135min (~2h15).**
