# PRD — Commit Sync (GitHub App: o repo vira SSOT do board)

> **Legenda de procedência** — `[code: path:line]` = fato verificado no repo · `[user]` = decisão da conversa de intake (2026-06-17) · `[inference]` = proposta de implementação a confirmar no Rito 1.

**Status:** backlog · **Feature slug:** `commit-sync` · **App key:** `github` · **Agente dono:** Vitoria (novo surface `commit_sync`)

---

## 1. Problema

1. **Não temos visibilidade nenhuma de commits dentro do Zordon.** O ledger de commits (sha, autor, quando) não é buscado nem armazenado em lugar algum — `[code: src/lib/github.ts:1]` mantém o Octokit comentado, e o adapter de GitHub só puxa README/PR/issue `[code: src/lib/context-sources/adapters/github.ts:56]`. O trabalho real (o que foi commitado, por quem, quando) é invisível pra plataforma.
2. **O board de tasks e o trabalho real divergem silenciosamente.** Hoje só `pull_request.closed+merged` move uma task pra `done` `[code: src/app/api/webhooks/github/route.ts:58]`. Trabalho que não passa por PR rastreada, ou que nunca virou task, simplesmente não aparece. O board é uma intenção desatualizada, não um espelho do que aconteceu.
3. **O PM tem que manter o board na mão.** Manter status, criar tasks pro que já foi feito, fechar o que já entregou — tudo manual. É exatamente o trabalho que o João disse que não quer que o PM faça `[user]`.

## 2. Solução em uma frase

Um app de GitHub no projeto, que o PM conecta uma vez, transforma o histórico de commits no SSOT do board: a Vitoria lê os commits, reconcilia com as tasks existentes e cria as que faltam, e o PM só aprova com um clique.

## 3. Não-objetivos

- **Não** escrever no GitHub (criar branch/PR/issue a partir de task) — isso é Forge/fluxo existente, fora daqui.
- **Não** análise de qualidade de código / review de diff. Só atribuição commit→task.
- **Não** multi-repo por projeto no MVP — 1 projeto : 1 repo `[user]`.
- **Não** webhook real-time de `push` no MVP — cadência via pg_cron; push real-time é Fase 4.
- **Não** aplicar mudanças no board sem aprovação humana — toda escrita passa por propose→approve `[user]`.
- **Não** substituir o webhook de PR existente — ele continua movendo task→done no merge `[code: src/app/api/webhooks/github/route.ts:58]`.

## 4. Personas e jornada

- **PM / head-ops (dono do board)** — *"Eu conecto o repo uma vez. Depois eu não quero ficar mexendo em task — eu quero abrir o app, ver que está `synced`, e aprovar o que a Vitoria entendeu dos commits da semana."* `[user]`
- **Vitoria (PM agente)** — *"Eu leio os commits novos desde o último sync, vejo quais batem com tasks abertas (e fecho/avanço), e proponho tasks novas pro trabalho que ninguém tinha planejado. Não escrevo direto — eu staging, o PM aprova."*
- **Builder (committer)** — *"Eu commito normal. Se eu quiser cravar a task, ponho `Task: PROJ-012` no rodapé do commit e a ligação fica determinística. Se eu esquecer, a Vitoria infere."* `[user]`

