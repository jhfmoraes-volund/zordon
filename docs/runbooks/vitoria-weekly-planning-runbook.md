# VITORIA — PLANNING SEMANAL & TRADUÇÃO DE SSOT EXTERNO — Runbook

> Não-Ralph. Capacidade evolutiva com julgamento + human-in-the-loop — iterada por humano + Claude, não por loop autônomo. Mesmo regime do [metrics-registry-runbook.md](metrics-registry-runbook.md).
>
> Substrato: [vitoria-v2-runbook.md](vitoria-v2-runbook.md) (source readers, eval suite, skill catalog). Este runbook **constrói em cima**, não substitui.
>
> Data de abertura: 2026-06-15.

---

## 0 · NORTH STAR — O QUE FICA PRONTO

A Vitoria conduz a planning **semana a semana, em cadência**, lembrando do que aconteceu nas sprints passadas e lendo o **pool inteiro de insumos**. Quando o projeto vive numa ferramenta externa (Linear / Trello / planilha / Notion), ela trata esse externo como **SSOT canônico** e **traduz** pro backlog Zordon — re-dimensionando Function Points na rubrica interna (1-13), com procedência rastreável de cada task.

Uma frase: **o externo é a verdade, o Zordon é a projeção traduzida, a Vitoria é a tradutora — e ela propõe, o PM aprova.**

---

## 1 · DECISÕES TRAVADAS (imutáveis — não rediscutir no meio da fase)

| # | Decisão | Por quê |
|---|---------|---------|
| **D1** | **Externo é SSOT por design.** Zordon = projeção traduzida, nunca o mestre. | O cliente trabalha na ferramenta dele, diretamente. A gente prefere ficar lá. |
| **D2** | **Tradução é uma via só** (externo → Zordon), **recorrente**, **sem write-back**. | Não escrevemos na ferramenta do cliente. Write-back bidirecional = track estratégico separado, fora deste runbook. |
| **D3** | **Toda fonte linkada tem `role` = `ssot` \| `reference`.** `ssot` dispara tradução+reconciliação; `reference` só alimenta contexto. | É o mecanismo concreto que faz a Vitoria "comprehend que parte do projeto está fora". |
| **D4** | **Procedência por task é obrigatória.** Toda task traduzida carrega ref tipado à origem (issue / card / linha da planilha). Sem ref, não cria. | Princípio grounded ([feedback_grounded_no_hallucination]). Sem ref, o re-sync duplica tudo. |
| **D5** | **Divisão de propriedade de campo.** Externo é dono do *"o quê"* (existência, título, status, prioridade, estrutura). Zordon é dono do *"como/quanto"* (FP, AC, descrição SDD, sprint). Re-sync respeita a divisão. | Mata a dupla contabilidade: muda o que é do externo, **preserva** o enriquecimento interno. |
| **D6** | **FP traduzido = sizing interno 1-13** (heurísticas sp-estimator), **nunca cópia do estimate externo**. | É o que alimenta capacidade de sprint / velocity. IFPUG/APF formal é outro deliverable ([docs/apf-estimator](../apf-estimator/README.md)), fora daqui. |
| **D7** | **Vitoria PROPÕE, PM aprova** — inclusive ações de sprint (concluir/ativar/criar/carryover), no mesmo staging atômico das task actions. | Consistente com o modelo existente (`MeetingTaskAction`). Auto-exec = Fase futura, atrás de toggle. |
| **D8** | **Cadência = automática semanal.** `pg_cron` cria a ceremony + `daemon` roda a 1ª passada (review→plan); o PM é notificado e abre já com review + rascunho. | Remove o *toil de setup*, não o julgamento. Runtime daemon, alinhado à migração do chat de agente pro daemon. |
| **D9** | **Duas comportas.** Comporta 1 = curadoria de **input** (Vitoria propõe o conjunto de insumos + o mapeamento de schema; PM ajusta). Comporta 2 = aprovação de **output** (tasks + sprint actions). | Garbage-in/garbage-out: a qualidade da planning depende de insumo relevante. A comporta 1 pode auto-confirmar conforme a confiança sobe. |
| **D10** | **Taxonomia de insumo: `blob` vs `tracker consultável`.** Blob (Drive/Notion/transcript/upload/CSV → `fullText`) vs Tracker (GitHub hoje; Linear/Trello/Jira via Composio → query tool, **não** blob). | Achatar um tracker em texto é lossy. GitHub já é o precedente de "sistema consultável via tools". |
| **D11** | **Memória de sprint = Sprint Outcome digest.** Determinístico via SQL (done/carryover/velocity FP/temas de retro/blockers) das últimas N sprints, injetado no contexto da planning. | Continuidade semana a semana = isso. Hoje não existe ponte retro→próxima planning. |

