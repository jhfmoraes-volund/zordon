# PRD — SIAL Diretório Público de Profissionais

**Reference**: SIAL-DIR
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-requerimento` (entidade `Cadastro`), `prd-sial-app-shell`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: a denúncia precisa **buscar o profissional** (leiloeiro/tradutor) (doc §6.5); transparência ao público é coerente com a missão de fé pública (doc §1).
- **[decisão-sessão]**: diretório como **view pública** sobre `Cadastro` (tipo leiloeiro/tradutor), sem dados sensíveis; mesma fonte que abastece a busca da denúncia.
- **[inferência]**: shape da view, conceito de `situacao`, máscara de documento, página pública. A validar.

## Demo/Mock (one-shot)

> **Sem gateway externo.** View e endpoint reais em Supabase; a demo usa `prd-sial-mock-data` (leiloeiros/tradutores seedados). Smoke por `scripts/smoke/diretorio-publico.ts`: busca por nome/tipo retorna profissionais sem dados sensíveis (documento mascarado).

## §1 Problema

1. Para denunciar, o cidadão precisa **encontrar o profissional** (leiloeiro/tradutor) (doc §6.5).
2. Um diretório público também **dá transparência** sobre quem está habilitado.

## §2 Solução em uma frase

Uma lista pública (sem login) de leiloeiros e tradutores, consultável por nome/tipo, que dá transparência e alimenta a busca do profissional no fluxo de denúncia — exposta por uma view mínima sem dados sensíveis.

## §3 Não-objetivos

- Cadastro/edição do profissional — vem dos fluxos de requerimento (`Cadastro`).
- Abertura da denúncia em si — `prd-sial-denuncia-cadastro` (este PRD só fornece a busca).

## §4 Personas e jornada

- **Cidadão/Denunciante**: "Quero achar o leiloeiro pelo nome e, se for o caso, abrir uma denúncia já com ele selecionado."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | View pública `sial_diretorio_publico` sobre `Cadastro` (tipo ∈ leiloeiro/tradutor) | [doc] §6.5; [decisão-sessão] |
| D2 | Expõe `id`, `nome`, `tipo`, `situacao` e documento **mascarado**; nunca CPF/CNPJ completo | [doc §8 LGPD]; [inferência] |
| D3 | `situacao` derivada (ex.: `habilitado` quando há processo deferido; senão `em_analise`/`sem_registro`) | [inferência] |
| D4 | Endpoint público sem auth, com busca por `q` e `tipo` | [doc] §6.5 |

## §6 Arquitetura

```
Cadastro(tipo leiloeiro/tradutor) ──► view sial_diretorio_publico (mínima)
   GET /api/publico/profissionais?tipo=&q=  (sem auth)
        └─ usado pela página pública e pela busca da denúncia
```

## §7 Schema

```sql
-- 1) <data>_sial_diretorio_publico_view.sql        -- [doc §6.5]; [inferência] situacao/máscara
CREATE VIEW sial_diretorio_publico AS
SELECT
  c.id,
  COALESCE(c.dados->>'nome', '—') AS nome,
  c.tipo,
  -- documento mascarado (mostra só os últimos dígitos)
  regexp_replace(c.documento, '.(?=.{4})', '*', 'g') AS documento_mascarado,
  CASE
    WHEN EXISTS (SELECT 1 FROM "Processo" p WHERE p."requerenteId" IS NOT NULL
                 AND p.status='deferido' /* aproximação: liga por cadastro nos fluxos */ )
    THEN 'habilitado' ELSE 'sem_registro'
  END AS situacao