## 5. Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| **D1** | **Modelo do board = reconcile + auto-create.** Vitoria casa commit→task existente quando há fit (avança/fecha), e cria task as-built quando não há `[user]`. | Cobre "planejamos" e "só aconteceu"; é a mesma forma do loop de tradução semanal já speced (`docs/runbooks/vitoria-weekly-planning-runbook.md`), com git como SSOT em vez de Linear/Trello. |
| **D2** | **Commit→task = inferência LLM + trailer quando presente.** Trailer canônico `Task: <Task.reference>` (ex. `Task: PROJ-012`) é link determinístico (hard link); na ausência, Vitoria infere por mensagem+diff `[user]`. | Funciona com zero disciplina e fica preciso quando o time opta. `Task.reference` é auto-gerado por projeto via `next_task_reference()` `[code: database.types.ts:7210]`. |
| **D3** | **Autoridade de escrita = propose→PM aprova.** Vitoria cria `MeetingTaskAction` (create/update/move) em estado `pending`; PM aprova em lote `[user]`. | Reusa 100% a máquina existente de staging/aprovação/aplicação `[code: src/lib/meetings/task-action-executor.ts]`. Interpretação automatizada, escrita com gate humano. |
| **D4** | **Acesso = PM-only via `is_manager()`** (access_level `manager` = pm/head-ops/ceo); app gated `minAccessLevel: "manager"`. | É o eixo de acesso da plataforma, não `position` `[memory: feedback_headcount_by_position]`. Atende "só o PM" sem excluir head-ops que faz PM. App registry suporta `minAccessLevel` `[code: src/lib/apps/registry.ts:43]`. |
| **D5** | **Ingestão via Composio GitHub toolkit, executando como o PM que conectou** (`connectedById`); Octokit de `github.ts` continua stub. | OAuth per-user é o caminho de auth estabelecido `[code: adapters/github.ts:78]`; sem token estático. **[inference]** slug exato do tool de commits (`GITHUB_LIST_COMMITS` ou equivalente) a confirmar no catálogo Composio no Rito 1 — hoje só temos README/PR/issue/list-repos/list-branches/search-code wired `[code: grep GITHUB_ em src/]`. |
| **D6** | **`RepoCommit` é tabela própria (ledger determinístico), separada da interpretação da IA.** Commits **não** entram como `ContextSource`. | Commits são linhas estruturadas (sha, autor, ts), não blobs de texto. ContextSource é pra documentos/transcripts `[code: database.types.ts:8737]`. Separa ingest determinístico de interpretação LLM. |
| **D7** | **Vitoria interpreta via novo surface `commit_sync` (4º surface)**, dispatched por `thread.channel`, como chat turn (`ForgeJob.kind="chat"`). | Surfaces da Vitoria são selecionados por channel no prepare-turn `[code: src/app/api/agents/[slug]/prepare-turn/route.ts:172]`; daemon já claima `kind="chat"` `[code: src/lib/forge/dal/job.ts:58]`. Reusa sse-chat-proxy + prepare-turn. |
| **D8** | **Propostas hospedadas por `RepoSyncRun`** (nova coluna host `repoSyncRunId` em `MeetingTaskAction`); aplicadas via `applyPendingActionsForSyncRun()` espelhando o executor de planning. | `MeetingTaskAction` hoje é `meetingId` XOR `planningCeremonyId`; adicionar 3º host é extensão mínima `[code: task-action-executor.ts]`. |
| **D9** | **`synced` = `ProjectRepoSync.status`**, significando "o board reflete o repo até `lastSyncedSha`". É gate de confiança pra rituais downstream (PM Review). | É o status que o João cravou como importante `[user]`: o projeto "se alimenta de si mesmo" só vale se o espelho está fresco. |
| **D10** | **Cadência = pg_cron sync incremental** (desde `lastSyncedSha`); push webhook real-time é Fase 4. | Mesmo padrão do loop de planning semanal `[memory: project_vitoria_weekly_planning]`; precedente de migration pg_cron já existe (`20260615_sprint_outcome_digest.sql`). |
| **D11** | **1 projeto : 1 repo** (reusa `Project.githubRepoOwner/Name/DefaultBranch` `[code: database.types.ts:6052]` + `ProjectRepoSync` UNIQUE `projectId`). | Simplicidade do MVP; multi-repo deferido. |
| **D12** | **Fase 1 entrega valor determinístico sem IA** (ledger + status + linking por trailer). | Garante Fase 1 ≥ sistema atual (hoje: zero visibilidade de commit). IA entra na Fase 2 sem mudar contrato. |

## 6. Arquitetura

