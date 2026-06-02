# PRD — SIAL Domínio Livro (autenticação de livros empresariais/contábeis)

**Reference**: SIAL-LIV
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (React + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-requerimento`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: autenticar livros empresariais e contábeis é o serviço-raiz da Junta (doc §1, §7 Livros); jornada cria o livro e vincula assinante (doc §6.1 passos 4-5); `livro: processo_id, tipo_livro, nire_matricula, dados` (modelagem §3).
- **[inferência]**: nomes de coluna, conjunto de campos do `schemaFormulario` do método Livro, validação de NIRE/matrícula (stub). A validar com a JUCESP.

## Demo/Mock (one-shot)

> Roda em **mock-mode**. O `NireLookup` vem de `getGateways()` (stub determinístico). Smoke por `scripts/smoke/dominio-livro.ts`: cria requerimento de livro válido (período/folhas/NIRE) → `aguardando_pagamento` via SQL. Base oficial de NIRE = Track B, mesma interface.

## §1 Problema

1. Autenticar **livros empresariais e contábeis** é o domínio original do SIAL, mas o motor genérico de requerimento sozinho não cobre os campos próprios do livro (doc §1, §7).
2. O livro precisa de **tipo de livro, NIRE/matrícula, período e folhas** e do vínculo com o assinante antes do envio (doc §6.1 passos 4-5; modelagem §3).

## §2 Solução em uma frase

Especializa o motor de requerimento para o domínio **Livro**: define o método "livro" (campos e regras), a entidade `Livro` e a validação de NIRE/matrícula, produzindo um `Processo(tipo=requerimento, dominio=livro)`.

## §3 Não-objetivos

- Vinculação de assinante / assinatura — `prd-sial-assinatura` (este PRD apenas referencia o passo).
- Validação real de NIRE/matrícula contra base externa — stub aqui; integração em PRD próprio se a JUCESP confirmar a fonte.
- Análise/deferimento do livro — PRDs de análise/decisão.

## §4 Personas e jornada

- **Requerente (empresa)**: "Quero autenticar meu livro informando tipo, matrícula e período, sem retrabalho, e enviar para análise."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | `Livro` 1:1 com `Processo` (via requerimento `dominio=livro`), campos próprios em colunas + `dados` JSONB | [doc] modelagem §3 |
| D2 | Campos do método Livro: `tipoLivro`, `nireMatricula`, `periodoInicio`, `periodoFim`, `folhas` | [doc] §6.1; [inferência] na lista exata |
| D3 | Validação de NIRE/matrícula atrás de interface (stub); coerência de período (fim ≥ início) e folhas > 0 | [inferência] |
| D4 | Seed do `Metodo` (dominio=livro) com `schemaFormulario` correspondente | [decisão-sessão] (motor de método) |

## §6 Arquitetura

```
Metodo(dominio=livro, schemaFormulario) ──► motor de requerimento (DynamicForm)
        │
POST /api/requerimentos {metodoId(livro), dominio:livro}
        └─ além do Requerimento, cria Livro(processoId, tipoLivro, nireMatricula, ...)
        │
        ▼ submit valida campos do livro (período, folhas, NIRE stub) → aguardando_pagamento
```

## §7 Schema

```sql
-- 1) <data>_sial_livro.sql                      -- [doc] modelagem §3 (entidade); [inferência] colunas
CREATE TABLE "Livro" (
  "processoId" uuid PRIMARY KEY REFERENCES "Processo"(id) ON DELETE CASCADE,
  "tipoLivro" text NOT NULL,
  "nireMatricula" text,
  "periodoInicio" date,
  "periodoFim" date,
  folhas integer CHECK (folhas IS NULL OR folhas > 0),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "Livro" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "livro_select" ON "Livro" FOR SELECT USING (EXISTS (
  SELECT 1 FROM "Processo" p WHERE p.id="processoId"
    AND (p."requerenteId"=sial_current_usuario() OR sial_is_servidor())));
```

```sql
-- 2) <data>_sial_metodo_livro_seed.sql           -- [decisão-sessão]
INSERT INTO "Metodo" (nome, dominio, "schemaFormulario", ativo) VALUES
('Livro Mercantil/Contábil', 'livro', '{
  "campos": [
    {"key":"tipoLivro","label":"Tipo de livro","type":"select","required":true,
     "options":["Diário","Razão","Registro de Duplicatas","Outro"]},
    {"key":"nireMatricula","label":"NIRE/Matrícula","type":"text","required":true},
    {"key":"periodoInicio","label":"Período (início)","type":"date","required":true},
    {"key":"periodoFim","label":"Período (fim)","type":"date","required":true},
    {"key":"folhas","label":"Número de folhas","type":"number","required":true}
  ]
}'::jsonb, true);
```

## §8 APIs

Reusa as APIs do motor de requerimento. Adiciona:

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/requerimentos` (dominio=livro) | além de criar o requerimento, cria a linha `Livro` |
| GET | `/api/livros/:processoId` | → dados do livro |
| GET | `/api/validacao/nire/:valor` | (stub) → `{valido:boolean}` |

