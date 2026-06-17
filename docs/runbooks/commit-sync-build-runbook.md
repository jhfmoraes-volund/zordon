# Runbook (build) — Commit Sync

> **Não-Ralph.** Execução **human-gated** a partir de uma sessão Claude Code interativa. O loop autônomo (`ralph.sh`) foi descartado pra esta feature por 3 motivos: migrations em DB live, código cross-repo (`zordon-daemon`), e 1 open question (slug Composio) que exige julgamento. Spec completa em [docs/prd/backlog/prd-commit-sync.md](../prd/backlog/prd-commit-sync.md); fila de stories em `scripts/ralph/features/commit-sync/prd.json`.

## Como rodar este runbook

- **1 branch, 1 PR.** Tudo em `feat/commit-sync`; commits incrementais por story; **um** PR no fim (não `sync-main.sh` push-per-story pra todos os remotes).
- **Gate humano por fase.** No fim de cada fase eu paro e te mostro o resultado/verify antes de seguir. Migrations: confirmo **cada** `psql` antes de aplicar.
- **Verify por step.** Cada story tem o check `verifiable` do `prd.json`. Sem check verde → não avança.
- **Rollback é aditivo.** Toda migration é `CREATE`/`ADD` → rollback = `DROP`. Anotado por step.
- **Estado do PRD:** mover `backlog → in-progress` ao começar; `→ done` ao abrir o PR. (Não usa `next.sh`, então o move é manual e não toca o `project-wiki` que está em in-progress.)

---

## Fase 0 — Setup (sem efeito em DB/remote)

| # | Ação | Comando | Verify |
|---|------|---------|--------|
| 0.1 | Branch de feature | `git checkout -b feat/commit-sync` | `git rev-parse --abbrev-ref HEAD` = `feat/commit-sync` |
| 0.2 | Mover PRD pra in-progress | `source scripts/ralph/lib/prd-paths.sh && prd_move commit-sync in-progress` | PRD em `docs/prd/in-progress/` |
| 0.3 | `.env` tem `DIRECT_URL` | `grep -q '^DIRECT_URL=' .env && echo ok` | `ok` |
| 0.4 | **[D5] Slug Composio de commits — RESOLVIDO em runtime** | usar `findToolSlug(connectedById, "github", ["list","commits"])` `[code: client.ts:250]` no ingest; não hardcodar. | nenhum — resolvido em código |
| 0.5 | Composio GitHub conectado (PM) | settings → Integrações → GitHub OAuth ativo | conexão ok |

🚦 **Gate 0:** branch criada ✅, PRD em in-progress, GitHub OAuth ativo. Slug não bloqueia mais (runtime via `findToolSlug`); risco residual = Composio não expor commits → fallback Octokit, decidido só se `findToolSlug` voltar `null` na Fase 2.

---

## Fase 1 — Schema determinístico (DB live · gate por migration)

> 5 migrations atômicas + types. Cada `psql` é confirmado individualmente. Aplicação:
> ```bash
> source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f <arquivo>
> ```

| Story | O que | Migration | Verify (`psql -c`) | Rollback |
|-------|-------|-----------|--------------------|----------|
| **COMMIT-001** | 3 enums | `20260618_commit_sync_enums.sql` | `SELECT count(*) FROM pg_type WHERE typname IN ('repo_sync_status','commit_link_source','repo_sync_run_status')` → `3` | `DROP TYPE ...` |
| **COMMIT-002** | `RepoCommit` + RLS | `20260618a_repo_commit.sql` | `SELECT relrowsecurity FROM pg_class WHERE relname='RepoCommit'` → `t` | `DROP TABLE "RepoCommit"` |
| **COMMIT-003** | `ProjectRepoSync` | `20260618b_project_repo_sync.sql` | `... pg_constraint ... contype='u'` → `>=1` | `DROP TABLE "ProjectRepoSync"` |
| **COMMIT-004** | `RepoSyncRun` + host em `MeetingTaskAction` | `20260618c_*.sql` + `20260618d_*.sql` | `... columns ... 'MeetingTaskAction'/'repoSyncRunId'` → `1` | `DROP TABLE "RepoSyncRun"; ALTER TABLE "MeetingTaskAction" DROP COLUMN "repoSyncRunId"` (+ restaurar CHECK antigo) |
| **COMMIT-005** | Regenerar `database.types.ts` | — (edição) | `grep -c 'RepoCommit\|ProjectRepoSync\|RepoSyncRun'` → `>=3` ; `npx tsc --noEmit` exit 0 | revert do arquivo |

⚠️ **COMMIT-004** é o único com risco real: relaxa o CHECK de host de `MeetingTaskAction` (hoje `meetingId` XOR `planningCeremonyId`). Confirmar nome do constraint existente (`\d "MeetingTaskAction"`) antes de drop+recreate, e testar que apply de planning **não** quebrou (smoke).