```
┌─────────────────────────── PROJETO (Apps tab) ───────────────────────────┐
│  App "github" (minAccessLevel: manager)                                    │
│   ├─ Connect repo (picker reusa GET /repos)  ──► ProjectRepoSync (1:1)     │
│   ├─ Sync status badge  ◄── ProjectRepoSync.status / lastSyncedAt          │
│   └─ Commit list  ◄── RepoCommit (com task linkada + linkSource)           │
└───────────────────────────────────┬────────────────────────────────────-─┘
                                     │
        ┌────────────────────────────▼─────────────────────────────┐
        │  INGEST (determinístico, server-side, como connectedById) │
        │  ingestCommits():                                          │
        │   Composio GITHUB_LIST_COMMITS (since lastSyncedSha)       │
        │   → upsert RepoCommit (UNIQUE projectId+sha)               │
        │   → parse trailer `Task: <ref>` → RepoCommit.taskId        │
        │     (linkSource='trailer')                                 │
        │   → ProjectRepoSync.status='synced', lastSyncedSha=HEAD    │
        └────────────────────────────┬─────────────────────────────-┘
                                     │ pg_cron (incremental) → enfileira ForgeJob(kind=chat)
        ┌────────────────────────────▼─────────────────────────────┐
        │  INTERPRET (Vitoria, surface=commit_sync, via daemon)      │
        │  prepare-turn: commits novos/unlinked + tasks abertas      │
        │  → reconcilia (avança/fecha matched)                       │
        │  → auto-create (unmatched)                                 │
        │  → propose_task_action() → MeetingTaskAction(repoSyncRunId)│
        └────────────────────────────┬─────────────────────────────-┘
                                     │ PM revisa no chat do app
        ┌────────────────────────────▼─────────────────────────────┐
        │  APPLY (gate humano)                                       │
        │  PM "Aprovar" → applyPendingActionsForSyncRun()            │
        │   → applyActions() (create/update/move) [reusa executor]   │
        │   → AgentProposalOutcome (telemetria)                      │
        └─────────────────────────────────────────────────────────-─┘
```

Cada caixa mapeia pra função/endpoint real: ingest = `src/lib/repo-sync/ingest.ts`; interpret = surface `commit_sync` em `src/lib/agent/agents/vitoria/`; apply = `applyPendingActionsForSyncRun` em `src/lib/meetings/task-action-executor.ts`.

## 7. Schema (migrations atômicas — 1 por arquivo)

> RLS: `can_view_project()`/`is_manager()` são helpers existentes `[code: 20260423_member_roles_access.sql]`.

**7.1 — `20260618_commit_sync_enums.sql`**
```sql
CREATE TYPE public.repo_sync_status AS ENUM ('disconnected','connected','syncing','synced','error');
CREATE TYPE public.commit_link_source AS ENUM ('none','trailer','inferred');
CREATE TYPE public.repo_sync_run_status AS ENUM ('running','proposed','applied','failed');
```

**7.2 — `20260618a_repo_commit.sql`**
```sql
CREATE TABLE public."RepoCommit" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"  uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  sha          text NOT NULL,
  message      text NOT NULL,
  "authorLogin" text,
  "authorName"  text,
  "authorEmail" text,
  "authoredAt"  timestamptz,
  "committedAt" timestamptz NOT NULL,
  additions    int,
  deletions    int,
  "changedFiles" int,
  url          text,
  "taskId"     uuid REFERENCES public."Task"(id) ON DELETE SET NULL,
  "linkSource" public.commit_link_source NOT NULL DEFAULT 'none',
  "ingestedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("projectId", sha)
);
CREATE INDEX "RepoCommit_project_committed_idx" ON public."RepoCommit"("projectId","committedAt" DESC);
CREATE INDEX "RepoCommit_task_idx" ON public."RepoCommit"("taskId") WHERE "taskId" IS NOT NULL;
ALTER TABLE public."RepoCommit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "RepoCommit_select" ON public."RepoCommit" FOR SELECT TO authenticated USING (public.can_view_project("projectId"));
CREATE POLICY "RepoCommit_write" ON public."RepoCommit" FOR ALL TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
-- ingest roda server-side (service_role bypassa RLS)
```

