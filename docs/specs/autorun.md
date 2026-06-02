# Spec: Forge Autorun — execução autônoma de PRD com gates de qualidade

> Status: draft · created 2026-05-30 · target: spike 3 (~2h30min implementação)

---

## §1 — Goal

Forge autopilot: dado um PRD com §16 stories, executa **autonomamente** todas as
stories pendentes em ordem topológica (deps satisfeitas), com **3 camadas de
preservação de contexto** entre stories e **6 gates de qualidade** que validam
cada execução antes de marcar `passes: true`.

O builder dispara uma vez (`▶▶ Autorun PRD`) e acompanha pela UI. Loop se
auto-encerra quando: (a) todas stories passes=true → PRD vai pra `done/`,
(b) 2 falhas consecutivas na mesma story → PRD vai pra `blocked/` com relatório
`pivot-required.md`, (c) cost cap excedido → pausa.

Substitui o `bash scripts/ralph/next.sh` por uma versão que **verifica em vez
de confiar**.

---

## §2 — Anchors

Código existente no qual esse spec se apoia:

| Anchor | Função | Como autorun usa |
|---|---|---|
| [scripts/daemon/exec-forge-story.ts](../../scripts/daemon/exec-forge-story.ts) | Spawn de 1 worker `claude -p` com contexto de 1 story | Autorun chama múltiplas vezes em loop |
| [src/lib/forge/prd-fs.ts](../../src/lib/forge/prd-fs.ts) | `readPrd`, `listRuns`, agregação | Fonte da lista de stories + estado |
| [src/app/api/forge/runs/from-story/route.ts](../../src/app/api/forge/runs/from-story/route.ts) | Dispatch detached único | Modelo do dispatch — autorun usa o mesmo `child_process.spawn` |
| [src/app/api/forge/runs/[id]/stream/route.ts](../../src/app/api/forge/runs/[id]/stream/route.ts) | SSE de events.jsonl | Reusa — autorun adiciona stream agregado por PRD |
| [docs/prd/backlog/prd-forge-engine.md#D21](../prd/backlog/prd-forge-engine.md) | D21 pivot detection (2 falhas consecutivas) | Implementação canônica desta regra |
| [docs/prd/backlog/prd-forge-engine.md#D20](../prd/backlog/prd-forge-engine.md) | D20 anti-pattern grep | Implementação canônica |
| [scripts/ralph/ralph.sh](../../scripts/ralph/ralph.sh) | Loop Ralph atual (sequencial, sem gates) | Modelo conceitual — Forge troca por TS + gates |

---

## §3 — Constraints

**Não-negociáveis:**

1. **Localhost-only**: orchestrator é processo Node detached spawned pela Next.js
   API. Sem servidor remoto. Sobrevive a `pnpm dev` restart via `child.unref()`.

2. **Sequencial em v1**: 1 worker por vez. Paralelo (worktrees) fica pra spike 4
   independente, depois que sequencial estiver sólido.

3. **Context preservation em 3 camadas**:
   - Camada 1 (Filesystem): repo real após cada commit (claude lê via Read tool)
   - Camada 2 (memory.jsonl): `.forge/<runId>/memory.jsonl` append-only.
     1 linha por story passes=true contendo `{ story, summary, files, cost,
     learnings[] }`. Próximo worker recebe no prompt como "Stories já feitas
     neste PRD".
   - Camada 3 (PRD markdown): static, escrito pelo Vitor antes — fonte do "porquê"

4. **Verifiable enforcement (gate 1)**: orchestrator executa CADA verifiable
   check da story (typecheck/sql/http/manual_browser) antes de marcar
   `passes: true`. Se algum check retorna ≠ expected → story `failed`.

5. **Smoke between stories (gate 2)**: após cada story, roda
   `npx tsc --noEmit` no projeto. Se quebrou → rollback do commit + story
   marcada `failed`. (Build completo via `pnpm build` é opcional, atrás de flag.)

6. **Cost caps (gate 3)**: dois limites configuráveis:
   - `cost-cap-story`: default $1.00 — story que excede é killed mid-flight
   - `cost-cap-prd`: default $10.00 — autorun pausa antes de spawnar próxima
   - Custo é extraído via `claude -p --output-format=stream-json` (já implementado em exec-story)

7. **Anti-pattern grep (gate 4)**: após worker terminar, antes de validar, grep
   no diff por padrões proibidos por `agentProfile`:
   - `ui` profile: `<Dialog `, `window.confirm`, `setState` após `fetch`
   - `db` profile: `prisma migrate`, migration sem `ENABLE ROW LEVEL SECURITY`
   - `api` profile: validação Zod fora de `/api/`, response síncrona pra LLM
   - Hit em severity=block → story `failed`

8. **Diff size review (gate 5)**: se diff > 500 LOC ou > 20 arquivos →
   story marcada `needs-human-review` (não failed, não passed). Autorun pausa,
   builder revisa e decide.

9. **Touches mismatch (gate 6)**: se `story.touches` diz `[a, b]` mas worker
   editou `[c, d, e]` → registra warning. Não bloqueia, mas aparece no relatório.

10. **Pivot detection**: contador de falhas consecutivas POR story. Limite default
    = 2. Atingido → autorun para, escreve `.forge/<runId>/pivot-required.md`
    com sintomas + hipótese de problema na PRD, move PRD pra `blocked/`.

11. **Convention de commit**: cada story commitada com
    `ZRD-JM-NN: forge — <story-id> — <slug>` (memory `feedback_commit_convention`).

12. **HITL strategy configurável** no dispatch:
    - `conservative`: para na 1ª falha de qualquer story
    - `retry-once` (default): retry 1× com erro como hint, depois para
    - `full-auto`: só para em 2 falhas consecutivas mesma story

---

## §4 — Success signals

**Cada um é validado por uma query/observação concreta:**

| Signal | Como medir |
|---|---|
| Autorun completa PRD pequeno sem intervenção | Disparar autorun em PRD com 3-5 stories, observar que todas terminam `passes: true` em <30min |
| Memory.jsonl reduz custo da story N+1 | Comparar tokens_in da iter 2 vs iter 1 do mesmo PRD. Esperado: iter 2 ≤ iter 1 × 0.8 (menos redescoberta) |
| Verifiable rodando de verdade | Forçar story onde `verifiable.command` falha → garantir que story NÃO marca passes=true |
| Pivot detection dispara em 2 fails | Sabotar uma story (AC impossível) → ver autorun parar após 2 tentativas, gerar pivot-required.md |
| Anti-pattern bloqueia UI feia | Criar story UI onde claude (intencionalmente) usa `<Dialog>` raw → grep deve detectar, story falha |
| Cost cap interrompe runaway | Setar cap=$0.10, disparar story cara → autorun mata antes de spawnar próxima |
| Diff size flag aparece pra revisão | Story que mexe em 600 LOC → aparece `needs-human-review` na UI |
| HITL strategies funcionam | Setar `conservative` + sabotar story 1 → para imediatamente. Setar `full-auto` → tenta 2× antes de parar |
| memory.jsonl visível na UI | Aba "Memory" no PRD detail mostra JSONL pretty-printed |

---

## §5 — Non-goals

**Explicitamente fora deste spec — não implementar:**

- ❌ **Modo paralelo (worktrees)**: spike 4 separado. Sequencial primeiro.
- ❌ **Supabase persistence**: events ficam em filesystem (`.forge/<runId>/`).
  Upload pro DB vem em outro spike.
- ❌ **Multi-PRD orchestration**: 1 autorun = 1 PRD. Multi-PRD via Vitoria
  Planning Ceremony é Phase ∞.
- ❌ **Pause/resume via web**: autorun roda até fim ou aborto. Pause manual via
  `kill <pid>` no terminal por enquanto. UI pause/resume vem depois.
- ❌ **Replay de runs**: events ficam, mas não tem mecanismo de "rerodar story X
  isolada". Workaround: dispatch manual da story.
- ❌ **Substituir Ralph (`scripts/ralph/*.sh`)**: convivem. Quando autorun
  estiver sólido, deprecar Ralph é Phase ∞.
- ❌ **Auto-promote backlog → ready**: autorun só roda PRDs já em `ready/` ou
  `in-progress/`. Promote é decisão humana (rito intake).
- ❌ **Cost forecasting upfront**: só mostra cost realizado, não estimativa pré.
- ❌ **Branch per story**: tudo no branch atual (`forge-engine-spike` no sandbox,
  `joao-dev` em prod). Branch isolada por story vem com worktrees.

---

## §6 — Upstream

**Origem deste spec (rastreabilidade Diamond 1 → Diamond 2):**

- type: `prd`, id: `prd-forge-engine`, url:
  [docs/prd/backlog/prd-forge-engine.md](../prd/backlog/prd-forge-engine.md),
  description: PRD-mãe define D19/D20/D21/D22 que esse spec implementa em parte
- type: `meeting`, id: `chat-2026-05-30-autorun`,
  description: conversa onde João pediu "piloto automático, não perder
  contexto, melhorias de qualidade do run"
- type: `task`, id: `spike-3-autopilot`,
  description: spike 3 do roadmap Forge (sequencial + memory + gates)

---

## Implementação proposta — 4 sub-spikes incrementais

**3a (~45min) — Sequencial mínimo, sem gates:**
- `scripts/daemon/exec-forge-run.ts` — orchestrator loop em Node
- `src/app/api/forge/runs/from-prd/route.ts` — POST dispatch
- Loop simples: pick → spawn exec-story → wait done → next
- Sem memory.jsonl, sem verifiable enforcement, sem gates
- UI: botão `▶▶ Autorun` no PRD detail + nova rota `/forge-spike/autoruns/[id]`

**3b (~30min) — Context preservation:**
- exec-prd grava memory.jsonl após cada story passes=true
- exec-story passa a aceitar `--memory-path` arg, injeta no prompt
- UI: aba "Memory" no autorun viewer

**3c (~45min) — Gates 1+2 (verifiable + smoke):**
- exec-prd executa cada verifiable.command_or_query, checa expected
- exec-prd roda `npx tsc --noEmit` entre stories
- Falha em qualquer → story fica failed, increment counter
- Aborta autorun se 2 falhas consecutivas mesma story (pivot)

**3d (~30min) — Gates 3+4+5+6 (cost + anti-pattern + diff size + touches):**
- Cost parsing via stream-json
- Anti-pattern grep no diff por agentProfile
- Diff size > 500 LOC → needs-human-review
- Touches mismatch → warning no memory

Total: ~2h30min de implementação. Resultado: autopilot prod-ready pra PRDs
pequenos-médios (≤ 15 stories).
