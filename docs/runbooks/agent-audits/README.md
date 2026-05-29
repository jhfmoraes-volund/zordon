# Agent Audits — Vocabulary Compartilhada

Toda calibração de agente no Volund usa esta **mesma taxonomia**. Categorias, scorecard pattern e loop de captura→fix→re-validate são iguais entre Vitoria/Alpha/Vitor/etc. Cada agente tem seu runbook próprio com cenários V0…V_NN específicos, mas o vocabulário aqui é fonte da verdade.

## Loop canônico

```
1. Captura       — PM observa comportamento torto em prod ou audit
2. Categoriza    — aplica UMA categoria da taxonomy abaixo
3. Reproduz      — via driver CLI: bash scripts/calibrate/calibrate.sh <agent> run [args]
4. Diagnóstico   — prompt? schema? tool? modelo? infra?
5. Fix           — diff cirúrgico (1 fase = 1 commit)
6. Re-valida     — mesmo cmd CLI, scorecard sobe
7. Promote       — bug recorrente vira case em src/eval/<agent>/cases/
```

Entrada do loop: skill `/calibrate <agent>` (ver [.claude/skills/calibrate/SKILL.md](../../../.claude/skills/calibrate/SKILL.md)).

## Categorias canônicas (CHECK constraint em AgentCalibrationCapture)

| Categoria | Significado | Implicação prática |
|-----------|-------------|---------------------|
| **sem-tool** | Tool ausente do toolset do agente | Adicionar tool em `buildXTools` |
| **sem-contexto** | Tool existe mas agente não vê a entidade no system prompt | Ajustar `loadContext` |
| **prompt-confuso** | Tool + contexto OK, mas regra ambígua → escolha errada | Reescrever passo no `prompt.ts` |
| **modelo-alucina** | Tudo correto, modelo inventa fato OU **afirma ação que não executou** | Few-shot, modelo mais forte, ou skill (G2 do v2 runbook) |
| **schema-rejeita** | Zod schema rejeita o que o modelo passou | Ajustar refine/describe |
| **tool-off-topic** | Agente chama tool não relacionada ao pedido (ex: `read_transcript_content` em pergunta de repo) | Bloco "Tool routing por intent" no prompt |
| **manifest-blindspot** | Agente conclui "vazio" quando dado está oco mas presente, sem tentar fallback | Skill `repo_inspection_fallback` + confidence label |
| **scope-tangent** | Resposta pivota pra backlog/sprint sem motivo, ruído tangencial | Skill `focused_answer` — cortar auto-pulls |
| **gate-bypass** | Agente propõe ignorando resposta `ok:false` do Capacity/Conflict Gate | Gate não shipou OU modelo ignora — few-shot |
| **confidence-missing** | Proposta sem `confidence` ou `sources[]` | G5 não shipou OU Zod ainda permite null |
| **confidence-fabricated** | Cita data/fato como hard_fact sem evidência | G5 + skill `confidence_labeling_rubric` |
| **outcome-missing** | Ação executada mas `AgentProposalOutcome` (ou equivalente) não foi gravado | Bug em telemetria (FK cascade, etc) |
| **infra-bug** | Falha não-agente (stream merge, RLS, persistência) | Investigar fora do prompt |
| **correto** | Comportamento esperado | ✅ |

**Severidade** (independente da categoria):
- `low` — incomoda, não bloqueia
- `medium` — degrada qualidade, contornável
- `high` — quebra fluxo crítico (gate-bypass, outcome-missing)
- `critical` — corrompe dado/decisão (modelo-alucina em side-effect, confidence-fabricated em scope)

## Scorecard pattern (60 pontos, 6 dimensões + D7 gate)

Cada agente define suas 6 dimensões. Padrão comum:

| Dim | Tema |
|-----|------|
| D1 | Source comprehension (lê fontes e extrai signals) |
| D2 | Output quality (proposta/sugestão/ação tem qualidade adequada) |
| D3 | Gates (respeita guardrails de capacity/conflict/política) |
| D4 | Confidence + provenance (toda escrita cita fonte) |
| D5 | Conversational discipline (tool selection, escopo, recusas) |
| D6 | Cross-agent integration (lê memória de outros agentes) |
| D7 | **Telemetria + outcome** (gate de prod — bloqueia release se <80%) |