---

## 2 · ARQUITETURA & CONTRATOS

### 2.1 Mapa — o que reusa (grounded) vs o que é novo

**Reusa (já existe, não reinventar):**

| Peça | Onde |
|------|------|
| Agente Vitoria (`loadContext`/`buildPrompt`/`buildTools`, surfaces planning/pm_review/release_planning) | [src/lib/agent/agents/vitoria/index.ts](../../src/lib/agent/agents/vitoria/index.ts) |
| Connector da planning (chat → `runAgent`) | [src/lib/agent/connectors/planning-chat.ts](../../src/lib/agent/connectors/planning-chat.ts) |
| Staging atômico: `PlanningCeremony` + `EntityLink` + `MeetingTaskAction` + `propose_task_action`/`propose_story` | [tools.ts](../../src/lib/agent/agents/vitoria/tools.ts), migration `20260528b_planning_ceremony_core.sql` |
| Máquina de sprint: `status` upcoming/active/completed, `/activate` RPC (conclui o anterior na mesma tx), `/complete`, `SprintRetrospective` | `20260504_sprint_activate_rpc.sql`, `20260506_sprint_goal_and_retro.sql`, [helpers.ts `findCurrentSprint`](../../src/components/sprint/helpers.ts) |
| Leitura de fonte (50k cap, kind dispatch) | [read-context-source.ts](../../src/lib/agent/tools/read-context-source.ts) |
| Pool de contexto: `ContextSource` (kinds + `fullText`) + adapters + refresh | [src/lib/context-sources/](../../src/lib/context-sources/) |
| Composio (GitHub = precedente de tracker consultável) | [src/lib/composio/client.ts](../../src/lib/composio/client.ts) |
| Daemon (claim/job/presence) + `pg_cron` (já usado em insights/granola) | `api/daemon/*` |
| Rubrica de FP 1-13 | [sp-estimator-option-a-heuristics.md](../features/estimation/sp-estimator-option-a-heuristics.md), [function-points-reference.md](../features/estimation/function-points-reference.md) (IFPUG, p/ contexto) |

**Novo (este runbook constrói):**

- `role` (`ssot`\|`reference`) no link da fonte → ceremony/projeto.
- **Translation/reconciliation engine** (externo → tasks Zordon propostas).
- **Procedência por task** (ref tipado à origem) + **field-ownership split** no re-sync.
- **Tracker query adapter** (Linear/Trello via Composio), no padrão do GitHub.
- **Schema-inference** pra fonte freeform (planilha/doc-lista).
- **Sprint Outcome digest** (SQL determinístico) na camada de contexto.
- **`propose_sprint_action`** (concluir/ativar/criar/carryover) no staging.
- **Cadência** (`pg_cron` cria ceremony + `daemon` roda 1ª passada) + **Comporta 1** (input curation + mapping confirm).

### 2.2 Fluxo

```
   FERRAMENTA DO CLIENTE (SSOT)            POOL DE INSUMOS (projeto)
   Linear / Trello / planilha / Notion     blob (Drive/Notion/transcript)
        │  role=ssot                        tracker (GitHub/Linear) role=ref
        │                                          │
        ▼                                          ▼
   ┌──────────────────── VITORIA (tradutora) ─────────────────────┐
   │  COMPORTA 1 (input): propõe conjunto de insumos +            │
   │                      mapeamento de schema → PM ajusta        │
   │        │                                                     │
   │        ▼                                                     │
   │  re-lê SSOT → diff vs projeção → traduz deltas:              │
   │     row/issue/card → Task Zordon proposta                    │
   │        + FP re-estimado 1-13 (rubrica, não cópia)            │
   │        + descrição SDD + AC + sprint                         │
   │        + REF tipado à origem (procedência)                   │
   │        + Sprint Outcome das últimas N sprints (memória)      │
   │        │                                                     │
   │        ▼                                                     │
   │  COMPORTA 2 (output): tasks + sprint actions (staging)       │
   └──────────────────────────┬──────────────────────────────────┘
                              │  PM revisa no chat
                              ▼
                    "Concluir" → aplica cascata (Zordon)
   (nada aplica sem PM · externo NUNCA é escrito)
```

### 2.3 Contrato do registro de tradução

Cada task traduzida guarda o vínculo com sua origem (procedência D4) e respeita o ownership split (D5):

