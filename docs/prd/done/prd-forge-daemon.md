# PRD — Forge Daemon (CLI ↔ Zordon broker)

> **Contexto:** Zordon web app é control plane (PM clica botão); execução Claude precisa rodar **local** no PC do PM (OAuth Claude é per-pessoa). Falta a ponte: um daemon CLI que escuta jobs do Zordon e os executa local, streamando eventos de volta. Sem isso, PM precisa rodar `forge run` manualmente no terminal toda vez.

## 1 · Problema

1. **Claude OAuth é per-PM.** `~/.claude/` no laptop do João só serve pro João. Pedro precisa rodar Claude no PC dele. Não há "Forge na cloud" possível.
2. **Hoje exige interação manual.** PM clica "Run autorun" na UI → Next.js API spawna `exec-prd.ts` na MESMA máquina onde Next roda. Se Next está num PC e PM está em outro, não funciona.
3. **Always-on PC sem broker.** PC dedicado fica ocioso porque não há mecanismo pra ele "pegar" jobs disparados de qualquer lugar.

Solução pedida (do João): CLI roda no PC, conecta no Zordon, pega job da fila, executa Claude local, stream pra Supabase.

## 2 · Solução em uma frase

Adicionar comando `forge daemon` ao CLI que, autenticado por OAuth Supabase do PM, faz subscribe realtime na tabela `ForgeJob` (filtrada por escopo do PM), claima jobs com `FOR UPDATE SKIP LOCKED`, executa via orchestrator local, e stream eventos pra Supabase em tempo real.

## 3 · Não-objetivos

- Não muda UI nem flow de criação de PRD/job.
- Não roda múltiplos jobs em paralelo na mesma daemon (1 job at a time per daemon instance).
- Não suporta resumo automático de job interrompido (V2; falha → manual restart).
- Não implementa balanceamento entre múltiplas daemons (FOR UPDATE SKIP LOCKED já dá round-robin natural).
- Não inclui rate limit (V2).
- Não substitui `exec-prd.ts` — daemon usa por baixo.

## 4 · Personas e jornada

- **PM Pedro**: chega no escritório, abre terminal, `forge daemon` no laptop dele. Volta pro browser, clica "Run autorun" em `/projects/[id]/forge`. Em 2s ele vê output no terminal "Picking up job j_abc..." e no browser começa a chegar realtime de progresso. Não precisa pensar em onde está rodando.
- **Always-on PC**: roda `forge daemon` 24/7 como systemd service. Logado como `forge-bot@volund.com.br`. Pega jobs que ninguém mais pegou (low priority queue).
- **João**: pode rodar daemon ou não. Quando ele clica "Run" e ninguém tem daemon ativo, Zordon mostra "Sem builder ativo — abra forge daemon em algum PC".

## 5 · Decisões fixadas

| ID | Decisão | Por quê |
|---|---|---|
| D1 | Nova tabela `ForgeJob` (separada de ForgeRun) | Job é intenção, Run é execução. 1 Job → 0..1 Run (Run criada quando daemon claima). |
| D2 | Status do job: `queued` → `claimed` → `running` → `done` \| `failed` \| `cancelled` | Estados explícitos. cancelled = PM aborta antes de claim. |
| D3 | Claim atômico com `UPDATE ForgeJob SET status='claimed', claimedBy=$daemon WHERE status='queued' RETURNING *` em loop com `FOR UPDATE SKIP LOCKED` | Padrão clássico postgres queue. Sem broker externo. |
| D4 | Daemon subscribe Supabase realtime no INSERT/UPDATE de ForgeJob | Reduz polling; só polla a cada 30s como fallback. |
| D5 | Daemon roda 1 job por vez. Concurrency = N daemons rodando | KISS. PM pode rodar 2 daemons em PCs diferentes = 2 jobs paralelos. |
| D6 | Heartbeat: daemon faz UPDATE em `ForgeJob.heartbeatAt` a cada 30s | Detecção de daemon morto. Se heartbeat > 5min sem update, job volta pra queued (orphan recovery). |
| D7 | Daemon identifica-se com `daemonId` (uuid gerado uma vez, persistido em `~/.forge/daemon.json`) | Estabilidade entre restarts. |
| D8 | Auth do daemon ↔ Zordon: OAuth Supabase do PM (mesma session do browser, via supabase-cli auth flow OU magic link no terminal) | Identidade clara; RLS aplicado. |
| D9 | Filtro de jobs por daemon: pega só jobs onde `ownerId IN (member do daemon)` OU `assignToAnyone=true` | PM Pedro não pega job do Pedro automaticamente. Always-on tem assignToAnyone flag. |
| D10 | Daemon expõe `forge daemon stop` (graceful) e `forge daemon ps` (status local) | Operacionalidade. |

