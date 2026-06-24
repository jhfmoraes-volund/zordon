# PRD — Forge Closeout PR (commit + push + gh pr create)

> Status: `backlog` · Owner: João · Created: 2026-05-31 · Target: 1 loop Ralph (~2h)

---

## 0 · Posicionamento

Quinto e último PRD da quinta **Forge-MVP** (depende de F1 e F2). Fecha o loop: hoje o run termina e o código gerado fica num workspace local no Mac de quem rodou o daemon (`~/.volund-forge/workspaces/<slug>/`) — invisível pra quem encomendou. Pra que o ciclo agency-style faça sentido (memory `project_zordon_ops_pipeline`: builder rodou Forge → entrega pro cliente), o run precisa terminar **com um PR aberto** no repo do cliente, gravado em `ForgeRun.prUrl` pra UI mostrar.

Princípio: **um run só está realmente "done" quando o output é visível no GitHub do cliente.**

---

## 1 · Problema

3 sintomas:

1. **Workspace órfão pós-run** — após exec-prd terminar, `~/.volund-forge/workspaces/volu-prd-001/` tem dezenas de arquivos modificados, mas **nenhum commit, nenhum push**. Builder precisa abrir terminal, `cd` no workspace, fazer commit/push/PR à mão. Não escala.

2. **`ForgeRun.repoUrl` e `branchName` parcialmente populados** — schema tem `repoUrl` (preenchido no spawn do run) e `branchName` (nullable, sempre fica null). Sem `prUrl`. UI não tem o que linkar.

3. **Sem audit do output** — `memory.jsonl` tem `filesTouched` por story, mas ninguém compila isso num resumo legível pro cliente. Builder precisa explicar "o que foi feito" toda vez.

**Fonte:**
- [scripts/forge/exec-prd.ts:486-504](../../../scripts/forge/exec-prd.ts) — `autorun_done` apenas escreve evento; nenhum git op.
- [supabase/migrations/20260601l_forge_run_manifest.sql](../../../supabase/migrations/20260601l_forge_run_manifest.sql) — schema atual tem `repoUrl`, `branchName`. Faltam `prUrl`, `prNumber`.
- Memory `project_forge_vs_zordon_workflow` — closeout do Forge é **diferente** do `sync-main.sh` (Zordon push) — Forge faz push programático pra OUTRO repo via `gh`.

## 2 · Solução em uma frase

**Função `closeoutRun(runId)` em `src/lib/forge/runtime/closeout.ts`, chamada pelo `exec-prd.ts` após `markRunDone(reason='all_passed')`, que (1) faz commit no workspace com mensagem montada de `memory.jsonl`, (2) cria branch `forge/<runId-short>`, (3) push via `gh auth` do org-alvo, (4) abre PR via `gh pr create` com body resumindo stories, (5) UPDATE `ForgeRun.branchName/prUrl/prNumber`, (6) emite eventos `closeout_started`, `commit_done`, `push_done`, `pr_opened`.**

## 3 · Não-objetivos

- ❌ Não fazer closeout em runs com `status='error'` ou `pivot_required`. Só success path.
- ❌ Não fazer merge automático do PR. Cliente revisa.
- ❌ Não fazer rebase do workspace antes do commit. Conservador: commit em cima do estado atual.
- ❌ Não criar release / tag. Só PR.
- ❌ Não notificar via Slack/email. UI mostra `prUrl` linkado.
- ❌ Não tratar PR title/body editing pós-criação (caso branch precise de novo push).
- ❌ Não fazer reuse de branch entre runs (cada run = branch novo).
- ❌ Não tratar conflito com branch existente — se `forge/<runId-short>` já existe, falha o closeout com erro claro.
- ❌ Não tocar `sync-main.sh` (Zordon path, completamente diferente).

## 4 · Personas e jornada

**Run finaliza com sucesso:**
> "exec-prd.ts emite autorun_done(ok:true). Chama markRunDone(runId, 'all_passed'). Chama closeoutRun(runId). Função vai no workspace ~/.volund-forge/workspaces/volu-prd-001/, faz `git add -A && git commit -m 'forge(VOLU-PRD-001): 5 stories'`. Cria branch `forge/0408de11`. Push com `gh auth login` do org volund-ia. Abre PR. UPDATE ForgeRun. Emite `pr_opened` com prUrl."