**7.3 — `20260618b_project_repo_sync.sql`**
```sql
CREATE TABLE public."ProjectRepoSync" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"   uuid NOT NULL UNIQUE REFERENCES public."Project"(id) ON DELETE CASCADE,
  "repoOwner"   text NOT NULL,
  "repoName"    text NOT NULL,
  branch        text NOT NULL DEFAULT 'main',
  status        public.repo_sync_status NOT NULL DEFAULT 'connected',
  "lastSyncedSha" text,
  "lastSyncedAt"  timestamptz,
  "lastError"     text,
  "connectedById" uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."ProjectRepoSync" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ProjectRepoSync_select" ON public."ProjectRepoSync" FOR SELECT TO authenticated USING (public.can_view_project("projectId"));
CREATE POLICY "ProjectRepoSync_write" ON public."ProjectRepoSync" FOR ALL TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
```

**7.4 — `20260618c_repo_sync_run.sql`**
```sql
CREATE TABLE public."RepoSyncRun" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"  uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  "repoSyncId" uuid NOT NULL REFERENCES public."ProjectRepoSync"(id) ON DELETE CASCADE,
  "fromSha"    text,
  "toSha"      text,
  "commitCount" int NOT NULL DEFAULT 0,
  status       public.repo_sync_run_status NOT NULL DEFAULT 'running',
  "chatTurnId" uuid,
  "startedAt"  timestamptz NOT NULL DEFAULT now(),
  "finishedAt" timestamptz
);
CREATE INDEX "RepoSyncRun_project_idx" ON public."RepoSyncRun"("projectId","startedAt" DESC);
ALTER TABLE public."RepoSyncRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "RepoSyncRun_select" ON public."RepoSyncRun" FOR SELECT TO authenticated USING (public.can_view_project("projectId"));
CREATE POLICY "RepoSyncRun_write" ON public."RepoSyncRun" FOR ALL TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
```

**7.5 — `20260618d_meeting_task_action_repo_host.sql`**
```sql
ALTER TABLE public."MeetingTaskAction" ADD COLUMN "repoSyncRunId" uuid REFERENCES public."RepoSyncRun"(id) ON DELETE CASCADE;
-- relaxa o CHECK de host (meetingId XOR planningCeremonyId) p/ aceitar exatamente 1 de {meetingId, planningCeremonyId, repoSyncRunId}
-- (drop + recreate do constraint existente — nome exato a confirmar no Rito 1)
```

**7.6 — `20260618e_commit_sync_cron.sql`** — pg_cron incremental (precedente: `20260615_sprint_outcome_digest.sql`). Job chama function que enfileira ingest+interpret por projeto com `ProjectRepoSync.status` ativo.

## 8. APIs

| Método | Path | Contrato |
|--------|------|----------|
| `POST` | `/api/projects/[id]/repo-sync/connect` | body `{repoOwner, repoName, branch}` → cria `ProjectRepoSync`, dispara backfill async → `202 {syncRunId}`. Gate `is_manager()`. |
| `POST` | `/api/projects/[id]/repo-sync/sync` | dispara sync incremental async → `202 {syncRunId}`. Gate `is_manager()`. |
| `GET`  | `/api/projects/[id]/repo-sync` | `{status, lastSyncedSha, lastSyncedAt, repoOwner, repoName, branch, commitCount}`. |
| `GET`  | `/api/projects/[id]/repo-commits?cursor=` | lista paginada `RepoCommit` + task linkada + `linkSource`. |
| `GET`  | `/api/integrations/composio/github/repos` | **(existe)** picker de repos `[code: .../github/repos/route.ts]`. |
| `POST` | `/api/repo-sync-runs/[id]/approve` | aprova proposals do run → `applyPendingActionsForSyncRun()` → `200 {applied, failed}`. Gate `is_manager()`. |

Interpretação da Vitoria roda como chat turn no thread `channel="commit_sync"` (não é endpoint REST novo — reusa `streamViaClaudeDaemon` `[code: src/lib/agent/sse-chat-proxy.ts:24]`).

## 9. UX (surface do app)

