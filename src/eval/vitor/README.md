# Vitor Eval Suite

Mede se o Vitor está ficando **mais inteligente**, não só mais ativo. 10 conversas-douradas que cobrem as 10 categorias definidas em [docs/vitor-memory-plan.md § Eval suite](../../../docs/vitor-memory-plan.md).

Cada caso descreve:
- **Setup**: fixtures (decisions, open questions, research, project memory, business context, step data) que existem antes do Vitor ser invocado.
- **Turns**: o que o usuário envia.
- **Expected**: assertions estruturais (tool calls + substrings) + um `judgeRubric` em texto livre pra LLM judge.

## Como rodar

```bash
npm run eval:vitor          # dry-run: valida schema + imprime score predito
npm run eval:vitor -- --live  # [TODO] roda contra Vitor real
```

Dry-run roda em < 1s, sem custo, sem API. Útil pra:
- Smoke-test: tudo type-checka
- Ver o score predito
- Confirmar a quais fases cada caso depende

## Estrutura

```
src/eval/vitor/
├── README.md           ← este arquivo
├── types.ts            ← schema EvalCase
├── judge.ts            ← assertion engine (rule-based)
├── runner.ts           ← entry point
├── cases/
│   ├── index.ts        ← exports allCases
│   └── case-NN-*.ts    ← 10 casos
└── baselines/
    └── 2026-04-27.md   ← baseline pré-Fase 1
```

## Como adicionar caso

1. Cria `cases/case-NN-<nome>.ts` exportando uma `EvalCase`.
2. Adiciona o import + entry em `cases/index.ts`.
3. Roda `npm run eval:vitor` — runner valida schema antes de relatar.

Regras de qualidade pra um caso novo:
- `name` em kebab-case
- `category` 1-10 (matches a tabela em vitor-memory-plan.md § Eval suite)
- `phaseDependency` honesto — não marque P0 se o caso depende de tabela que ainda não existe
- `baselineRationale` obrigatório — não vale "fail por causa do plano"; explica QUAL estrutura falta
- Pelo menos uma de: `toolCalls`, `responseContains`, `judgeRubric`

## Wire de --live (TODO)

Live mode exige 3 peças que ainda não estão prontas:

1. **Seed**: criar Project + DesignSession + ChatThread tagged `__eval__` via service-role Supabase. Aplicar `setup.decisions/openQuestions/research/project.businessContext` antes do turno 1.
2. **Run**: chamar `runAgent()` de [src/lib/agent/engine.ts](../../lib/agent/engine.ts) com o thread seedado. Consumir `result.streamText.fullStream` e juntar tool calls + texto.
3. **Cleanup**: deletar tudo tagged `__eval__` ao fim (ou keep pra inspeção e ter cmd `eval:vitor:clean`).

A Fase 1 do plano cria as tabelas necessárias pro seed funcionar. **Não wire `--live` antes disso** — vai precisar mockar metade.

## Como o judge funciona

Hoje, [judge.ts](./judge.ts) faz checks determinísticos:

| Check | O que faz |
|---|---|
| `expected.toolCalls[].name` | tool foi chamado? |
| `expected.toolCalls[].args` | partial match — args específicos batem? |
| `expected.toolCalls[].forbidden: true` | tool **não** foi chamado? |
| `expected.responseContains[]` | substring case-insensitive presente? |
| `expected.responseNotContains[]` | substring **ausente**? |
| `expected.judgeRubric` | NÃO avaliado em v1 — retorna status `partial` se rule-based passou e há rubric |

Se quiser sair de `partial` pra `pass` em casos com rubric, precisa wire LLM judge (Haiku via OpenRouter recomendado, ~50 tokens output). Acrescenta em `judge.ts` num próximo passo.

## Métricas-alvo

Ver [baselines/2026-04-27.md](./baselines/2026-04-27.md) — alvo por fase:

| Fase | Pass rate alvo |
|---|---|
| Baseline (atual) | 0% |
| Pós-Fase 1 | ~10% |
| Pós-Fase 2 | ~60% |
| Pós-Fase 3 | ~70% |
| Pós-Fase 4 | ≥ 80% |

## Manutenção

Após cada fase do plano:
1. Re-rodar `npm run eval:vitor` (dry-run + live se disponível).
2. Atualizar baselines com `actual` ao lado de `predicted`.
3. Se um caso vira `pass` mas a fase prevista era outra, **atualizar `phaseDependency`** — não esconder.
4. Se um caso continua `fail` após a fase prevista, abrir issue com hipótese (prompt? tool?).
