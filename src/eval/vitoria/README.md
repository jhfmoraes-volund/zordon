# Vitoria Eval Suite

Mede se a Vitoria está ficando **mais útil** ao longo das fases da [v2 runbook](../../../docs/runbooks/vitoria-v2-runbook.md), não só mais ativa. 10 cenários cobrindo as 7 fases G1-G7 + 2 cenários `runnableToday` que servem de regressão pra G0.

Cada cenário descreve:
- **Setup**: fixtures de PlanningCeremony (sprint, transcripts, planilhas, notes, pendingActions, activeDecisions).
- **Turns**: o que o PM envia.
- **Expected**: assertions estruturais (tool calls + substrings) + `judgeRubric` em texto livre pra LLM judge.

## Como rodar

```bash
pnpm eval:vitoria                          # dry-run: valida schema + imprime score predito
pnpm eval:vitoria -- --case=edit-proposal  # filtra por scenario name
# pnpm eval:vitoria -- --live              # [TODO] roda contra Vitoria real (G1+)
```

Dry-run roda em < 1s, sem custo, sem API. Útil pra:
- Smoke-test: tudo type-checka
- Ver baseline predita
- Confirmar qual fase cada cenário depende

## Estrutura

```
src/eval/vitoria/
├── README.md           ← este arquivo
├── types.ts            ← schema EvalScenario
├── judge.ts            ← assertion engine (rule-based)
├── runner.ts           ← entry point
└── cases/
    ├── index.ts        ← exports allScenarios
    └── case-NN-*.ts    ← 10 cenários
```

## Como adicionar cenário

1. Cria `cases/case-NN-<nome>.ts` exportando uma `EvalScenario`.
2. Adiciona import + entry em `cases/index.ts`.
3. Roda `pnpm eval:vitoria` — runner valida schema antes de relatar.

Regras de qualidade pra um cenário novo:
- `name` em kebab-case
- `phaseDependency` honesto (0-7) — não marca G0 se depende de tabela que só nasce na G3
- `baselineRationale` obrigatório — explica QUAL estrutura falta, não "fail por causa do plano"
- Pelo menos uma de: `toolCalls`, `responseContains`, `judgeRubric`

## Wire de --live (TODO — entra com G1+)

Live mode exige 4 peças que ainda não estão prontas:

1. **Seed**: criar Client + Project + PlanningCeremony + Sprint + TranscriptRef + Attachment via service-role, tagged `__eval__`. Aplicar `setup.activeDecisions/openQuestions/pendingActions` antes do turno 1.
2. **Run**: chamar `runAgent()` de [src/lib/agent/engine.ts](../../lib/agent/engine.ts) passando `vitoriaAgent` + thread seedada + `params.planningId`. Consumir `result.streamText.fullStream` e juntar tool calls + texto.
3. **Cleanup**: deletar tudo tagged `__eval__` ao fim (ou keep pra inspeção + cmd `eval:vitoria:clean`).
4. **Phase gating**: cenários com `phaseDependency > N` ficam `skipped` enquanto fase N não rodou.

A G1 (Source Readers + PlanningSourceCache) é o primeiro candidato a wire — ela introduz `normalizeSource()` que vários cenários dependem. **Não wire `--live` antes da G1** — vai precisar mockar metade.

## Como o judge funciona

[judge.ts](./judge.ts) faz checks determinísticos espelhando [src/eval/vitor/judge.ts](../vitor/judge.ts):

| Check | O que faz |
|---|---|
| `expected.toolCalls[].name` | tool foi chamado? |
| `expected.toolCalls[].args` | partial match — args específicos batem? |
| `expected.toolCalls[].forbidden: true` | tool **não** foi chamado? |
| `expected.responseContains[]` | substring case-insensitive presente? |
| `expected.responseNotContains[]` | substring **ausente**? |
| `expected.judgeRubric` | NÃO avaliado em v1 — retorna `partial` se rule-based passou e há rubric |

LLM judge (Haiku via OpenRouter, ~50 tokens output) entra junto com a G2 / G5 quando cenários começam a passar nas regras determinísticas mas precisam de checagem de tom/intent.

## Métricas-alvo (BOSS = 8 de 10 = 80%)

| Fase | Pass rate alvo | Cenários esperados |
|---|---|---|
| Pós-G0 (atual) | ~2/10 (20%) | edit-proposal, deletion |
| Pós-G1 | ~5/10 (50%) | + spreadsheet-totals, transcript-long, source-empty |
| Pós-G2 | ~6/10 (60%) | + scope-creep |
| Pós-G3 | ~7/10 (70%) | + capacity-overflow |
| Pós-G4 | ~8/10 (80%) | + decision-contradiction → **BOSS gate** |
| Pós-G6 | ~9/10 (90%) | + forecast-precommit |
| Pós-G7 | ≥9/10 (≥90%) | + multi-source |

Mapping cenário → fase em [vitoria-v2-runbook.md § 3](../../../docs/runbooks/vitoria-v2-runbook.md).

## Manutenção

Após cada fase G1-G7:
1. Re-rodar `pnpm eval:vitoria` (dry-run + live conforme wired).
2. Atualizar `baselinePrediction` em cenários que viraram pass com a fase.
3. Se um cenário continua `fail` após a fase prevista, abrir issue no runbook com hipótese (prompt? tool? gate logic?).
4. Cenários novos vão **antes** da fase que os habilita — define o alvo, não documenta retroativamente.
