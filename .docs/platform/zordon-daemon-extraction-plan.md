# Plano de extração — repo `zordon-daemon`

> **Status:** planejamento. Nada é deletado do monorepo nesta fase.
> **Princípio inviolável:** o daemon de dentro do monorepo (`scripts/daemon/`)
> continua rodando e servindo prod **até** o `zordon-daemon` ser validado
> ponta-a-ponta (chat + forja) **por fora**. Só então desliga-se o de dentro.
> **Decidido em:** 2026-06-03.

---

## 1. Objetivo

Extrair o executor (daemon + forja + chat) do monorepo Zordon pra um repo
próprio, enxuto e auto-contido (`zordon-daemon`), que:

- carrega **só** o necessário pra claimar jobs, montar workspace, rodar Claude
  Code e escrever de volta no DB;
- hospeda as `workspaces/` (clones dos repos de cliente) como sandbox contido;
- roda **igual** numa VM ou na máquina local (decisão por config/env);
- (Fase 2) autentica **por user + por máquina**, com UI local simples de login.

O monorepo continua sendo a SSOT de **prompt/contexto** (via HTTP
`prepare-context`) e de **schema** (Supabase). O daemon vira um cliente magro.

## 2. Por que o corte é limpo (seam já existe)

Dois contratos já separam daemon de app hoje — a extração só os formaliza:

| Contrato | O quê | Onde hoje |
|---|---|---|
| **HTTP `prepare-context`** | app monta os fatos vivos (~1-2KB JSON); daemon só consome | `exec-chat-turn.ts:174` → `ZORDON_URL/api/agents/<slug>/prepare-context` |
| **Schema Supabase** | DB é a SSOT única; daemon lê/escreve `ForgeJob`/`ChatTurn`/`ForgeRun`/… | `database.types.ts` |

E a **forja já tem DB-mode** (`FORGE_RUN_ID` → lê `ForgeRun.manifest` do banco,
`exec-forge-run.ts:79-118`). O modo filesystem (`scripts/ralph/features/*/prd.json`,
`docs/prd/`) é Ralph/dogfood e **não** vem pro `zordon-daemon`.

## 3. Fronteira de extração

### Vem pro `zordon-daemon` (origem no monorepo)

| Origem no monorepo | Vira (módulo no novo repo) |
|---|---|
| `scripts/daemon/daemon.ts` | `src/runner/daemon-loop.ts` |
| `scripts/daemon/daemon-ctl.sh` | `bin/zordon-daemon.ts` (CLI nativo) |
| `scripts/daemon/exec-chat-turn.ts` | `src/chat/exec-chat-turn.ts` |
| `scripts/daemon/exec-forge-run.ts` | `src/forge/exec-forge-run.ts` |
| `scripts/daemon/exec-forge-story.ts` | `src/forge/exec-forge-story.ts` |
| `scripts/daemon/event-uploader.ts` | `src/forge/event-uploader.ts` |
| `scripts/daemon/mcp-server.ts` | `src/tools/mcp-server.ts` |
| `scripts/daemon/chat-prompts.ts` | `src/chat/chat-prompts.ts` |
| `src/lib/db.ts` | `src/core/db.ts` |
| `src/lib/forge/dal/job.ts` | `src/claim/job-dal.ts` |
| `src/lib/forge/dal/daemon.ts` | `src/claim/daemon-registry.ts` |
| `src/lib/dal/chat-turn.ts` | `src/chat/chat-turn-dal.ts` |
| `src/lib/forge/paths.ts` | `src/forge/paths.ts` |
| `src/lib/forge/workspace.ts` | `src/forge/workspace.ts` |
| `src/lib/forge/runtime/event-writer.ts` + `run-state.ts` + `event-kinds.ts` | `src/forge/runtime/*` |
| `src/lib/agent/tools-registry.ts` + `tools/workspace.ts` + `tools/context-source.ts` | `src/tools/*` |
| `src/lib/supabase/database.types.ts` | `src/core/types.ts` (sincronizado — ver §6) |

### Fica no monorepo (o app)

- `prepare-context` / montagem de prompt + contexto vivo
- toda UI Next, API routes, RLS policies, o Supabase em si
- modo Ralph filesystem (PRDs em `docs/prd/`, `scripts/ralph/`)

## 4. Estrutura do repo + nomes dos módulos/funções