**Builder vê resultado:**
> "Abre `/forge-spike/runs/<runId>`. Status=done. Link 'PR #42 → github.com/cliente/repo/pull/42'. Clica, revisa diff no GitHub."

**PR falha (sem auth):**
> "gh push falha porque daemon não tem credencial pro org-alvo. closeoutRun captura erro, emite `closeout_failed`, faz UPDATE ForgeRun SET meta.closeoutError='no gh auth for org X'. status fica 'done' (não vira 'error' — código foi gerado!). UI mostra warning 'PR não criado: sem auth gh'."

## 5 · Decisões fixadas

| Dn | Decisão | Por quê |
|---|---|---|
| D1 | Helper `closeoutRun(runId)` em `src/lib/forge/runtime/closeout.ts` separado | Concern distinto de event/state. Test isolado. |
| D2 | Chamado em `exec-prd.ts` SÓ após `markRunDone(reason='all_passed')` | Nem `max_reached` nem `no_more_ready` justificam PR (incompleto). |
| D3 | Branch name: `forge/<runId.slice(0,8)>` (ex: `forge/0408de11`) | Único por run. Short hash pra legibilidade. Evita colisão. |
| D4 | Commit message: `forge(<prdSlug>): <N stories>` no subject; body = bullet list dos `MemoryEntry.title` de cada story que passou + sumário de filesTouched count + duração total | Subject conciso pra `git log --oneline`. Body informativo pro PR. |
| D5 | Push via `gh repo set-default` + `gh pr create` (não `git push` raw) | `gh` resolve auth do org corretamente (memory `project_gh_multi_account_sync`). |
| D6 | PR title: `Forge: <prdSlug>` · body: igual ao commit body + "Generated by [Forge daemon](https://docs)..." footer | Auto-explicativo no GitHub. |
| D7 | Migration `20260601o_forge_run_pr_fields.sql` adiciona `prUrl text NULL` e `prNumber integer NULL` em ForgeRun | branchName já existe. prUrl e prNumber faltam. |
| D8 | Falha de closeout (commit, push, PR) **não** vira status='error' do run — código foi gerado com sucesso. Vira `meta.closeoutError: string` e emite `closeout_failed` | Distingue "código falhou" de "publicação falhou". Builder pode rodar closeout manual depois. |
| D9 | Closeout é idempotente: se `ForgeRun.prUrl` já preenchido, retorna sem rodar de novo | Re-run de exec-prd não duplica PRs. |
| D10 | Workspace **não** é apagado pós-closeout (debug). Cleanup vira PRD futuro de housekeeping | Conservador. Espaço em disco é cheap. |
| D11 | Função aceita opt-out via env `FORGE_SKIP_CLOSEOUT=1` pra dev local | Permite rodar exec-prd em loop sem poluir GitHub. |
| D12 | Eventos novos: `closeout_started`, `commit_done`, `push_done`, `pr_opened`, `closeout_failed` (usa helper F1) | UI Realtime mostra progresso do closeout granular. |

## 6 · Arquitetura

```
exec-prd.ts main()
  │
  ├─ autorun_done(ok:true)
  ├─ markRunDone(runId, 'all_passed')      ◄── F2
  │
  └─ if (!process.env.FORGE_SKIP_CLOSEOUT)
       └─ await closeoutRun(runId)         ◄── novo helper
            │
            ├─ check idempotency
            │   SELECT prUrl FROM ForgeRun
            │   if NOT NULL → return early
            │
            ├─ emit('closeout_started', { runId })
            │
            ├─ buildCommitMessage(runId)
            │   SELECT manifest FROM ForgeRun + read memory.jsonl
            │
            ├─ cd ~/.volund-forge/workspaces/<slug>/
            │   git add -A
            │   git commit -m "<msg>"
            │ emit('commit_done', { sha, files })
            │
            ├─ git checkout -b forge/<runId-short>
            │   gh repo set-default <repoUrl>
            │   git push -u origin forge/<runId-short>
            │ emit('push_done', { branch, ahead })
            │
            ├─ gh pr create --title ... --body ...
            │   parse JSON output: { url, number }
            │ emit('pr_opened', { prUrl, prNumber })
            │
            └─ UPDATE ForgeRun SET
                 branchName=$branch,
                 meta=jsonb_set(meta,'{prUrl}', $url),
                 meta=jsonb_set(meta,'{prNumber}', $num)
                 (idem: usar colunas dedicadas via migration D7)
            │
            └─ on any error:
                 emit('closeout_failed', { stage, message })
                 UPDATE ForgeRun SET meta=jsonb_set(meta,'{closeoutError}', $msg)
```