🚦 **Gate 1:** 4 migrations aplicadas + verify verde + `tsc` limpo. Commit incremental: `git commit -m "commit-sync: schema (COMMIT-001..005)"`.

---

## Fase 2 — Ledger + ingest determinístico (sem IA)

| Story | O que | Verify |
|-------|-------|--------|
| **COMMIT-006** | `src/lib/repo-sync/trailer.ts` — `parseTaskTrailer()` + teste | `npx vitest run src/lib/repo-sync/trailer.test.ts` |
| **COMMIT-007** | `src/lib/repo-sync/ingest.ts` — fetch commits via Composio (como `connectedById`, incremental desde `lastSyncedSha`), upsert `RepoCommit`, link por trailer, atualiza `ProjectRepoSync` | `npx tsc --noEmit` ; teste manual de idempotência (re-rodar não duplica) |

> Aqui o slug da Fase 0.4 entra de verdade. Se Composio não tiver tool de commits utilizável, este é o ponto de pivot.

🚦 **Gate 2:** trailer parser testado + ingest idempotente. Commit incremental.

---

## Fase 3 — API + App + cadência

| Story | O que | Verify |
|-------|-------|--------|
| **COMMIT-008** | routes connect/sync/status/commits (gate `is_manager()`) | `tsc` ; `curl` GET repo-sync sem sessão → `401` |
| **COMMIT-009** | app `github` no registry (`minAccessLevel: manager`) + case no `apps-tab` | `grep -c 'key: "github"'` → `1` |
| **COMMIT-010** | `github-app-view.tsx` (picker + badge synced + lista de commits) | `pnpm lint` ; **manual_browser**: conectar repo, sincronizar, ver badge `synced` + commits |
| **COMMIT-011** | pg_cron `commit_sync_incremental` | `SELECT count(*) FROM cron.job WHERE jobname='commit_sync_incremental'` → `1` |

🚦 **Gate 3:** app conecta + lista commits + linking por trailer aparece na UI. **Isto já é Fase 1 do PRD entregue (≥ sistema atual, sem IA).** Bom ponto de checkpoint pra validar valor antes da camada de agente. Commit incremental.

---

## Fase 4 — Vitoria interpreta (cross-repo: zordon-daemon)

| Story | O que | Repo | Verify |
|-------|-------|------|--------|
| **COMMIT-012** | surface `commit_sync` (context loader + prompt + toolset) | zordon | `tsc` ; `loadContext/buildPrompt/buildTools` tratam `commit_sync` |
| **COMMIT-013** | dispatch no `prepare-turn` + **mirror de tool no `zordon-daemon`** | zordon **+ zordon-daemon** | `grep -c 'commit_sync' prepare-turn/route.ts` ; `tsc` em ambos os repos |
| **COMMIT-014** | `applyPendingActionsForSyncRun()` + `POST /api/repo-sync-runs/[id]/approve` | zordon | `tsc` ; `curl` approve sem sessão → `401` |

⚠️ **COMMIT-013 toca `/Users/joaomoraes/projetos-ai-dev/Perke/perke/zordon-daemon`** — repo separado. Commit/push dele é independente do `feat/commit-sync` do zordon. Anotar os dois SHAs.

🚦 **Gate 4:** chat no channel `commit_sync` propõe `MeetingTaskAction`; "Aprovar tudo" aplica via executor. Commit incremental (nos dois repos).

---

## Fase 5 — Docs + PR

| Story | O que | Verify |
|-------|-------|--------|
| **COMMIT-015** | runbook de operação `docs/runbooks/commit-sync-runbook.md` (uso, não build) + nota do trailer em `AGENTS.md` | `test -f ...` + `grep 'Task:'` |
| — | `prd_move commit-sync done` + abrir PR | `gh pr create` (zordon) + PR no `zordon-daemon` se houve mudança |

🚦 **Gate 5:** PR aberto, PRD em `done/`. Closeout opcional via `scripts/ralph/closeout.sh commit-sync` (roda lint/tsc/build + SAGE/security manuais).

---

## Mapa de decisão rápida

- **Slug Composio não existe** → Gate 0, decidir fallback antes de tudo.
- **CHECK de `MeetingTaskAction` quebra apply de planning** → reverter COMMIT-004, repensar host (tabela de junção em vez de coluna).
- **Volume de commits explode propostas** → agrupar por task no prompt do surface (COMMIT-012), não 1 proposta por commit.
- **Parar no meio** → o PRD fica em `in-progress/`, branch `feat/commit-sync` segura o progresso, `prd.json` marca `passes` por story. Retomável.