```
zordon-daemon/
├── bin/
│   └── zordon-daemon.ts          # CLI: login | start | stop | status | logs | run
├── src/
│   ├── core/
│   │   ├── db.ts                 # makeServiceClient() | makeUserClient(jwt)
│   │   ├── types.ts              # re-export do schema Supabase (synced)
│   │   └── env.ts                # resolveEnv(): FORGE_HOME, ZORDON_URL, MODE, AUTH
│   ├── claim/
│   │   ├── job-dal.ts            # claimNextJob() · updateJobStatus() · heartbeat()
│   │   └── daemon-registry.ts    # registerPresence() · heartbeatPresence() · unregisterPresence()
│   ├── runner/
│   │   ├── daemon-loop.ts        # runDaemonLoop()  ← coração (ex-runDaemon)
│   │   ├── job-dispatcher.ts     # dispatchJob(job) → chat | forge
│   │   └── shutdown.ts           # installSignalHandlers() · gracefulDrain()
│   ├── chat/
│   │   ├── exec-chat-turn.ts     # runChatTurn(turnId)
│   │   ├── chat-turn-dal.ts      # markChatTurnRunning() · appendChatTurnEvent() · completeChatTurn()
│   │   ├── chat-prompts.ts       # buildSystemPrompt() (default/fallback)
│   │   └── live-context-client.ts# fetchLiveContext(slug, threadId)  ← HTTP prepare-context
│   ├── forge/
│   │   ├── exec-forge-run.ts     # runForgeAutorun(runId, prdSlug)
│   │   ├── exec-forge-story.ts   # runForgeStory(story)
│   │   ├── workspace.ts          # ensureWorkspace() · acquireWorkspaceLock() · releaseWorkspaceLock()
│   │   ├── paths.ts              # getForgeHome() · resolveWorkspacePath()
│   │   ├── event-uploader.ts     # startUploaderForRun(runId) → { stop() }
│   │   └── runtime/              # createEmitter() · run-state (markRunRunning/Done/Error)
│   ├── tools/
│   │   ├── tools-registry.ts     # buildToolRegistry(ctx)
│   │   ├── workspace-tools.ts     # read/glob/grep_workspace (sandboxed)
│   │   └── mcp-server.ts         # startMcpServer()
│   ├── auth/                     # ── FASE 2 ──
│   │   ├── identity.ts           # resolveIdentity() → { memberId, mode }
│   │   ├── login-server.ts       # startLoginFlow()  (mini web-UI / device-code)
│   │   └── token-store.ts        # ~/.zordon-daemon/auth.json (load/save/clear)
│   └── ui/                       # ── FASE 2 ──
│       └── control-panel/        # login + status + logs (local, porta fixa)
├── workspaces/                   # GITIGNORED — clones de cliente (repos aninhados)
├── .zordon-daemon/               # GITIGNORED — daemon.json, daemon.pid, auth.json
├── .gitignore
├── package.json                  # bin: "zordon-daemon"
└── README.md
```

### Funções-âncora (mapa rápido)

| Função | Papel |
|---|---|
| `runDaemonLoop()` | claim → dispatch → heartbeat → repeat |
| `claimNextJob(identity, kind)` | pega 1 job da fila (ver §7 — SKIP LOCKED) |
| `dispatchJob(job)` | roteia por `job.kind` pro executor certo |
| `runChatTurn(turnId)` | executa 1 turn de chat, streama deltas pro DB |
| `fetchLiveContext(slug, threadId)` | **único** ponto de fala HTTP com o app |
| `runForgeAutorun(runId, prdSlug)` | loop de stories de 1 PRD |
| `ensureWorkspace(cfg)` | clone/reset + branch + lock por projeto |
| `resolveIdentity()` (F2) | quem este daemon serve (memberId ou shared) |
| `startLoginFlow()` (F2) | UI local de auth → grava `auth.json` |

## 5. Modos de execução (config, não código duplicado)

A lógica de claim **já** suporta os dois modos sem ramificar
(`job-dal.ts`: `ownerId.eq.<identity> OR assignToAnyone.eq.true`):

- **`MODE=shared`** (VM compartilhada): `assignToAnyone=true`, identidade stub —
  comportamento idêntico ao de hoje. **É o modo da Fase 1.**
- **`MODE=personal`** (máquina do user): identidade real via `resolveIdentity()`,
  claima só `ownerId == self`, `assignToAnyone=false` no enqueue.

`resolveEnv()` lê `MODE` do env/`daemon.json`. Trocar de modo = trocar config.

## 6. Os dois contratos (e como não derivar)

1. **`database.types.ts`** — risco nº1 do split: se divergir, o daemon escreve
   lixo silencioso no DB. **Decidido (D2):** `supabase gen types` rodado em CI
   nos dois repos contra o **mesmo** projeto Supabase. Sem registry, sem
   submodule. Um step de CI compara o gerado vs o commitado e falha se divergir
   (`git diff --exit-code src/core/types.ts`). Mudança de schema → os dois CIs
   regeneram; PRs ficam vermelhos até sincronizar.