```
TranslationLink (conceito — schema na Fase 2)
  taskId            → Task.id (destino Zordon)
  sourceKind        → 'linear' | 'trello' | 'spreadsheet_gsheets' | 'notion' | ...
  externalRef       → id do issue/card OU coord da linha (ex.: "row:42")
  ownedByExternal   → { title, status, priority }   # campos que o re-sync sobrescreve
  ownedByZordon     → { functionPoints, sdd, acceptanceCriteria, sprintId }  # preservados
  state             → 'proposed' | 'applied' | 'diverged' | 'orphaned'
```

`diverged` = externo mudou um campo `ownedByExternal` desde a última aplicação → vira proposta de update. `orphaned` = sumiu do SSOT → vira proposta de archive.

### 2.4 Vocabulário

| Termo | Significado |
|-------|-------------|
| **SSOT** | A ferramenta externa onde o projeto vive de verdade (cliente). |
| **Projeção** | O backlog Zordon traduzido — derivado, nunca canônico. |
| **`role`** | `ssot` (traduz+reconcilia) vs `reference` (só contexto). |
| **Comporta 1 / 2** | Gate de input (curadoria de insumos) / gate de output (aprovação de propostas). |
| **Sprint Outcome** | Digest determinístico do sprint que fecha (done/carryover/velocity/retro). |
| **blob / tracker** | Insumo snapshot-fullText vs sistema consultável via tools. |

---

## 3 · O LOOP (toda execução da cadência, sem atalho)

1. **`pg_cron` (segunda):** cria/abre a `PlanningCeremony` do sprint da semana + auto-linka insumos novos do pool. Enfileira job.
2. **`daemon` claima o job → Vitoria roda a 1ª passada:**
   1. Monta o **Sprint Outcome** do sprint que fecha (SQL).
   2. Re-lê as fontes `role=ssot`, **diff** vs projeção.
   3. **Comporta 1:** propõe o conjunto de insumos + (se freeform) o mapeamento de schema.
   4. Traduz os deltas → propostas: tasks (FP 1-13 + SDD + AC + sprint + **ref de procedência**) + sprint actions.
   5. `phase = proposing`. **Notifica o PM.**
3. **PM abre a planning:** revisa a **Comporta 1** (ajusta insumos/mapping) → revisa a **Comporta 2** (aprova/edita tasks + sprint actions).
4. **"Concluir"** → aplica em cascata no Zordon. **Externo nunca é tocado.**

**Invariante:** nada aplica sem aprovação humana. O externo é read-only. FP é sempre re-estimado, nunca copiado.

---

## 4 · FASES (1→4 · cada fase entrega mais que o sistema atual)

### FASE 1 — INSUMOS UNIVERSAIS + CONTINUIDADE `[DONE 2026-06-15]`
**Objetivo:** a planning *manual* já fica muito mais esperta — lê todo o pool e lembra das sprints passadas. Não depende de daemon nem cron.
- ✅ Picker universal: linkar **qualquer** kind à ceremony (Drive/Notion/etc). Schema já permite (`EntityLink` sem filtro de kind) — o bloqueio era só a UI. Novo `SourcePoolModal` ([src/components/agent/context-import/source-pool-modal.tsx](../../src/components/agent/context-import/source-pool-modal.tsx)) lista o pool do projeto (`GET /api/context-sources?projectId`) e linka via `POST /api/planning/[id]/context/link`; capability `pool` aditiva no `ContextSheet` primitivo. Notion também habilitado inline na planning.
- ✅ Notion deep-read (recursão até MAX_DEPTH + paginação `has_more`/`next_cursor` + render de child_database como tabela markdown) em [notion.ts](../../src/lib/context-sources/adapters/notion.ts). Slug de query de base degrada pro badge se o catálogo Composio divergir.
- ✅ **Sprint Outcome digest** — view determinística `sprint_outcome_digest` (migration `20260615_sprint_outcome_digest.sql`) + DAL [getSprintOutcomes](../../src/lib/dal/sprint-outcomes.ts) injetado em `loadContext` da Vitoria (últimas 3 concluídas, degrada pra [] em erro).
- ✅ Prompt da Vitoria usa o histórico — seção "Memória de sprints" no volátil + regras no estável (calibrar FP vs velocity média; carryover/retro recorrente vira ação).
- **Gates:** ✅ typecheck (`tsc --noEmit` limpo) · ✅ lint (eslint exit 0) · ✅ `sql` (view retorna done/carryover/velocity — validado em Sprint 2: done=22, carryover=3, velocity=218/242 FP) · ✅ smoke (link gdrive_file → `/context` surfacea kind=gdrive_file; validado via tx rollback).
- **Não entra:** tradução, role flag, cadência.