```
┌─ Apps ▸ GitHub ───────────────────────────────────────────────┐
│  acme/web · main                          ● synced · há 4 min  │
│  [ Sincronizar agora ]                                         │
│ ─────────────────────────────────────────────────────────────│
│  Commits (desde último sync: 12)                               │
│  ┌───────────────────────────────────────────────────────────┐│
│  │ a1b2c3 · feat: checkout flow      @joao   2h   → PROJ-012 ⛓ ││  ⛓ = trailer
│  │ d4e5f6 · fix: race no carrinho    @ana    3h   → PROJ-012 ~ ││  ~ = inferido
│  │ 7a8b9c · chore: bump deps         @joao    5h   → (nenhuma)  ││
│  └───────────────────────────────────────────────────────────┘│
│ ─────────────────────────────────────────────────────────────│
│  Vitoria propôs (3) — revisar no chat        [ Aprovar tudo ]  │
│   • criar "Carrinho: tratar concorrência"  (de d4e5f6)         │
│   • avançar PROJ-012 → review               (de a1b2c3)        │
└────────────────────────────────────────────────────────────────┘
```

Chat da Vitoria reusa a UI de agente compartilhada `[memory: feedback_agent_ui_parity]`.

## 10. Integrações

- **PM Review** — `synced` vira gate: a Vitoria do PM Review pode declarar "board reflete o repo até <sha>". Commit ledger alimenta indicadores `get_project_indicators`.
- **Sprint metrics** — `RepoCommit` por sprint (via `committedAt` ∈ janela) alimenta métricas de entrega futuras (Metrics Registry).
- **Webhook PR existente** — continua intacto (merge→done) `[code: webhooks/github/route.ts:58]`; commit sync é ortogonal.
- **Forge** — não toca; Forge escreve no repo, commit-sync lê. Sem conflito de fluxo `[memory: project_forge_vs_zordon_workflow]`.

## 11. Faseamento

- **Fase 1 — Ledger + connect + status (determinístico, sem IA).** Connect (PM-only), backfill commits→`RepoCommit`, badge de status, lista de commits, linking por trailer `Task: <ref>`, pg_cron incremental. **Entrega mais que hoje** (hoje: zero visibilidade). [D12]
- **Fase 2 — Vitoria interpreta + propose/approve.** Surface `commit_sync`, reconcile+auto-create via `MeetingTaskAction`, "Aprovar tudo".
- **Fase 3 — Cadência fechada + confiança.** pg_cron enfileira o passe da Vitoria após cada ingest; `synced` gate no PM Review; planning section mostra "proposto de commits".
- **Fase 4 — Real-time + hardening.** Estende webhook p/ `push`, dedup, eval cases do surface, telemetria via `AgentProposalOutcome`.

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| LLM atribui commit→task errado | Média | Média | Trailer override [D2] + gate propose→approve [D3] + `aiConfidence` exibido. |
| Slug do tool de commits Composio / rate limit | Média | Média | Confirmar slug no Rito 1 [D5]; sync incremental desde `lastSyncedSha`; backoff. |
| Volume de commits inunda propostas | Média | Média | Batch por `RepoSyncRun`, dedup por sha (UNIQUE), agrupar commits por task. |
| `synced` engana se sync travou | Baixa | Alto | `lastSyncedAt` visível + badge de staleness; status `error` explícito. |
| Relaxar CHECK de host quebra apply de planning | Baixa | Alto | Migration atômica [7.5] + teste do executor antes de aplicar. |
| PM que conectou sai da empresa → OAuth morre | Baixa | Média | Status `error` + fluxo de reconectar; `connectedById` rastreável. |

## 13. Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| % commits linkados a uma task | `SELECT count(*) FILTER (WHERE "taskId" IS NOT NULL)::float/NULLIF(count(*),0) FROM "RepoCommit" WHERE "projectId"=$1` |
| Taxa de aprovação de proposta | `AgentProposalOutcome` accepted/edited/rejected por `repoSyncRunId` |
| Frescor do sync | `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY now()-"lastSyncedAt") FROM "ProjectRepoSync" WHERE status='synced'` |
| Tasks auto-criadas vs manuais | `SELECT count(*) FILTER (WHERE "createdByAgent") , count(*) FROM "Task" WHERE "projectId"=$1` |
| Edição manual de task pelo PM (proxy do esforço) | contagem de `PUT /api/tasks/[id]` por managers (evento/log) |