2. **`prepare-context` HTTP** — versionar o shape do JSON. `fetchLiveContext()`
   trata non-OK com prompt DEFAULT (já existe em `exec-chat-turn.ts:200`), então
   degradação é graciosa, mas mudança de shape exige bump coordenado.

## 7. Race de claim (multi-daemon)

`claimNextJob` hoje é two-step (SELECT+UPDATE), **não atômico** (dívida
`FDM-003`). Com 1 daemon, ok. Com 2+ (validação paralela ou modo personal),
vira race. **Pré-requisito de produção multi-daemon:** migrar pra função
Postgres com `FOR UPDATE SKIP LOCKED`. Na validação paralela da Fase 1
contornamos com owners disjuntos (ver §8) — sem race.

## 8. Faseamento

### Fase 0 — Scaffold (não afeta prod)
- Criar repo `zordon-daemon`, `package.json`, `.gitignore` (workspaces/, .zordon-daemon/).
- Copiar os módulos da §3, ajustar imports relativos → estrutura nova.
- Resolver o contrato de types (§6) — decisão a/b/c.
- `bin/zordon-daemon.ts start|stop|status|logs` (porta do `daemon-ctl.sh`).
- **Critério:** `zordon-daemon status` sobe sem erro, registra presença no
  `ForgeDaemon` com hostname distinto.

### Fase 1 — Extração + modo personal, validado por fora (DECIDIDO: já com identidade)
> Decisão 2026-06-03: a Fase 1 **já** inclui identidade real + login (modo
> personal), não só o re-empacotamento. Mais superfície, mas é o ponto do repo.

- `resolveIdentity()` mata o stub `00000…`; daemon autentica como um user real.
- `startLoginFlow()` + `control-panel/` — login Supabase, grava `auth.json`.
- Daemon claima **só `ownerId == self`** (`assignToAnyone=false`).
- **Mudança no monorepo (aditiva, não-destrutiva):** o enqueue precisa decidir
  `assignToAnyone` por dono. Extender `isDaemonOnline()` →
  `isDaemonOnlineForOwner(memberId)`: se há daemon personal online pro dono,
  enfileira `ownerId=<user>, assignToAnyone=false` (vai pro daemon dele);
  senão mantém o comportamento atual (shared/openrouter). Sem isso, o chat de
  teste sai `assignToAnyone=true` e o daemon do monorepo disputa o job → race.
- **Validação paralela limpa:** com o daemon de teste logado como user X e o
  enqueue marcando `assignToAnyone=false` pra X, o daemon do monorepo **não**
  pega os jobs de X. Zero double-claim, zero risco pra prod.
- **Validar ponta-a-ponta:**
  - [ ] login flow → `auth.json` → presença no `ForgeDaemon` com memberId real
  - [ ] chat turn completo (claim → prepare-context → Claude → deltas → ChatMessage)
  - [ ] forja DB-mode: 1 PRD → workspace clone → branch → stories → push → ForgeRun done
  - [ ] heartbeat/presence, shutdown gracioso, event-uploader
  - [ ] Vercel: push do forge dispara deploy do repo de cliente (integração git)
- **Critério de desligamento:** os 5 itens verdes em ≥ N runs reais. Só então
  o daemon do monorepo é desligado (não deletado).

### Fase 2 — Hardening + modo shared opcional
- `MODE=shared` como config (VM compartilhada) reaproveitando o mesmo claim.
- `FOR UPDATE SKIP LOCKED` no claim (§7) pra multi-daemon sem race.
- GC de workspaces, métricas de custo por user.

## 9. Decisões

| # | Decisão | Status |
|---|---|---|
| D1 | Modo primário | ✅ **ambos**; Fase 1 valida `personal` (decisão 2026-06-03), `shared` vira config na Fase 2 |
| D2 | Sync de types | ✅ **CI gen-types** nos dois repos (§6) |
| D4 | Auth do Claude | ✅ segue D1 → modo personal usa a conta Claude do próprio user |
| **D3** | **Acesso ao DB no modo personal** | ✅ **COMBO: JWT+RLS (hot path) + RPC de claim + HTTP só pra credencial** (revisado 2026-06-04) — ver abaixo |

### D3 em detalhe — o COMBO (decisão final 2026-06-04)

Premissa: no modo personal o daemon roda na **máquina do PM** → **service-role
está proibida** (seria a chave-mestra do banco em cada laptop). A única "chave"
aceitável na máquina é a **anon key (já é pública, `NEXT_PUBLIC`) + o JWT do
próprio user**, limitado por RLS — exatamente o modelo de confiança do browser.

Por que **não** "HTTP pra tudo" (descartado): cada delta do chat é um write
(`appendChatTurnEvent`) — centenas por resposta → HTTP viraria centenas de POSTs
e pioraria o streaming. Além disso o daemon **precisa de um cliente Supabase de
qualquer jeito** pro broadcast realtime. HTTP-everything seria o pior dos dois.