### FASE 2 — TRADUÇÃO DE SSOT `[OPEN]`
**Objetivo:** *"Vitoria, esta planilha/Linear é meu SSOT — traduz pro nosso jeito."*
- `role` (`ssot`\|`reference`) no link.
- **TranslationLink** (schema §2.3) + procedência por task + field-ownership split.
- **Tracker query adapter** (Linear via Composio, padrão GitHub) — consulta cycle/status/label, não blob.
- **Schema-inference** pra planilha freeform + **Comporta 1** (propõe mapeamento col→ontologia, PM confirma).
- **FP re-estimate 1-13** na tradução (rubrica sp-estimator, nunca cópia).
- **Reconciliação** (diff `proposed`/`diverged`/`orphaned` no re-read).
- **Gates:** typecheck · lint · `sql` (task traduzida tem `externalRef` não-nulo) · smoke (planilha fixture → ≥1 task proposta com FP 1-13 + ref).
- **Não entra:** write-back, IFPUG formal, cadência autônoma.

### FASE 3 — AGÊNCIA DE SPRINT `[OPEN]`
**Objetivo:** Vitoria propõe deixar o ciclo de sprint coeso, PM aprova junto.
- **`propose_sprint_action`** (concluir / ativar / criar / carryover) no staging atômico — mapeia nos endpoints `/activate`, `/complete`, `Task.sprintId`.
- **Carryover** de tasks não-terminadas (move pro próximo sprint, preserva procedência).
- UI de revisão das sprint actions junto com as task actions.
- **Gates:** typecheck · lint · `http` (proposta de activate aplica via RPC, respeita 1-active-por-projeto) · smoke.
- **Não entra:** execução sem aprovação.

### FASE 4 — CADÊNCIA AUTÔNOMA `[OPEN]`
**Objetivo:** toda semana a planning se monta sozinha com review + draft prontos.
- `pg_cron` semanal cria a ceremony + linka insumos novos + enfileira job.
- `daemon` claima → roda a 1ª passada (Sprint Outcome → re-read SSOT → Comporta 1 → tradução → propostas) → `phase=proposing`.
- Push notification ao PM.
- (Sub-fase futura, atrás de **toggle por projeto**: auto-exec de transições low-risk — carryover, concluir sprint vencido, ativar o da semana.)
- **Gates:** smoke (cron dispara → ceremony criada + job enfileirado + notificação) · `http`.
- **Não entra:** auto-exec ligado por default.

---

## 5 · FORA DE ESCOPO (não deixe a sessão derivar)

- **Write-back ao externo** (sync bidirecional, mapear cycle↔sprint, resolver conflito). É a decisão estratégica "quem é SSOT do backlog" — fica em track próprio.
- **IFPUG/APF formal por task** (ALI/AIE/EE/SE/CE → PF). É deliverable de **medição funcional do cliente** — vive em [docs/apf-estimator](../apf-estimator/README.md), não na planning.
- **Auto-execução plena sem aprovação** — só via toggle, e mesmo assim só low-risk.
- **Embeddings/RAG no pool** — segue full-text + section paging (sem vetor).
- **Reescrever o [vitoria-v2-runbook.md](vitoria-v2-runbook.md)** — este é complementar; os source readers (G1) são o substrato da normalização de fonte.

---

## 6 · REFERÊNCIAS

- Agente: [src/lib/agent/agents/vitoria/](../../src/lib/agent/agents/vitoria/) · connector [planning-chat.ts](../../src/lib/agent/connectors/planning-chat.ts)
- Sprint: [helpers.ts](../../src/components/sprint/helpers.ts) · migrations `20260504_*`, `20260506_*`, `20260528b_*`
- Pool: [src/lib/context-sources/](../../src/lib/context-sources/) · [read-context-source.ts](../../src/lib/agent/tools/read-context-source.ts)
- FP: [function-points-reference.md](../features/estimation/function-points-reference.md) (IFPUG) · [sp-estimator-option-a-heuristics.md](../features/estimation/sp-estimator-option-a-heuristics.md) (1-13)
- Runbooks irmãos: [vitoria-v2-runbook.md](vitoria-v2-runbook.md) · [vitor-as-pm-runbook.md](vitor-as-pm-runbook.md) · [metrics-registry-runbook.md](metrics-registry-runbook.md)
- Memories: `project_planning_ceremony` · `project_sprint_planning_living_model` · `project_vitoria_as_diamond_zero` · `project_context_source_pool` · `feedback_grounded_no_hallucination`