Componentes novos:
- `src/lib/forge/runtime/closeout.ts` — função `closeoutRun(runId)`.
- `supabase/migrations/20260601o_forge_run_pr_fields.sql` — adiciona `prUrl`, `prNumber`.

Componentes modificados:
- `scripts/forge/exec-prd.ts` — chamada após markRunDone.
- `src/components/forge/run-event-stream.tsx` (F3) — renderiza linkavelmente o `prUrl` no header se status=done. (Stretch — pode ficar como atualização leve.)

## 7 · Schema

```sql
-- supabase/migrations/20260601o_forge_run_pr_fields.sql
ALTER TABLE "ForgeRun"
  ADD COLUMN IF NOT EXISTS "prUrl" text NULL,
  ADD COLUMN IF NOT EXISTS "prNumber" integer NULL;

CREATE INDEX IF NOT EXISTS "ForgeRun_pr_idx"
  ON "ForgeRun"("prNumber")
  WHERE "prNumber" IS NOT NULL;

COMMENT ON COLUMN "ForgeRun"."prUrl" IS 'GitHub PR URL after closeout. NULL until PR opened.';
COMMENT ON COLUMN "ForgeRun"."prNumber" IS 'GitHub PR number after closeout. NULL until PR opened.';
```

RLS: já coberta — `ForgeRun` policies (que já existem) aplicam às novas colunas automaticamente.

## 8 · APIs

Nenhuma rota HTTP nova. Helper interno.

API TypeScript:
```ts
// src/lib/forge/runtime/closeout.ts
export type CloseoutResult = {
  ok: true;
  prUrl: string;
  prNumber: number;
  branch: string;
  commitSha: string;
} | {
  ok: false;
  stage: 'commit' | 'push' | 'pr' | 'db';
  message: string;
};

export async function closeoutRun(runId: string): Promise<CloseoutResult>;
```

## 9 · UX

UI atualização leve em `<RunEventStream>` (F3):

```
Run 0408de11  ·  status: done  ·  PR #42 →                ◄── NEW link
              ┌─────────────────────────────────────┐
              │ events.kind=pr_opened              │
              │ payload.prUrl = github.com/.../42  │
              └─────────────────────────────────────┘
```

CLI feedback no daemon log:
```
✓ closeout: commit (abc1234) · push (forge/0408de11) · PR #42
  → https://github.com/volund-ia/test-zordon-forge-calendly-clone/pull/42
```

## 10 · Integrações

- **F1** é pré-requisito (eventos de closeout usam o helper).
- **F2** é pré-requisito (closeout só roda após `markRunDone(reason='all_passed')`).
- **F3** mostra `prUrl` no header — alinhamento leve, não bloqueante.
- **F4** independente.
- **Memory `project_gh_multi_account_sync`** — `gh` switching está em `scripts/lib/gh-account-switch.sh`. Closeout reutiliza essa lógica, mas para o repo-alvo do CLIENTE (não Zordon). Pode precisar mapping novo: `repoUrl → gh-account` (decisão D5 cobre via `gh repo set-default`).

## 11 · Faseamento

