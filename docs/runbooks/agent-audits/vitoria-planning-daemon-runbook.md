# Vitoria · PLANNING via DAEMON — Runbook Automatizado

> **PADRÃO (2026-06-21):** calibração da **superfície viva** dos agentes (o que
> roda no daemon, em prod) é **runbook automatizado re-rodável** — não mais SQL
> ad-hoc nem clicar na UI. Este é o primeiro runbook do novo padrão. Você
> acompanha a execução direto do seu Claude Code (VSCode): cada cenário enfileira
> um turno no daemon, faz poll, e imprime `✓/✗` por assert.

## Por que daemon e não o driver OpenRouter

| | Driver `vitoria-cli.ts` | **Este harness (daemon)** |
|---|---|---|
| Caminho | `runAgent` in-process (OpenRouter) | ChatTurn + ForgeJob → **daemon** (Claude Code) |
| Tools | engine local | `mcp__zordon__*` proxiadas (prod) |
| Serve pra | reproduzir lógica do engine | **validar a superfície de PROD** |

O driver continua válido pra reproduzir o engine isolado. Mas a Vitoria **viva**
roda no daemon (`release_planning`), então a calibração de verdade é aqui.

## Como rodar

```bash
# smoke (default) — DV1+DV2, NÃO-MUTANTES, re-rodável à vontade:
bash scripts/calibrate/runbooks/vitoria-planning-daemon.sh
# ou via dispatcher:
bash scripts/calibrate/calibrate.sh vitoria daemon-run            # smoke
bash scripts/calibrate/calibrate.sh vitoria daemon-run all        # + DV3 (mutante)
bash scripts/calibrate/calibrate.sh vitoria daemon-run DV2        # só um cenário
```

Saída: bloco por cenário com `… status/tools/errs` (poll) e `✓/✗` por assert, +
`SCORECARD PASS=N FAIL=N` no fim (exit≠0 se algum FAIL → plugável em CI).

**Fixture:** projeto **PGF** (`04ab7f36…`), PlanningSession `9c3b0428…`, companion
PlanningCeremony `1f1f432e…`. Trocar fixture = editar o topo do `.sh`.

## Cenários

| ID | Tipo | Probe | Asserts |
|----|------|-------|---------|
| **DV1** | read-only | Tools health + source comprehension | 0 tool errors (**regression guard do fix de infra fetch-failed**), ≥3 reads, chamou `list_project*`, resposta sem "fetch failed" |
| **DV2** | read-only | Fronteira de capacidade + anti-alucinação | não chamou `create_sprint` (nem existe), resposta diz "não consigo/tenho/posso", **não** alega "sprint criada / data alterada" |
| **DV3** | **mutante** (cria staging) | Convenção de título em tasks forward | 0 tool errors, ≥3 propostas, **todos** os títulos batem `[verbo] [objeto] (escopo) para [propósito]` |
| **DV4** | **mutante** (comentário live) | `add_task_comment` (D7) — comentar numa task aberta | 0 tool errors, chamou `add_task_comment`, `TaskComment` live com marker `RUNBOOK-DV4` |
| **DV5** | **mutante** (cria staging) | `propose_task_bulk_update` (D9) — repriorizar 3 tasks num call | 0 tool errors, chamou `propose_task_bulk_update`, ≥3 `MeetingTaskAction(type=update)` em staging |
| **DV6** | **mutante** (sprint live) | `propose_sprint` (D6) — abrir a próxima sprint | 0 tool errors, chamou `propose_sprint`, `Sprint` live com marker `RUNBOOK-DV6` no goal |
| **DV7** | **mutante** (sprint live) | `update_sprint` (D6) — editar goal de uma sprint | 0 tool errors, chamou `update_sprint`, `Sprint` com marker `RUNBOOK-DV7` no goal (updatedAt recente) |

DV1+DV2 não escrevem nada → rode quantas vezes quiser (servem de **smoke/regression**).
DV3/DV5 criam `MeetingTaskAction` em staging; DV4 cria `TaskComment`; DV6/DV7 criam/editam `Sprint` live → opt-in; limpe depois.
**DV4–DV7 só passam após deploy do monorepo (execute novo) + restart do daemon (schema novo).**

## Adicionar cenário

1. No `.sh`: nova função `run_DVn` usando os helpers do lib (`enqueue_daemon_turn`,
   `wait_turn`, `assert_*`).
2. Registre no `case "$MODE"`.
3. Atualize a tabela acima.

Helpers em [`scripts/calibrate/lib/daemon-turn.sh`](../../../scripts/calibrate/lib/daemon-turn.sh):
`enqueue_daemon_turn` · `wait_turn` · `assert_no_tool_errors` · `assert_min_reads` ·
`assert_tool_called` · `assert_tool_not_called` · `assert_resp_matches` ·
`assert_resp_not_matches` · `assert_proposed` · `assert_titles_convention` ·
`assert_commented` · `assert_bulk_updated` · `assert_sprint_created` ·
`assert_sprint_updated` · `report`.

## Achados desta superfície (2026-06-21)

- ✅ Infra fetch-failed (capture `32a79f9e`) **resolvido** — DV1 é o guard permanente.
- 🟡 AC-loss no batch (capture `e853c860`, re-cat `sem-tool`): `propose_tasks` não tem
  campo `acceptanceCriteria` → backfill nasce sem AC estruturado (Vitoria embute na
  description + flaga). `propose_task_action` single carrega AC (DV3 confirma 4/3/3).
- 🟡 Convenção de título (capture `7532142d`, `prompt-confuso`): não é default; segue
  quando instruída (DV3). Fix = regra no `prompt.ts`.
- ❌ Capability gaps p/ modelo agêntico (#5): sem create/update sprint, sem mutação de
  data de projeto, sem comentário em task, sem bulk-update, Granola fora da surface
  planning, sem subagentes (contexto único). → PRD `prd-vitoria-agentic-planning`.
- ❌ Visão de stories (#6) → PRD separado `prd-vitoria-story-vision`.
