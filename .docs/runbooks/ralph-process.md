# Ralph Process — autonomous PRD execution loop

**Status:** active · **Owner:** João Moraes · **Última revisão:** 2026-05-29

Pipeline pra rodar um PRD do início ao fim via Ralph (loop autônomo do Claude Code com fresh-context por iteração). Baseado no [pattern do snarktank/ralph](https://github.com/snarktank/ralph) adaptado ao Volund.

> **Princípio:** local-as-SSOT (consistente com `feedback_local_ssot`). Ralph não substitui revisão humana — automatiza a parte mecânica entre PRD aprovado e PR pronto.

---

## Os 4 ritos

Cada PRD passa por 4 ritos em sequência. Nenhum rito é opcional.

```
┌────────────────┐    ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│ Rito 1         │    │ Rito 2         │    │ Rito 3         │    │ Rito 4         │
│ INTAKE         │───▶│ EXECUÇÃO       │───▶│ CHECKPOINT     │───▶│ CLOSEOUT       │
│ PRD hardening  │    │ Ralph loop     │    │ Review humano  │    │ PR + archive   │
└────────────────┘    └────────┬───────┘    └────────┬───────┘    └────────────────┘
                               │                     │
                               └─────── repeat ──────┘
                                  até prd.json completo
```

### Rito 1 — Intake (PRD hardening)

**Trigger:** PRD existe em `docs/prd/backlog/prd-<feature>.md`, ainda não foi rodado.

**Entrada:** PRD em markdown (prosa, decisões, arquitetura).

**Processo:**
1. Lead técnico (ou Claude operador) faz **crítica brutal** do PRD: contradições, decisões em aberto, AC ausentes, conflitos com memory/AGENTS.md, ambiguidade de arquitetura.
2. PRD é **reescrito in-place** resolvendo cada crítica. Não-objetivos explícitos, decisões fixadas, schema com DDL completo, RLS explícito, métricas com instrumento.
3. Adicionar seção `§ Stories implementáveis` ao final do PRD com lista numerada de stories. Cada story:
   - `id` (formato `<FEATURE>-NNN`, ex: `WIKI-001`)
   - `title` (imperativa, curta)
   - `description` (1 parágrafo)
   - `acceptanceCriteria` (lista; cada critério objetivo)
   - `verifiable` (lista de checks executáveis: typecheck/lint/sql/http/manual_browser)
   - `dependsOn` (ids que precisam estar done)
   - `estimateMinutes` (≤ 30min — story que não cabe em 1 context window é grande demais)
   - `touches` (arquivos previstos — orientativo)
4. Derivar `scripts/ralph/features/<feature>/prd.json` com mesmas stories em JSON, todas com `passes: false`.

**Saída:**
- `docs/prd/ready/prd-<feature>.md` (movido de `backlog/` via `bash scripts/ralph/intake.sh <feature>`)
- `scripts/ralph/features/<feature>/prd.json` (fila)
- `scripts/ralph/features/<feature>/progress.txt` (vazio, criado pelo loop)

**Estados via subdir:** PRDs vivem em `docs/prd/{backlog,ready,in-progress,blocked,done,archive}/`. O subdir é o status — mover = mudar status. PRD novo nasce em `backlog/`; Rito 1 promove pra `ready/`.

**Critério de aprovação:**
- Toda decisão arquitetural fechada (sem TBD)
- Cada story tem ≥ 1 `verifiable` automatizável
- Total estimado caiu em ≤ 25 stories (se passou, escopo grande demais — quebra em mais de uma feature)

### Rito 2 — Execução (Ralph loop)

**Trigger (atalho):** `bash scripts/ralph/next.sh [max_iterations]` — pega 1º PRD em `docs/prd/ready/`, move pra `in-progress/`, dispara o loop, ao fim move pra `blocked/`.

**Trigger (direto, feature específica):** `bash scripts/ralph/ralph.sh <feature> [max_iterations]`

**Processo:** loop bash em [scripts/ralph/ralph.sh](../../scripts/ralph/ralph.sh). Cada iteração:
1. Verifica `prd.json` — se todas as stories tem `passes: true`, sai com `<promise>COMPLETE</promise>`.
2. Spawn **fresh** `claude -p` (subprocess novo, context limpo) com prompt em `scripts/ralph/CLAUDE.md`.
3. O Claude da iteração:
   - Lê `prd.json`, escolhe story de menor `id` com `passes: false` cujos `dependsOn` estão todos done
   - Lê `progress.txt` pra contexto histórico
   - Implementa **somente essa story**
   - Roda `verifiable` checks
   - Se passou: marca `passes: true` no prd.json, append learnings em `progress.txt`, commita via `bash scripts/sync-main.sh -m "ZRD-JM-NN: <feature> — <story-id> <title>"`
   - Se falhou: append falha em `progress.txt` (sem commit), iteração termina; próxima iter tenta de novo com contexto novo
4. Loop volta ao passo 1 (subprocess termina, próximo nasce limpo).

**Estado entre iterações** (memória):
- Git history (commits assinados ZRD-JM-NN)
- `progress.txt` (append-only, learnings + falhas)
- `prd.json` (passes booleano por story)
- `AGENTS.md` (atualizado quando padrão novo é descoberto — vide pattern Ralph upstream)

**Limites:**
- Max iters default: 10 por invocação (não 24/7; humano dispara loops curtos)
- Se 3 iterações consecutivas falharem na mesma story, loop aborta com exit 2 (pivota pra Checkpoint manual)

### Rito 3 — Checkpoint (review humano)

**Trigger:** loop termina (sucesso, max-iter atingido, ou abort por falhas repetidas).

**Processo:**
1. Operador roda `bash scripts/ralph/checkpoint.sh <feature>` (mostra prd.json status, últimos 10 commits, progress.txt tail, diff acumulado vs `main`)
2. Decide:
   - **Continuar:** `bash scripts/ralph/next.sh` (retoma PRD em `blocked/` automaticamente movendo pra `in-progress/`), ou direto `bash scripts/ralph/ralph.sh <feature>`
   - **Pivotar:** edita prd.json (remove story problemática, adiciona substituta, ajusta dependsOn), commita ajuste, dispara `next.sh`
   - **Abortar:** `source scripts/ralph/lib/prd-paths.sh && prd_move <feature> archive`, post-mortem em `docs/runbooks/`
   - **Promover pra done:** se 100% passes, `prd_move <feature> done` + `bash scripts/ralph/closeout.sh <feature>`

**Princípio:** humano sempre no checkpoint. Sem aprovação tácita por loops em série. **Nunca rodar Ralph em background sem revisar entre loops** — código vivo, blast radius alto.

### Rito 4 — Closeout

**Trigger:** todas stories `passes: true`, branch local pronta pra PR.

**Processo:** `bash scripts/ralph/closeout.sh <feature>` executa:
1. **Audit final**:
   - SAGE sweep no diff completo (refactor / dead code / reuse misses)
   - `/security-review` no diff
   - `pnpm lint && npx tsc --noEmit && pnpm build`
2. Se algum check vermelho → para, reporta, operador resolve manualmente
3. Se verde:
   - Gera PR description (resumo + checklist do PRD + link pro PRD)
   - Cria PR via `gh pr create`
   - Move PRD pra `docs/prd/archive/prd-<feature>-YYYYMMDD.md` (committa essa mudança)
   - Append seção "Aprendizados <feature>" em `AGENTS.md` (padrões descobertos durante o loop, gotchas)
   - Limpa `scripts/ralph/features/<feature>/` (move pra `scripts/ralph/features/_archive/`)

---

## Estrutura de arquivos

```
docs/
├── prd/
│   ├── backlog/                       # ideia em rascunho
│   ├── ready/                         # Rito 1 done, prd.json existe
│   ├── in-progress/                   # Ralph rodando ou pausado
│   ├── blocked/                       # checkpoint humano pendente
│   ├── done/                          # 100% passes, aguardando closeout
│   └── archive/                       # pós-closeout (filename ganha -YYYYMMDD)
└── runbooks/
    └── ralph-process.md               # este arquivo (SSOT do processo)

scripts/ralph/
├── next.sh                            # pega próximo de ready/ e dispara
├── intake.sh                          # Rito 1: valida PRD + move pra ready/
├── ralph.sh                           # loop principal (Rito 2)
├── checkpoint.sh                      # status report (Rito 3)
├── closeout.sh                        # audit + PR + archive (Rito 4)
├── CLAUDE.md                          # prompt template lido pelo claude -p
├── lib/
│   └── prd-paths.sh                   # helpers prd_find / prd_state / prd_move
└── features/
    ├── <feature>/
    │   ├── prd.json                   # fila de stories
    │   └── progress.txt               # memória append-only
    └── _archive/
        └── <feature>-YYYYMMDD/        # features concluídas
```

## Skill `/ralph` (Claude Code)

Em sessão Claude Code, o usuário pode invocar a skill `/ralph` (auto-trigger por frases tipo "quais PRDs em backlog", "executa o próximo") que orquestra: listar fila, propor próximo, disparar `next.sh`, reportar status. Definição em `.claude/skills/ralph/SKILL.md`.

---

## Pré-condições do Volund

1. **`claude` CLI instalado e autenticado** (`npm install -g @anthropic-ai/claude-code`)
2. **`jq` disponível** (`brew install jq`)
3. **`pnpm` working** (typecheck via `npx tsc --noEmit`, lint via `pnpm lint`)
4. **`scripts/sync-main.sh` funcional** (Ralph commita via ele — auto-tag ZRD-JM-NN)
5. **Branch `joao-dev` (ou outra branch de feature)** — Ralph nunca roda em `main`
6. **`AGENTS.md` lido pelo Claude** — Ralph aponta CLAUDE.md → AGENTS.md por convenção

---

## Feedback loops (críticos)

Ralph só funciona se `verifiable` realmente capturar regressão. Por tipo:

| Kind | Comando | Quando usar |
|---|---|---|
| `typecheck` | `npx tsc --noEmit` | Toda story que toca TS |
| `lint` | `pnpm lint <path>` | Toda story que cria/edita arquivo |
| `sql` | `psql "$DIRECT_URL" -c "<query>"` (espera output `<expected>`) | Story de migration/schema |
| `http` | `curl -s <url>` (espera shape via `jq`) | Story de endpoint |
| `manual_browser` | TODO: integrar `dev-browser` skill | UI story (manual em v1; automatizar em v2) |

**Regra:** se uma story não tem `verifiable` automatizável (só `manual_browser`), ela exige Checkpoint humano após cada iter — não pode ser parte de loop > 1 iter.

---

## Diferenças vs Ralph upstream

| Aspecto | Ralph upstream | Volund |
|---|---|---|
| Commit | `git commit` direto | `bash scripts/sync-main.sh -m "..."` (auto-tag ZRD-JM-NN + push multi-remote) |
| Prompt | `prompt.md` (Amp) ou `CLAUDE.md` | `scripts/ralph/CLAUDE.md` apontando pro `AGENTS.md` raiz |
| Skills | `/prd` + `/ralph` upstream | Não usamos — Rito 1 é manual (lead técnico decide); skills `/task-gen-*` existem mas são pra Zelar, não Ralph |
| Estado | `prd.json` na raiz | `scripts/ralph/features/<feature>/prd.json` (múltiplas features paralelas) |
| `progress.txt` | Raiz | `scripts/ralph/features/<feature>/progress.txt` |
| Stop | `<promise>COMPLETE</promise>` | Mesmo |
| Feedback humano | Cron / auto-handoff | Checkpoint obrigatório entre loops |

---

## Anti-padrões

- ❌ Rodar `ralph.sh` em background dia inteiro
- ❌ Aprovar PR gerado pelo closeout sem ler o diff
- ❌ Adicionar story sem `verifiable` automatizável e esperar Ralph completar
- ❌ Commit manual no meio de um loop (quebra contagem ZRD e linhagem)
- ❌ Mexer no `prd.json` enquanto o loop está rodando
- ❌ Confiar que `passes: true` significa "funciona" sem rodar checkpoint