1 fase. Closeout é atômico (ou abre PR ou loga erro).

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| `gh` não autenticado pro org-alvo (volund-ia ou outros clientes) | Alta | Alta | D8 trata como `closeoutError` não-fatal. Builder roda `gh auth login` manualmente. Documentar em runbook. |
| Workspace tem arquivos não-relacionados ao run (lixo de runs anteriores) | Média | Média | `git add -A` pega tudo. v1 aceita; cleanup pré-commit é PRD futuro. |
| Branch já existe (re-run sem cleanup) | Baixa | Média | D9 idempotência: se prUrl já set, skip. Se prUrl null mas branch existe, falha closeout com `branch_exists`. |
| Token GitHub expira mid-push | Baixa | Média | Falha vira `closeoutError`, código não é perdido. Manual recovery. |
| Commit message tem caracteres que quebram shell (backticks, etc.) | Média | Média | Usar `gh pr create --body-file <tempfile>` ao invés de `--body "<string>"` pra evitar escaping. |
| `~/.volund-forge/workspaces/<slug>/` não existe (exec-story não criou) | Baixa | Alta | Pré-check: se dir não existe, emit erro `no_workspace`, retorna. |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| `ForgeRun.prUrl` populado pós-success | `SELECT prUrl FROM "ForgeRun" WHERE status='done'` (1 run de teste) | NOT NULL |
| PR realmente abre no GitHub | `gh pr view <prUrl>` | exit 0, state OPEN |
| Latência markRunDone → pr_opened | timestamp do evento | ≤ 30s |
| Falha de closeout não vira status='error' | Run com gh auth missing | status='done', meta.closeoutError preenchido |
| Idempotência: chamar 2x não cria 2 PRs | Manual: rodar closeoutRun(runId) já fechado | retorna early, sem novo PR |

## 14 · Open questions

- (Fase 2) Workspace cleanup pós-closeout.
- (Fase 2) Multi-PR por run (1 PR por story em vez de 1 por run).
- (Fase 2) Auto-merge se CI passa.

## 15 · Referências

- [scripts/forge/exec-prd.ts](../../../scripts/forge/exec-prd.ts) — autorun_done lifecycle
- [scripts/sync-main.sh](../../../scripts/sync-main.sh) — exemplo Zordon-side (NÃO usar como base; Forge é diferente)
- [scripts/lib/gh-account-switch.sh](../../../scripts/lib/gh-account-switch.sh) — gh multi-account
- Memory `project_gh_multi_account_sync`, `project_forge_vs_zordon_workflow`, `project_zordon_ops_pipeline`
- PRD irmãos: [prd-forge-event-ssot.md](prd-forge-event-ssot.md), [prd-forge-run-lifecycle.md](prd-forge-run-lifecycle.md)

## 16 · Stories implementáveis