FROM "Cadastro" c
WHERE c.tipo IN ('leiloeiro','tradutor');
GRANT SELECT ON sial_diretorio_publico TO anon;
```

> A derivação de `situacao` é **[inferência]** e será refinada quando a JUCESP definir o que conta como "habilitado".

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET | `/api/publico/profissionais` | sem auth, `?tipo=&q=` → lista `{id, nome, tipo, documentoMascarado, situacao}` |
| GET | `/api/publico/profissionais/:id` | → ficha pública mínima |

## §9 UX

```
┌──── Profissionais habilitados ───────────────┐
│ Tipo [Todos ▾]  Buscar [______________] [🔍]  │
│ ───────────────────────────────────────────── │
│ João Leiloeiro   leiloeiro  ***123  habilitado │  [denunciar]
│ Ana Tradutora    tradutor   ***456  habilitado │  [denunciar]
└─────────────────────────────────────────────────┘
```

## §10 Integrações

- Fonte: `Cadastro` (de `prd-sial-requerimento`).
- Consumido por `prd-sial-denuncia-cadastro` (busca do alvo).
- Roda na frente `(publico)` do `prd-sial-app-shell`.

## §11 Faseamento

Fase 1: view pública → endpoint de busca → página pública com atalho "denunciar" → smoke (sem dados sensíveis).

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Exposição indevida de dado pessoal | M | A | View lista colunas explicitamente; documento mascarado; teste anti-vazamento. |
| `situacao` enganosa | M | M | Derivação marcada como provisória; refinar com a JUCESP. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Buscas no diretório | log de hits no endpoint |
| Ausência de dado sensível | smoke que falha se documento completo aparecer |

## §14 Open questions

- ❓ O que define "habilitado"? **Derivação provisória; validar com a JUCESP.**
- ❓ Diretório deve listar empresas também? **Assumido só leiloeiro/tradutor (alvos de denúncia).**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §1, §6.5, §8; `Modelagem_de_Dados_SIAL.md` §3.
- DesignSession card "Diretório público de profissionais habilitados".

## §16 Stories implementáveis

```yaml
- id: SIAL-DIR-001
  title: Migration — view sial_diretorio_publico (+ GRANT anon)
  description: Cria a view mínima de §7 com documento mascarado e situacao derivada.
  acceptanceCriteria:
    - "View existe e filtra tipo IN (leiloeiro,tradutor)"
    - "Documento aparece mascarado (não completo)"
    - "anon tem SELECT"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.views WHERE table_name='sial_diretorio_publico'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 25
  touches: ["supabase/migrations/"]

- id: SIAL-DIR-002
  title: API pública de busca de profissionais
  description: GET /api/publico/profissionais (?tipo=&q=) e GET /:id, sem auth, lendo a view.
  acceptanceCriteria:
    - "Busca por nome e filtro por tipo funcionam"
    - "Resposta traz documento mascarado, nunca completo"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DIR-001]
  estimateMinutes: 25
  touches: ["src/app/api/publico/profissionais/route.ts", "src/app/api/publico/profissionais/[id]/route.ts"]

- id: SIAL-DIR-003
  title: Página pública do diretório + atalho denunciar
  description: Página em (publico) com busca, lista e botão "denunciar" que leva ao fluxo com o alvo pré-selecionado.
  acceptanceCriteria:
    - "Sem login, lista e busca funcionam"
    - "Botão denunciar passa o id do profissional ao fluxo de denúncia"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DIR-002]
  estimateMinutes: 30
  touches: ["src/app/(publico)/profissionais/page.tsx"]

- id: SIAL-DIR-004
  title: Smoke — diretório sem dados sensíveis
  description: scripts/smoke/diretorio-publico.ts busca profissionais e garante ausência de documento completo.
  acceptanceCriteria:
    - "Busca retorna ao menos um profissional (mock-data)"
    - "Nenhum CPF/CNPJ completo na resposta"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.columns WHERE table_name='sial_diretorio_publico' AND column_name='documento'"
      expected: "0"
  dependsOn: [SIAL-DIR-003]
  estimateMinutes: 20
  touches: ["scripts/smoke/diretorio-publico.ts"]
```

**Total: 4 stories, ~100min (~1h40).**