## 6 · Arquitetura

```
ZORDON (web)                               PC LOCAL (PM)
─────────────────                          ─────────────────

PM clica "Run autorun" em                  $ forge daemon
/projects/[id]/forge                       → autentica via OAuth Supabase
        │                                  → daemonId = read ~/.forge/daemon.json
        ▼                                  → subscribe ForgeJob realtime
POST /api/forge/jobs                       → idle, esperando...
  body: { prdSlug, projectId }
        │
        ▼
INSERT ForgeJob (status=queued)            ← realtime notification chega!
        │
        ▼                                  → claim job: UPDATE ForgeJob SET
realtime broadcast                            status='claimed', claimedBy=daemonId
        │                                     WHERE id=X AND status='queued'
        ▼                                     RETURNING *
   (daemon recebe)                          → se UPDATE retornou 0 rows: outro daemon pegou; skip
                                            → se sucesso: status='running'
                                            → start heartbeat (every 30s)
                                            → spawn orchestrator local
                                                 → cria ForgeRun
                                                 → ensureWorkspace (se projectId)
                                                 → spawn exec-prd.ts
                                                 → events streamados pra Supabase
                                            → quando exec-prd termina:
                                                 status='done' (ou failed)
                                                 stop heartbeat
                                            → volta pra idle
```

## 7 · Schema

```sql
-- supabase/migrations/20260601d_forge_job.sql
CREATE TABLE "ForgeJob" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "prdSlug"       text NOT NULL,
  "projectId"     uuid REFERENCES "Project"(id) ON DELETE SET NULL,
  "ownerId"       uuid NOT NULL REFERENCES "Member"(id) ON DELETE RESTRICT,
  status          text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','claimed','running','done','failed','cancelled')),
  "claimedBy"     uuid,                          -- daemonId que pegou
  "claimedAt"     timestamptz,
  "heartbeatAt"   timestamptz,
  "runId"         uuid REFERENCES "ForgeRun"(id) ON DELETE SET NULL,
  "assignToAnyone" boolean NOT NULL DEFAULT false,
  "maxStories"    integer DEFAULT 20,
  meta            jsonb NOT NULL DEFAULT '{}',
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_forgejob_queue ON "ForgeJob" (status, "createdAt")
  WHERE status IN ('queued','claimed','running');
CREATE INDEX ix_forgejob_owner ON "ForgeJob" ("ownerId", "createdAt" DESC);
CREATE INDEX ix_forgejob_heartbeat ON "ForgeJob" ("heartbeatAt") WHERE status = 'running';

-- RLS
ALTER TABLE "ForgeJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_select" ON "ForgeJob" FOR SELECT USING (
  is_admin() OR
  ownerId = (SELECT id FROM "Member" WHERE userId = auth.uid()) OR
  "assignToAnyone" = true
);
CREATE POLICY "job_insert" ON "ForgeJob" FOR INSERT WITH CHECK (
  is_manager() OR is_admin()
);
CREATE POLICY "job_update" ON "ForgeJob" FOR UPDATE USING (
  is_admin() OR
  "claimedBy" IS NULL OR
  "claimedBy" = current_setting('app.daemon_id', true)::uuid
);
```