```yaml
- id: FCO-001
  title: Migration prUrl + prNumber em ForgeRun
  description: ALTER TABLE adiciona 2 colunas + índice + comments.
  acceptanceCriteria:
    - "supabase/migrations/20260601o_forge_run_pr_fields.sql existe e roda"
    - "Colunas prUrl (text NULL), prNumber (integer NULL) existem"
    - "Index ForgeRun_pr_idx existe"
    - "database.types.ts atualizado"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.columns WHERE table_name='ForgeRun' AND column_name IN ('prUrl','prNumber')"
      expected: "2"
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_indexes WHERE indexname='ForgeRun_pr_idx'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 15
  touches:
    - supabase/migrations/20260601o_forge_run_pr_fields.sql
    - src/lib/supabase/database.types.ts
  agentProfile: db
  passes: false

- id: FCO-002
  title: Implementar closeoutRun() em closeout.ts
  description: Função que orquestra commit + branch + push + gh pr create + UPDATE. Idempotente. Captura falha em stage e retorna CloseoutResult discriminado.
  acceptanceCriteria:
    - "src/lib/forge/runtime/closeout.ts existe"
    - "Exporta closeoutRun(runId: string): Promise<CloseoutResult>"
    - "Check idempotency via SELECT prUrl"
    - "Usa execFile (não shell raw) pra git commands"
    - "Usa gh CLI subprocess pra PR (não API direta)"
    - "Falha em qualquer stage não throw — retorna { ok: false, stage, message }"
    - "UPDATE ForgeRun SET branchName, prUrl, prNumber na sucesso"
    - "Emite 5 eventos via createEmitter (F1)"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit src/lib/forge/runtime/closeout.ts"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'closeoutRun\\|CloseoutResult' src/lib/forge/runtime/closeout.ts"
      expected: "2"
  dependsOn: ["FCO-001"]
  estimateMinutes: 30
  touches:
    - src/lib/forge/runtime/closeout.ts
  agentProfile: code
  passes: false

- id: FCO-003
  title: Helper buildCommitMessage(runId)
  description: Lê memory.jsonl + ForgeRun.manifest e monta subject + body. Usado por closeoutRun e PR body.
  acceptanceCriteria:
    - "Função buildCommitMessage(runId) em closeout.ts (ou módulo separado)"
    - "Subject: 'forge(<prdSlug>): N stories'"
    - "Body: bullet list de title de cada story passing + sumário (filesTouched count, duração)"
    - "Trata caso de memory.jsonl ausente (body genérico)"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit src/lib/forge/runtime/closeout.ts"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'buildCommitMessage' src/lib/forge/runtime/closeout.ts"
      expected: "1"
  dependsOn: ["FCO-002"]
  estimateMinutes: 20
  touches:
    - src/lib/forge/runtime/closeout.ts
  agentProfile: code
  passes: false

- id: FCO-004
  title: Plumb closeoutRun no exec-prd.ts
  description: Chamada após markRunDone(reason='all_passed'). Respeita FORGE_SKIP_CLOSEOUT env. Não bloqueia o exit.
  acceptanceCriteria:
    - "exec-prd.ts importa closeoutRun"
    - "Chama await closeoutRun(autorunId) só após markRunDone com reason='all_passed'"
    - "Skip se process.env.FORGE_SKIP_CLOSEOUT==='1'"
    - "Falha não muda exit code do exec-prd"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit scripts/forge/exec-prd.ts"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'closeoutRun' scripts/forge/exec-prd.ts"
      expected: "1"
  dependsOn: ["FCO-002"]
  estimateMinutes: 15
  touches:
    - scripts/forge/exec-prd.ts
  agentProfile: code
  passes: false

- id: FCO-005
  title: UI mostra prUrl como link no header do run
  description: <RunEventStream> ou page.tsx do /forge-spike/runs/[id] mostra link 'PR #N' se ForgeRun.prUrl preenchido.
  acceptanceCriteria:
    - "page.tsx ou run-event-stream renderiza <a href={run.prUrl}>PR #{run.prNumber}</a> se prUrl NOT NULL"
    - "Sem prUrl, header não quebra"
    - "Link abre em nova aba (target='_blank')"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit src/app/forge-spike/runs/[id]/page.tsx"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'prUrl\\|prNumber' src/app/forge-spike/runs/[id]/page.tsx src/components/forge/run-event-stream.tsx 2>/dev/null | awk -F: '{s+=$2} END {print (s>=2)?\"OK\":\"FAIL\"}'"
      expected: "OK"
  dependsOn: ["FCO-001"]
  estimateMinutes: 15
  touches:
    - src/app/forge-spike/runs/[id]/page.tsx
    - src/components/forge/run-event-stream.tsx
  agentProfile: ui
  passes: false

- id: FCO-006
  title: Smoke test closeout end-to-end
  description: Run completo até PR aberto. Verifica prUrl populado, gh pr view confirma PR existe.
  acceptanceCriteria:
    - "Após run de teste: ForgeRun.prUrl NOT NULL"
    - "gh pr view <prUrl> retorna exit 0 com state=OPEN"
    - "Workspace tem branch local forge/<short>"
    - "Eventos closeout_started, commit_done, push_done, pr_opened todos em ForgeEvent"
  verifiable:
    - kind: manual_browser
      command_or_query: "bash scripts/forge/test-smoke-closeout.sh"
      expected: "PASS"
  dependsOn: ["FCO-003", "FCO-004"]
  estimateMinutes: 25
  touches:
    - scripts/forge/test-smoke-closeout.sh
  agentProfile: ops
  passes: false
```