## §9 UX

```
┌──── Autenticar livro ───────────────────────────┐
│ Tipo de livro [ Diário ▾ ]                       │
│ NIRE/Matrícula [____________]  [Validar]         │
│ Período  [ __/__/____ ] a [ __/__/____ ]         │
│ Folhas   [ ____ ]                                │
│ Assinante: (vincular — etapa de assinatura)      │
│                         [ Enviar para análise ]  │
└───────────────────────────────────────────────────┘
```

## §10 Integrações

- Estende `prd-sial-requerimento` (motor + DynamicForm). Consome a state machine do core.
- `prd-sial-assinatura`: vínculo do assinante do livro.
- Validação de NIRE: stub aqui; fonte externa a confirmar com a JUCESP.

## §11 Faseamento

Fase 1: schema `Livro` → seed do método livro → validação de campos (período/folhas/NIRE stub) → integração ao submit → smoke. Entrega o domínio-raiz ponta-a-ponta sobre o motor.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| NIRE/matrícula sem fonte de validação confiável | M | M | Stub + flag; validação real quando a JUCESP indicar a base. |
| Tipos de livro divergem do que a JUCESP usa | M | B | Lista no `schemaFormulario` (parametrizável); ajustar sem deploy. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Livros autenticados por período | `SELECT count(*) FROM "Livro" l JOIN "Processo" p ON p.id=l."processoId" WHERE p.status='deferido'` |
| Distribuição por tipo de livro | `SELECT "tipoLivro", count(*) FROM "Livro" GROUP BY 1` |

## §14 Open questions

- ❓ Quais tipos de livro a JUCESP autentica hoje? **Lista inicial no schema; validar.**
- ❓ Existe base oficial para validar NIRE/matrícula? **Stub até confirmação.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §1, §6.1, §7; `Modelagem_de_Dados_SIAL.md` §3.
- DesignSession card "Autenticação de Livro empresarial/contábil".

## §16 Stories implementáveis

```yaml
- id: SIAL-LIV-001
  title: Migration — tabela Livro (+ RLS)
  description: Cria Livro conforme §7 (1) com CHECK de folhas e policy de SELECT.
  acceptanceCriteria:
    - "Livro.processoId é PK e FK ON DELETE CASCADE"
    - "CHECK folhas > 0 quando preenchido"
    - "Policy livro_select existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='Livro'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-LIV-002
  title: Seed — Metodo livro + schemaFormulario
  description: Insere o método Livro com os campos de §7 (2).
  acceptanceCriteria:
    - "Existe Metodo com dominio='livro' e ativo=true"
    - "schemaFormulario tem >=5 campos"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Metodo\" WHERE dominio='livro' AND ativo"
      expected: "1"
  dependsOn: []
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-LIV-003
  title: Validação de livro — período/folhas + NIRE stub
  description: src/lib/sial/dominio/livro.ts com validate(dados) (período fim>=início, folhas>0) e interface NireLookup (stub).
  acceptanceCriteria:
    - "validate rejeita período invertido e folhas<=0"
    - "NireLookup stub retorna {valido:true} determinístico"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 25
  touches: ["src/lib/sial/dominio/livro.ts"]

- id: SIAL-LIV-004
  title: Integrar Livro ao motor de requerimento (create + submit)
  description: Quando dominio=livro, create também insere Livro; submit roda validação do livro além da do schema.
  acceptanceCriteria:
    - "POST /api/requerimentos dominio=livro cria linha Livro",
    - "submit com período invertido retorna 422"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-LIV-001, SIAL-LIV-003]
  estimateMinutes: 30
  touches: ["src/lib/sial/dal/requerimento.ts", "src/app/api/livros/[processoId]/route.ts"]

- id: SIAL-LIV-005
  title: API validação NIRE + types + smoke
  description: GET /api/validacao/nire/:valor (stub); regenera types; smoke de um livro ponta-a-ponta até aguardando_pagamento.
  acceptanceCriteria:
    - "GET retorna {valido}"
    - "Smoke cria livro válido e chega em aguardando_pagamento"
  verifiable:
    - kind: manual_browser
      command_or_query: "Criar requerimento de livro Diário, preencher e enviar"
      expected: "Livro criado, processo em aguardando_pagamento"
  dependsOn: [SIAL-LIV-002, SIAL-LIV-004]
  estimateMinutes: 25
  touches: ["src/app/api/validacao/nire/[valor]/route.ts", "src/lib/supabase/database.types.ts"]
```

**Total: 5 stories, ~115min (~2h).**