Cada dimensão: `/10`. Total `D1+D2+...+D6 / 60` + D7 separado.

### Go/no-go

| Faixa principal | D7 | Status |
|-----------------|-----|--------|
| 55-60 | ≥8 | ✅ Pronto pra produção |
| 45-54 | ≥6 | ⚠️ Pronto pra dogfood interno |
| 30-44 | qualquer | ⚠️ Calibração necessária — voltar pra fase G_N |
| < 30 | qualquer | ❌ Não pronto — bug estrutural |

## Tabelas de banco (gerais — qualquer agente)

| Tabela | Propósito |
|--------|-----------|
| `AgentCalibrationCapture` | 1 row por bug observado (PM ou audit) — campos: `agentSlug`, `category`, `severity`, `status`, `userPrompt`, `observedBehavior`, `expectedBehavior`, links opcionais pra `planningCeremonyId`/`designSessionId`/`meetingId`/`threadId`/`projectId` |
| `AgentCalibrationFix` | N rows por capture — cada tentativa de fix com `fixKind` ∈ prompt/schema/tool/model/migration/infra/docs/other, `commitHash`, `scoreBefore/After` |
| `AgentCalibrationScoreboard` | 1 row/semana/agente — snapshot pelo cron, detecta regressão automaticamente |

Storage bucket: `calibration-evidence` (screenshots binários, 10MB limit, manager+ pra write).

## Runbooks por agente

| Agente | Runbook | Driver CLI | Status |
|--------|---------|-----------|--------|
| **vitoria** | [vitoria-audit-v1.md](vitoria-audit-v1.md) | [scripts/calibrate/drivers/vitoria-cli.ts](../../../scripts/calibrate/drivers/vitoria-cli.ts) | v1 (cobertura D1-D7 parcial) |
| **vitor** | [../../agents/vitor/vitor-audit-v2.md](../../agents/vitor/vitor-audit-v2.md) | [scripts/calibrate/drivers/vitor-cli.ts](../../../scripts/calibrate/drivers/vitor-cli.ts) | v2 (cobertura completa pós-normalização) |
| **alpha** | [../../agents/alpha/alpha-audit.md](../../agents/alpha/alpha-audit.md) | _(criar)_ | runbook v1, driver não existe ainda |

## Como adicionar agente novo no loop

1. Define modelo, route, channel, prompt path, tools path em [.claude/skills/calibrate/registry.md](../../../.claude/skills/calibrate/registry.md)
2. Cria driver CLI em `scripts/calibrate/drivers/<agent>-cli.ts` (espelhar [vitoria-cli.ts](../../../scripts/calibrate/drivers/vitoria-cli.ts))
3. Cria runbook em `docs/runbooks/agent-audits/<agent>-audit-v1.md` com cenários V0..V_NN específicos
4. Atualiza dispatcher `scripts/calibrate/calibrate.sh` adicionando branch no `agent_status` / `agent_driver`
5. Cria fixture seed canônica via SQL idempotente em `scripts/calibrate/fixtures/<agent>.sql`
6. Roda `bash scripts/calibrate/calibrate.sh <agent> status` pra confirmar wire

## Anti-padrões (evitar)

- ❌ **Empilhar regras no prompt cada vez que algo falha** — modelos 4.6+ punem isso (doc Anthropic). Prefira schema strictness, modelo certo, ou skill on-demand.
- ❌ **Categorizar como "modelo-alucina" tudo que dá errado** — alucinação é o último diagnóstico, não o primeiro. Cheque tool/contexto/schema antes.
- ❌ **Fix sem `AgentCalibrationFix` row** — fica off-the-books, telemetria não vê. Sempre registrar (mesmo que aproximado).
- ❌ **Pular o promote-to-eval** — bug que não vira teste, volta. Toda capture `status=fixed` deve ter `evalCaseAdded=true` antes de fechar.

## Convenções de commit

Calibration commits seguem o padrão do repo (`bash scripts/sync-main.sh -m "..."`) com prefixo de agente:

```
vitoria-cal — V6 — tool routing por intent (tool-off-topic fix)
vitor-cal   — V11 — realtime tab B perde input (realtime-drift fix)
alpha-cal   — V3 — outcome reflector (outcome-missing fix)
```

`ZRD-JM-NN` continua sendo aplicado em paralelo via auto-tag.