```sql
-- supabase/migrations/20260601e_forge_job_orphan_recovery.sql
-- Função reset jobs com heartbeat stale (> 5min)
CREATE OR REPLACE FUNCTION forge_recover_orphan_jobs() RETURNS integer AS $$
DECLARE recovered integer;
BEGIN
  UPDATE "ForgeJob"
  SET status = 'queued', "claimedBy" = NULL, "claimedAt" = NULL, "heartbeatAt" = NULL
  WHERE status IN ('claimed','running')
    AND "heartbeatAt" < now() - interval '5 minutes';
  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END $$ LANGUAGE plpgsql;

-- pg_cron diariamente
SELECT cron.schedule('forge_orphan_recovery', '*/2 * * * *', $$
  SELECT forge_recover_orphan_jobs();
$$);
```

## 8 · APIs

```ts
// POST /api/forge/jobs (substitui POST /api/forge/autoruns no caminho daemon)
// body: { prdSlug, projectId, maxStories?, assignToAnyone? }
// response: 202 + { jobId }

// GET /api/forge/jobs?status=queued&ownerId=...
// PATCH /api/forge/jobs/[id]  body: { status: 'cancelled' }  (só queued/claimed)
// GET /api/forge/jobs/[id]/stream  (SSE com events do ForgeRun associado)
```

CLI:
```bash
forge daemon                       # roda em foreground (default)
forge daemon --daemon              # background com nohup-like
forge daemon stop                  # kill graceful
forge daemon ps                    # status local: idle | running <jobId>
forge daemon logs                  # tail ~/.forge/daemon.log
forge daemon auth                  # re-auth Supabase OAuth
```

## 9 · UX

Na UI do Zordon:
```
/projects/[id]/forge

▶ Builders ativos: 2  (Pedro@MacBook, forge-bot@always-on)
[ Run autorun ]
```

Quando 0 builders:
```
⚠ Nenhum builder ativo
   Abra `forge daemon` em algum PC pra dispatchar jobs.
   [ Mais info ]
```

Output do `forge daemon` no terminal:
```
$ forge daemon
✓ Authenticated as pedro@volund.com.br
✓ daemonId: 7c8a... (loaded from ~/.forge/daemon.json)
✓ Subscribed to ForgeJob realtime
○ Idle, waiting for jobs...

[14:23:01] New job c8dc26d (prd-dashboard-mobile, Project: Acme Bank)
[14:23:01] Claimed (status: running)
[14:23:02] Cloning git@github.com:acme/api.git into .forge/c8dc26d/workspace...
[14:23:08] Spawning orchestrator (14 stories)
[14:23:09] FPT-001 running...
...
[15:42:33] Done. 14/14 stories passed. PR: https://github.com/acme/api/pull/142
[15:42:33] ○ Idle, waiting for jobs...
```

## 10 · Integrações

- **POST /api/forge/autoruns** existente: continua válido como fallback dogfood (local sem daemon). Quando daemon presente, UI prefere POST /api/forge/jobs.
- **ForgeRun**: criada pelo daemon quando claima job. `ForgeJob.runId` aponta pra ela.
- **Worker**: invocado pelo daemon via `exec-prd.ts` (sem mudanças no orchestrator).
- **Workspace** (depende de `prd-forge-runtime-target`): daemon chama ensureWorkspace.
- **UI `prd-forge-project-tab`**: mostra "Builders ativos" lendo daemons com heartbeat recente.

## 11 · Faseamento

| Fase | Entrega |
|---|---|
| 1 | Migration ForgeJob + RLS + orphan recovery cron |
| 2 | DAL para Job + endpoint POST /api/forge/jobs |
| 3 | CLI: `forge daemon` foreground (claim + execute + heartbeat) |
| 4 | CLI: stop / ps / logs / auth subcomandos |
| 5 | UI mostra builders ativos no project tab |

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Daemon crash mid-job → job órfão | M | M | D6: heartbeat + orphan recovery cron (2min) |
| Race condition no claim | L | A | D3: UPDATE WHERE status=queued é atômico |
| OAuth do daemon expira | M | M | Daemon refresh automático; on 401 → exit code distinto + msg pra reauth |
| Múltiplos daemons do mesmo PM | B | B | OK, ambos pegam jobs. Não previne. |
| Realtime Supabase cai → jobs param | M | A | D4: fallback polling a cada 30s |
| PM esquece daemon ligado → jobs ficam queued indefinido | A | B | UI mostra "0 builders" warning; orphan recovery não aplica (job não está claimed) |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| % jobs com `claimedAt - createdAt < 60s` (pickup rápido) | `SELECT count(*) FILTER (WHERE claimedAt - createdAt < interval '60s') / count(*) FROM ForgeJob WHERE status IN ('running','done')` | ≥ 90% |
| % jobs órfãos recuperados sem perda | events vs alerts | ≥ 99% |
| Daemons ativos (heartbeat < 2min) por hora | `SELECT count(DISTINCT claimedBy) FROM ForgeJob WHERE heartbeatAt > now() - interval '2 min'` | ≥ 1 durante horário comercial |
| Latência realtime: createdAt → daemon notification | tempo entre INSERT e log "New job" | p95 < 5s |