## 14. Open questions

- **[Fase 2]** Slug exato do tool Composio de commits (`GITHUB_LIST_COMMITS`?) — confirmar no Rito 1 [D5]. Não-bloqueante p/ Fase 1 modelar schema.
- **[Fase 4]** Push webhook precisa de secret per-repo ou reusa `GITHUB_WEBHOOK_SECRET` global `[code: grep GITHUB_WEBHOOK_SECRET]`? Resolver na Fase 4.

## 15. Referências

- App registry: `src/lib/apps/registry.ts:24` · Apps tab: `src/app/(dashboard)/projects/[id]/_tabs/apps-tab.tsx`
- GitHub adapter (Composio): `src/lib/context-sources/adapters/github.ts:56` · github.ts stub: `src/lib/github.ts:1`
- Webhook PR: `src/app/api/webhooks/github/route.ts` · Task schema: `database.types.ts:7204`
- Vitoria surfaces / prepare-turn: `src/app/api/agents/[slug]/prepare-turn/route.ts:172` · `src/lib/agent/agents/vitoria/index.ts`
- Proposal executor: `src/lib/meetings/task-action-executor.ts` · ForgeJob/daemon: `src/lib/forge/dal/job.ts:55`
- Padrão irmão: `docs/runbooks/vitoria-weekly-planning-runbook.md` · Memories: `project_vitoria_weekly_planning`, `project_zordon_apps`, `project_vitoria_daemon_surfaces`

## 16. Stories implementáveis