**Combo (cada ferramenta no que é boa):**

| Operação | Mecanismo | Por quê |
|---|---|---|
| ler ChatTurn / thread state / manifest | **JWT + RLS** | dado do próprio user; read policy |
| append ChatTurnEvent (por delta) | **JWT + RLS** | hot path; HTTP seria chatty |
| broadcast realtime dos deltas | **anon + JWT** | já precisa do cliente Supabase |
| append ForgeEvent / update ForgeRun | **JWT + RLS** | dado do próprio user |
| completar turn (ChatMessage + done) | **JWT + RLS** | linhas que o user já é dono |
| **claim de job** | **RPC `claim_next_job` (SECURITY DEFINER + SKIP LOCKED)** | atômico; **mata a race FDM-003** (§7) |
| **credencial git (`project.githubPat`)** | **HTTP autenticado** (vending de token curto) | segredo de cliente — **nunca** expor via RLS read |
| `prepare-context` | HTTP (já existe) | inalterado |
| enqueue `assignToAnyone` | server-side no app | já é server-side |

```
UI do zordon-daemon (login Supabase normal)
   └─ magic-link/senha → access_token (JWT) + refresh + memberId
        └─ token-store grava ~/.zordon-daemon/auth.json (mode 600)
             ├─ cliente Supabase = createClient(anonKey, { Authorization: Bearer <JWT> })
             │     • reads + writes do hot path (governados por RLS)
             │     • realtime broadcast dos deltas
             │     • rpc('claim_next_job', { member_id, kind })
             └─ AppClient (HTTP + Bearer JWT)
                   • GET prepare-context
                   • POST /api/daemon/git-credential  → token curto pra clone (NÃO o PAT)
```

- Daemon **não carrega `SUPABASE_SERVICE_ROLE_KEY`**. Só anon key (pública) + JWT.
- RLS vira a fronteira de segurança do hot path — **mesmo modelo do web app**.
- O `sse-chat-proxy` do front não muda (continua escutando o canal `chat-turn-{id}`).

### Trabalho que o combo exige (Fase 1)

**Monorepo (aditivo):**
- RLS policies user-scoped: `ChatMessage` e `ChatThread` (hoje RLS on + **0
  policies** = deny-all); revisar `ChatTurn`/`ChatTurnEvent`/`ForgeRun`/
  `ForgeEvent`/`ForgeJob`/`ForgeDaemon` (já têm policies — confirmar que cobrem o
  daemon-as-user).
- RPC `claim_next_job(member_id uuid, kind text)` SECURITY DEFINER + `FOR UPDATE
  SKIP LOCKED` (substitui o claim two-step de `job.ts`, conserta FDM-003).
- `POST /api/daemon/git-credential` — valida JWT, resolve acesso ao Project,
  devolve token curto (idealmente GitHub App installation token, não o PAT).
- `isDaemonOnlineForOwner()` + enqueue seta `assignToAnyone=false` quando há
  daemon personal do dono online.

**Daemon (`zordon-daemon`):**
- `core/db.ts` → `userDb(jwt)` = `createClient(anonKey, { global headers
  Authorization })`. **Sem** service-role.
- Portar os DALs como **near-copy** trocando `db()` → `userDb(jwt)`; claim vira
  `userDb.rpc('claim_next_job', …)`.
- `workspace.ts` pega a credencial via `AppClient.getGitCredential()` em vez de
  ler `project.githubPat`.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Drift de `database.types` entre repos | §6 — package/submodule/CI gen |
| Double-claim em validação paralela | §8 — owners disjuntos; prod → SKIP LOCKED (§7) |
| Service key na máquina do PM (modo personal) | §9 D3 — usar JWT do user |
| Workspaces (repos aninhados) vazando pro git do daemon | `.gitignore` em `workspaces/` |
| Desligar o daemon do monorepo cedo demais | §8 — critério de desligamento explícito |

## 11. Referências

- Daemon atual: `scripts/daemon/daemon.ts`, `daemon-ctl.sh`
- Seam HTTP: `scripts/daemon/exec-chat-turn.ts:174`, `src/app/api/agents/[slug]/prepare-context/route.ts`
- Forja DB-mode: `scripts/daemon/exec-forge-run.ts:79-118`
- Workspace/git: `src/lib/forge/workspace.ts`, `src/lib/forge/paths.ts`
- Claim: `src/lib/forge/dal/job.ts:54-90`
- Memories: `[[project_forge_prd_consumption]]`, `[[project_vitor_mcp_volund_v2]]`, `[[project_forge_vs_zordon_workflow]]`