## 14 · Open questions

Nenhuma. Tudo decidido em §5.

## 15 · Referências

- Memory `project_forge_vs_zordon_workflow.md` — Workflow A vs B
- Memory `project_zordon_ops_pipeline.md` — pipeline canônico
- Memory `feedback_improve_and_learn_mission.md` — princípio operacional
- `scripts/forge/cli.ts` — CLI atual
- `src/app/api/forge/autoruns/route.ts` — endpoint atual (será complementado, não substituído)
- pg "FOR UPDATE SKIP LOCKED" — padrão postgres queue

## 16 · Stories implementáveis

```yaml
- id: FDM-001
  title: Migration ForgeJob + RLS + índices
  description: |
    Cria tabela ForgeJob com status state machine, RLS owner-based, índices
    pra queue (status+createdAt parcial) e heartbeat (status=running parcial).
  acceptanceCriteria:
    - "supabase/migrations/20260601d_forge_job.sql criado e aplicado"
    - "Tabela ForgeJob existe com todas colunas do §7"
    - "Policies job_select/insert/update existem"
    - "3 índices criados (queue, owner, heartbeat)"
    - "database.types.ts atualizado"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.tables WHERE table_name='ForgeJob'"
      expected: "1"
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='ForgeJob'"
      expected: "3"
  dependsOn: []
  estimateMinutes: 25
  touches:
    - supabase/migrations/20260601d_forge_job.sql
    - src/lib/supabase/database.types.ts
  agentProfile: db

- id: FDM-002
  title: Migration orphan recovery + pg_cron
  description: |
    Função forge_recover_orphan_jobs() + cron schedule '*/2 * * * *' que
    reseta jobs com heartbeatAt stale > 5min de claimed/running pra queued.
  acceptanceCriteria:
    - "supabase/migrations/20260601e_forge_job_orphan_recovery.sql criado e aplicado"
    - "Função forge_recover_orphan_jobs existe (pg_proc)"
    - "cron.job 'forge_orphan_recovery' agendado a cada 2min"
    - "Test manual: insere job claimed sem heartbeat → após cron, status=queued"
  verifiable:
    - kind: sql
      command_or_query: "SELECT jobname FROM cron.job WHERE jobname='forge_orphan_recovery'"
      expected: "forge_orphan_recovery"
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_proc WHERE proname='forge_recover_orphan_jobs'"
      expected: "1"
  dependsOn: [FDM-001]
  estimateMinutes: 15
  touches:
    - supabase/migrations/20260601e_forge_job_orphan_recovery.sql
  agentProfile: db

- id: FDM-003
  title: src/lib/forge/dal/job.ts — DAL completa
  description: |
    CRUD + claim atômico via UPDATE WHERE status='queued' RETURNING.
    Funções: createJob, claimNextJob, updateJobStatus, heartbeat, cancelJob,
    listJobsForOwner.
  acceptanceCriteria:
    - "src/lib/forge/dal/job.ts exporta funções acima"
    - "claimNextJob retorna null se ninguém disponível, ForgeJob se claimou"
    - "claim usa UPDATE WHERE status='queued' AND ... RETURNING (atômico)"
    - "heartbeat só faz UPDATE se status='running' E claimedBy=daemonId"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [FDM-001]
  estimateMinutes: 30
  touches:
    - src/lib/forge/dal/job.ts
  agentProfile: db

- id: FDM-004
  title: POST /api/forge/jobs + PATCH cancel
  description: |
    Endpoint POST cria job (status=queued). PATCH altera status pra cancelled
    (válido só de queued ou claimed). Validation Zod completo.
  acceptanceCriteria:
    - "src/app/api/forge/jobs/route.ts POST cria ForgeJob"
    - "src/app/api/forge/jobs/[id]/route.ts PATCH muda status pra cancelled"
    - "Validation Zod no body: prdSlug required, projectId optional"
    - "Auth: só is_manager OR is_admin pode criar"
    - "Cancel só permitido se status em (queued, claimed)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl -X POST http://localhost:3333/api/forge/jobs -H 'Content-Type: application/json' -d '{\"prdSlug\":\"x\"}'"
      expected: "202 with jobId OR 401/403"
  dependsOn: [FDM-003]
  estimateMinutes: 25
  touches:
    - src/app/api/forge/jobs/route.ts
    - src/app/api/forge/jobs/[id]/route.ts
  agentProfile: api

- id: FDM-005
  title: CLI forge daemon — claim + execute + heartbeat
  description: |
    Comando `forge daemon` em foreground. Lê daemonId de ~/.forge/daemon.json
    (cria se ausente). Autentica via Supabase OAuth (token em ~/.forge/auth.json).
    Subscribe realtime ForgeJob → claimNextJob → spawn exec-prd.ts → heartbeat
    loop → fecha job no fim.
  acceptanceCriteria:
    - "scripts/forge/cli.ts ganha subcomando 'daemon'"
    - "Cria ~/.forge/daemon.json no primeiro run com daemonId uuid"
    - "Subscribe realtime + fallback polling 30s"
    - "Spawn exec-prd.ts via child_process com cwd correto"
    - "Heartbeat UPDATE a cada 30s enquanto status=running"
    - "Output amigável (cores, timestamps, indentação)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "npx tsx scripts/forge/cli.ts daemon --help"
      expected: "exit 0, prints help"
  dependsOn: [FDM-003]
  estimateMinutes: 45
  touches:
    - scripts/forge/cli.ts
    - scripts/forge/daemon.ts
  agentProfile: wiring

- id: FDM-006
  title: CLI forge daemon stop/ps/logs/auth
  description: |
    Subcomandos extra: stop (envia signal pro daemon rodando), ps (mostra
    status local: idle/running + jobId), logs (tail ~/.forge/daemon.log),
    auth (re-roda OAuth flow).
  acceptanceCriteria:
    - "forge daemon stop envia SIGTERM via pidfile ~/.forge/daemon.pid"
    - "forge daemon ps lê status do pidfile + última linha do log"
    - "forge daemon logs faz tail -f ~/.forge/daemon.log"
    - "forge daemon auth invoca supabase login OAuth flow + persiste token"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "npx tsx scripts/forge/cli.ts daemon ps"
      expected: "shows status (idle or no daemon running)"
  dependsOn: [FDM-005]
  estimateMinutes: 30
  touches:
    - scripts/forge/cli.ts
    - scripts/forge/daemon.ts
  agentProfile: wiring

- id: FDM-007
  title: UI 'Builders ativos' + warning quando 0
  description: |
    Em /projects/[id]/forge, mostra contador de daemons com heartbeat
    recente (< 2min). Quando 0, warning + link pra docs/cli-setup.
  acceptanceCriteria:
    - "src/components/forge/active-builders.tsx mostra '▶ Builders ativos: N'"
    - "Consulta ForgeJob com claimedBy distinct + heartbeatAt > now()-2min"
    - "Quando count=0: warning amarelo + 'Abra forge daemon em algum PC'"
    - "Realtime subscription pra atualizar live"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "pnpm exec eslint src/components/forge/active-builders.tsx"
      expected: "exit 0"
  dependsOn: [FDM-005]
  estimateMinutes: 20
  touches:
    - src/components/forge/active-builders.tsx
  agentProfile: ui
```

Total: 7 stories, ~190min estimados.