```yaml
- id: COMMIT-001
  title: Migration de enums (repo_sync_status, commit_link_source, repo_sync_run_status)
  description: Cria os 3 enums em supabase/migrations/20260618_commit_sync_enums.sql e roda via psql.
  acceptanceCriteria:
    - "Os 3 tipos enum existem no schema public"
  verifiable:
    - kind: sql
      command_or_query: "SELECT typname FROM pg_type WHERE typname IN ('repo_sync_status','commit_link_source','repo_sync_run_status')"
      expected: "3 linhas"
  dependsOn: []
  estimateMinutes: 15
  touches: [supabase/migrations/20260618_commit_sync_enums.sql]

- id: COMMIT-002
  title: Migration tabela RepoCommit (DDL + RLS + UNIQUE projectId,sha)
  description: Cria RepoCommit com índices e policies select(can_view_project)/write(is_manager).
  acceptanceCriteria:
    - "Tabela RepoCommit existe com UNIQUE(projectId,sha) e RLS habilitado"
  verifiable:
    - kind: sql
      command_or_query: "SELECT relrowsecurity FROM pg_class WHERE relname='RepoCommit'"
      expected: "t"
  dependsOn: [COMMIT-001]
  estimateMinutes: 25
  touches: [supabase/migrations/20260618a_repo_commit.sql]

- id: COMMIT-003
  title: Migration tabela ProjectRepoSync (1:1 projectId + status + RLS)
  description: Cria ProjectRepoSync com UNIQUE projectId, status default 'connected', policies.
  acceptanceCriteria:
    - "Tabela ProjectRepoSync existe com UNIQUE(projectId)"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_constraint WHERE conrelid='public.\"ProjectRepoSync\"'::regclass AND contype='u'"
      expected: ">=1"
  dependsOn: [COMMIT-001]
  estimateMinutes: 20
  touches: [supabase/migrations/20260618b_project_repo_sync.sql]

- id: COMMIT-004
  title: Migration tabela RepoSyncRun + host em MeetingTaskAction
  description: Cria RepoSyncRun e adiciona MeetingTaskAction.repoSyncRunId, relaxando o CHECK de host p/ exatamente 1 de {meetingId,planningCeremonyId,repoSyncRunId}.
  acceptanceCriteria:
    - "RepoSyncRun existe; MeetingTaskAction tem coluna repoSyncRunId"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.columns WHERE table_name='MeetingTaskAction' AND column_name='repoSyncRunId'"
      expected: "1"
  dependsOn: [COMMIT-003]
  estimateMinutes: 30
  touches: [supabase/migrations/20260618c_repo_sync_run.sql, supabase/migrations/20260618d_meeting_task_action_repo_host.sql]

- id: COMMIT-005
  title: Regenerar database.types.ts
  description: Atualiza src/lib/supabase/database.types.ts refletindo RepoCommit, ProjectRepoSync, RepoSyncRun e a coluna nova.
  acceptanceCriteria:
    - "database.types.ts contém RepoCommit, ProjectRepoSync, RepoSyncRun"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'RepoCommit\\|ProjectRepoSync\\|RepoSyncRun' src/lib/supabase/database.types.ts"
      expected: ">=3"
  dependsOn: [COMMIT-002, COMMIT-003, COMMIT-004]
  estimateMinutes: 15
  touches: [src/lib/supabase/database.types.ts]

- id: COMMIT-006
  title: Parser de trailer Task -> ref (lib pura + teste)
  description: Função parseTaskTrailer(message) que extrai 'Task: <ref>' (case-insensitive, multi-line) e retorna o ref ou null.
  acceptanceCriteria:
    - "parseTaskTrailer('feat\\n\\nTask: PROJ-012') === 'PROJ-012'"
    - "parseTaskTrailer('feat sem trailer') === null"
  verifiable:
    - kind: typecheck
      command_or_query: "npx vitest run src/lib/repo-sync/trailer.test.ts"
      expected: "tests pass"
  dependsOn: []
  estimateMinutes: 20
  touches: [src/lib/repo-sync/trailer.ts, src/lib/repo-sync/trailer.test.ts]

- id: COMMIT-007
  title: Lib de ingestão de commits (Composio, incremental, linking por trailer)
  description: ingestCommits(projectId) busca commits via Composio como connectedById desde lastSyncedSha, faz upsert em RepoCommit (UNIQUE projectId,sha), aplica parseTaskTrailer p/ setar taskId+linkSource='trailer', atualiza ProjectRepoSync.status/lastSyncedSha/lastSyncedAt.
  acceptanceCriteria:
    - "Re-rodar ingest não duplica commits (idempotente via UNIQUE)"
    - "Commit com trailer fica com linkSource='trailer' e taskId resolvido pelo reference"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json"
      expected: "sem erros em src/lib/repo-sync/"
  dependsOn: [COMMIT-005, COMMIT-006]
  estimateMinutes: 30
  touches: [src/lib/repo-sync/ingest.ts]

- id: COMMIT-008
  title: API routes connect/sync/status/commits
  description: POST connect (202 syncRunId), POST sync (202), GET repo-sync (status), GET repo-commits (paginado). Todas gated is_manager().
  acceptanceCriteria:
    - "GET /api/projects/[id]/repo-sync retorna status quando conectado"
    - "POST connect/sync retornam 202 e disparam ingest async"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json"
      expected: "sem erros nos novos routes"
  dependsOn: [COMMIT-007]
  estimateMinutes: 30
  touches: [src/app/api/projects/[id]/repo-sync/connect/route.ts, src/app/api/projects/[id]/repo-sync/sync/route.ts, src/app/api/projects/[id]/repo-sync/route.ts, src/app/api/projects/[id]/repo-commits/route.ts]

- id: COMMIT-009
  title: Registrar app "github" no registry (minAccessLevel manager)
  description: Adiciona entry github no APP_REGISTRY (icon GitBranch, produces vazio/artifacts, status installed, minAccessLevel manager) + case no switch do apps-tab.
  acceptanceCriteria:
    - "App 'github' aparece no dock só p/ manager+"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'key: \"github\"' src/lib/apps/registry.ts"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: [src/lib/apps/registry.ts, src/app/(dashboard)/projects/[id]/_tabs/apps-tab.tsx]

- id: COMMIT-010
  title: Surface UI do app (connect picker + status badge + lista de commits)
  description: Componente que usa GET /repos p/ picker, mostra ProjectRepoSync.status como badge, lista RepoCommit com task linkada e ícone de linkSource.
  acceptanceCriteria:
    - "Sem repo conectado: mostra picker; conectado: mostra badge + lista"
  verifiable:
    - kind: lint
      command_or_query: "npx eslint src/components/apps/github-app-view.tsx"
      expected: "0 errors"
  dependsOn: [COMMIT-008, COMMIT-009]
  estimateMinutes: 30
  touches: [src/components/apps/github-app-view.tsx]

- id: COMMIT-011
  title: pg_cron de sync incremental
  description: Migration que agenda function chamando ingest por projeto com ProjectRepoSync.status ativo (precedente sprint_outcome_digest).
  acceptanceCriteria:
    - "Existe job cron 'commit_sync_incremental' em cron.job"
  verifiable:
    - kind: sql
      command_or_query: "SELECT jobname FROM cron.job WHERE jobname='commit_sync_incremental'"
      expected: "1 linha"
  dependsOn: [COMMIT-007]
  estimateMinutes: 25
  touches: [supabase/migrations/20260618e_commit_sync_cron.sql]

- id: COMMIT-012
  title: Surface commit_sync da Vitoria (context loader + prompt + toolset)
  description: Adiciona branch surface 'commit_sync' em vitoria/index.ts (loadContext lê commits novos/unlinked + tasks abertas; buildPrompt instrui reconcile+auto-create; buildTools = SHARED_READ + read_repo_commits + propose_task_action sobre repoSyncRunId).
  acceptanceCriteria:
    - "loadContext/buildPrompt/buildTools tratam surface 'commit_sync'"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json"
      expected: "sem erros em src/lib/agent/agents/vitoria/"
  dependsOn: [COMMIT-007]
  estimateMinutes: 30
  touches: [src/lib/agent/agents/vitoria/index.ts, src/lib/agent/agents/vitoria/commit-sync.ts]

- id: COMMIT-013
  title: Dispatch de surface no prepare-turn + mirror de tool no daemon
  description: prepare-turn resolve channel='commit_sync' -> params {surface, repoSyncRunId}; daemon tools-registry mapeia tool names do surface; schema do read_repo_commits espelhado no daemon (sem execute).
  acceptanceCriteria:
    - "thread.channel='commit_sync' resolve surface commit_sync no prepare-turn"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'commit_sync' src/app/api/agents/[slug]/prepare-turn/route.ts"
      expected: ">=1"
  dependsOn: [COMMIT-012]
  estimateMinutes: 30
  touches: [src/app/api/agents/[slug]/prepare-turn/route.ts]

- id: COMMIT-014
  title: applyPendingActionsForSyncRun + endpoint de aprovação
  description: Espelha applyPendingActionsForPlanning p/ host repoSyncRunId, reusando applyActions(); POST /api/repo-sync-runs/[id]/approve gated is_manager() aprova+aplica e grava AgentProposalOutcome.
  acceptanceCriteria:
    - "Aprovar run com proposals pending aplica create/update e marca execution='applied'"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json"
      expected: "sem erros em task-action-executor e no route"
  dependsOn: [COMMIT-004, COMMIT-012]
  estimateMinutes: 30
  touches: [src/lib/meetings/task-action-executor.ts, src/app/api/repo-sync-runs/[id]/approve/route.ts]

- id: COMMIT-015
  title: Documentar convenção de trailer Task em AGENTS.md + runbook
  description: Adiciona seção curta sobre 'Task: <ref>' trailer e runbook docs/runbooks/commit-sync-runbook.md.
  acceptanceCriteria:
    - "Runbook existe e AGENTS.md menciona o trailer Task:"
  verifiable:
    - kind: lint
      command_or_query: "test -f docs/runbooks/commit-sync-runbook.md && grep -c 'Task:' docs/runbooks/commit-sync-runbook.md"
      expected: ">=1"
  dependsOn: []
  estimateMinutes: 15
  touches: [docs/runbooks/commit-sync-runbook.md, AGENTS.md]
```
