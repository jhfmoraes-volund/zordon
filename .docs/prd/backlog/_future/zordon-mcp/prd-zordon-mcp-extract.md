# PRD — Zordon MCP: extração do daemon + auth

**Reference**: ZMC-EXT
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01

## §1 Problema

1. Daemon da Forge hoje vive em `scripts/forge/*` dentro do repo Zordon. Pra um PM novo rodar daemon ele clona o webapp inteiro (~200MB) e ganha acesso ao source do SaaS.
2. Daemon usa `SUPABASE_SERVICE_ROLE_KEY` direto no `.env` local — qualquer PM com daemon tem **chave master do banco**. Inaceitável fora do laptop do João.
3. Diretório de workspace é `~/volund-forge/`, mas o conceito é maior que "forge" — vai abrigar também chat via daemon (PRD chat-via-claude-daemon). Nome confunde.

## §2 Solução em uma frase

Extrair daemon + workspace runtime pra repo `volund-ia/zordon-mcp` standalone, autenticado por Bearer token (não service_role), com diretório `~/zordon-terraforming/` substituindo `FORGE_HOME`.

## §3 Não-objetivos

- Implementar MCP server (fica em PRD `zordon-mcp-server`).
- Implementar chat via daemon (fica em PRD `chat-via-claude-daemon`).
- Empacotar como npm package público — piloto fica em `git clone` direto.
- Auto-update do daemon. Por enquanto `git pull` manual.

## §4 Personas e jornada

- **PM (João, Vitor, futura squad)**: "Quero rodar a Forge na minha máquina sem ter o source do Zordon nem chave master do banco."
- **Builder Zordon**: "Quero o daemon ser cliente HTTP do Zordon, não escrever direto no banco."

## §5 Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | Novo repo `github.com/volund-ia/zordon-mcp` | Separa cliente (daemon) de servidor (Zordon). PM cloma só o cliente. |
| D2 | Daemon fala com Zordon via HTTP (`POST /api/daemon/**`) | Tira `service_role` do `.env` do PM. Daemon vira cliente comum com Bearer token. |
| D3 | Auth = `DaemonToken` (hashed) por Member, gerado em `/settings/daemon` | Mesma identidade que já existe; token = capability escopada. |
| D4 | `~/zordon-terraforming/<project-slug>/` substitui `~/volund-forge/workspaces/<slug>/` | "Forge" = motor; "Terraforming" = território. Conceito carrega chat também no futuro. |
| D5 | Variável env passa a ser `TERRAFORMING_HOME` (default `~/zordon-terraforming`) com fallback retrocompatível pra `FORGE_HOME` por 1 release | Migration suave. Quem tem alias antigo não quebra. |
| D6 | Tipos compartilhados via script `bin/sync-mcp-types.ts` no Zordon — gera arquivos em `zordon-mcp/src/types/` e abre PR | Sem npm publish ainda. Sem submodule. Source of truth do shape continua no Zordon. |
| D7 | CLI binário = `zordon-mcp` (subcomandos: `login`, `status`, `daemon`, `test`) | Padrão de daemon CLI moderno (vercel, gh, supabase). |
| D8 | Estado de auth do daemon em `~/.zordon-mcp/auth.json` (chmod 600) | Não pode viver no `.env` do repo (commitável por engano). |
| D9 | Migration: novo repo apenas — nada deletado no Zordon nesta fase. Scripts antigos viram thin wrappers que avisam "use zordon-mcp" | Não quebra ninguém que ainda roda `scripts/forge/daemon.ts` durante a transição. |
| D10 | Repo zordon-mcp **privado** inicialmente, vira público quando estabilizar | Risco de leak de detalhes internos enquanto piloto. |

## §6 Arquitetura

```
                ┌────────────────────────────────┐
                │ Zordon (cloud)                 │
                │  ┌─────────────────────────┐   │
                │  │ Endpoints novos:        │   │
                │  │ POST /api/daemon/register   │
                │  │ POST /api/daemon/heartbeat  │
                │  │ POST /api/daemon/jobs/claim │
                │  │ POST /api/daemon/jobs/:id/complete │
                │  │ POST /api/daemon/events:batch      │
                │  │ PATCH /api/daemon/runs/:id         │
                │  └─────────▲───────────────┘   │
                │            │ Bearer fdt_...     │
                └────────────│───────────────────┘
                             │ HTTPS outbound
                             │
                  ┌──────────┴────────────────────┐
                  │ ~/zordon-mcp/ (cloned)        │
                  │ bin/zordon-mcp                │
                  │ scripts/daemon.ts             │
                  │ scripts/exec-prd.ts           │
                  │ scripts/exec-story.ts         │
                  │ src/client/ (HTTP → Zordon)   │
                  │ src/runtime/ (workspace, evt) │
                  │ src/types/ (synced)           │
                  └─────────▲─────────────────────┘
                            │ stdin/stdout
                  ┌─────────┴─────────────┐
                  │ Claude CLI            │
                  │ (BYO subscription)    │
                  └───────────────────────┘
                            │ fs writes
                  ┌─────────┴─────────────┐
                  │ ~/zordon-terraforming/│
                  │   <project-slug>/     │ (cliente repo clonado)
                  │   .runs/<run-id>/     │ (jsonl + memory)
                  └───────────────────────┘
```

## §7 Schema

```sql
-- 1. Token de daemon
CREATE TABLE "DaemonToken" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "memberId" uuid NOT NULL REFERENCES "Member"(id) ON DELETE CASCADE,
  "tokenHash" text NOT NULL,
  "label" text NOT NULL,
  "lastUsedAt" timestamptz,
  "expiresAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "revokedAt" timestamptz,
  UNIQUE ("tokenHash")
);
CREATE INDEX "DaemonToken_memberId_idx" ON "DaemonToken"("memberId");

ALTER TABLE "DaemonToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daemon_token_owner_read" ON "DaemonToken"
  FOR SELECT USING ("memberId" = auth.uid());
CREATE POLICY "daemon_token_owner_write" ON "DaemonToken"
  FOR ALL USING ("memberId" = auth.uid())
  WITH CHECK ("memberId" = auth.uid());

-- 2. Liga daemon a member real
ALTER TABLE "ForgeDaemon"
  ALTER COLUMN "memberId" DROP DEFAULT,
  ALTER COLUMN "memberId" SET NOT NULL;
```

Validação Bearer no servidor: middleware lê `Authorization: Bearer fdt_*`, hash com sha256, lookup em DaemonToken, atualiza `lastUsedAt`, injeta `memberId` no contexto.

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/daemon-tokens` | Body: `{label}` → Returns: `{id, plaintext_token}` (one-time reveal) |
| GET | `/api/daemon-tokens` | List user's tokens (sem plaintext) |
| DELETE | `/api/daemon-tokens/:id` | Soft delete (set `revokedAt`) |
| POST | `/api/daemon/register` | Body: `{hostname, version}` → Returns: `{daemonId}` |
| POST | `/api/daemon/heartbeat` | Body: `{daemonId}` → 204 |
| POST | `/api/daemon/jobs/claim` | Body: `{daemonId, kind?: 'forge'}` → Returns: `{job, run, manifest}` ou 204 (empty) |
| POST | `/api/daemon/jobs/:id/complete` | Body: `{ok, reason?, eventCounts?}` → 204 |
| POST | `/api/daemon/events:batch` | Body: `{runId, events: [{kind, payload}]}` (seq atribuído server-side) → 204 |
| PATCH | `/api/daemon/runs/:id` | Body: `{status?, progress?, meta?}` → 204 |

Todos com `Authorization: Bearer fdt_*`. Validação 401 se token inválido/revogado.

## §9 UX

### `/settings/daemon` (Zordon UI)

```
┌─────────────────────────────────────────────────┐
│ Daemon — Zordon MCP                             │
│                                                 │
│ Tokens                                          │
│  • Joao Mac (criado 2026-06-01, último uso 2m) │
│       [Revogar]                                 │
│                                                 │
│  [+ Novo token]                                 │
│                                                 │
│ Daemons ativos                                  │
│  ● dmn_5xK2... · Joao MacBook · heartbeat 12s  │
│                                                 │
│ Quickstart                                      │
│  $ git clone github.com/volund-ia/zordon-mcp   │
│  $ cd zordon-mcp && npm install                │
│  $ zordon-mcp login --token fdt_...            │
│  $ zordon-mcp daemon                           │
└─────────────────────────────────────────────────┘
```

### CLI

```
$ zordon-mcp
zordon-mcp 1.0.0

Commands:
  login      Saves a daemon token to ~/.zordon-mcp/auth.json
  daemon     Starts daemon loop (forge jobs)
  status     Shows daemon health + last heartbeat
  test       Smoke test (auth + claim mock job + emit events)
  help       Show this help
```

## §10 Integrações

- **Zordon webapp**: precisa expor novos endpoints (esta PRD).
- **Forge UI atual**: zero mudança visível. Daemon antigo continua funcionando até remoção em release seguinte.
- **scripts/forge/daemon.ts**: vira thin wrapper que printa "Use `zordon-mcp daemon` (instale https://github.com/volund-ia/zordon-mcp)".

## §11 Faseamento

Fase 1 (esta PRD):
1. Endpoints `/api/daemon/**` + DaemonToken table + `/settings/daemon` UI no Zordon
2. Criação do repo `zordon-mcp` + esqueleto + CLI base
3. Migração de scripts (forge daemon, exec-prd, exec-story, workspace, event-writer) pro novo repo
4. Substituir `db().from(...)` por chamadas HTTP via `client/`
5. `TERRAFORMING_HOME` substituindo `FORGE_HOME`
6. Smoke end-to-end: dispara PRD na UI, daemon do novo repo executa

Fase 2+: chat via daemon, MCP server, polish — vivem em PRDs separadas.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Quebrar Forge atual durante transição | M | A | D9 garante que scripts antigos continuam funcionais; só viram wrappers no final |
| `seq` global race em `POST /events:batch` | M | M | Servidor (não daemon) atribui seq via SELECT MAX(seq)+1 dentro da transaction + retry em 23505 |
| Token vaza em log | M | A | Storage com chmod 600; hash sha256 antes de gravar no DB; nunca logar plaintext |
| PM esquece de fazer `git pull` no repo daemon | A | B | `zordon-mcp daemon` checa versão via header `X-Daemon-Version-Expected`; warn se outdated >7d |
| Latência de HTTPS adiciona overhead vs DB direto | B | B | Batch de eventos em janelas de 250ms já tá no event-writer atual |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Tempo de onboarding PM novo (clone → primeiro job done) | Manual: cronometra com 1 PM piloto. Target: ≤ 10min |
| % requests `/api/daemon/**` autenticados com sucesso | `SELECT count(*) FROM api_log WHERE path LIKE '/api/daemon/%' AND status=200` ÷ total |
| Daemons únicos ativos (heartbeat <60s) | `SELECT count(DISTINCT daemonId) FROM ForgeDaemon WHERE lastHeartbeatAt > now() - interval '60 seconds'` |
| Zero uso de `SUPABASE_SERVICE_ROLE_KEY` em `.env` do daemon | Grep no `.env.example` do zordon-mcp + audit de daemons piloto |

## §14 Open questions

(vazio — todas resolvidas em §5)

## §15 Referências

- Memory `project_vitor_mcp_volund_v2.md` — direção Vitor como MCP
- Memory `project_forge_double_diamond.md` — onde Forge se encaixa
- Memory `project_forge_vs_zordon_workflow.md` — limites do que Forge faz hoje
- Bug A fix: [src/lib/forge/runtime/event-writer.ts](../../../src/lib/forge/runtime/event-writer.ts) — vai migrar pra zordon-mcp

## §16 Stories implementáveis

```yaml
- id: ZMC-EXT-001
  title: Criar tabela DaemonToken + RLS
  description: Migration SQL com tabela DaemonToken (id, memberId, tokenHash, label, lastUsedAt, expiresAt, revokedAt, createdAt). Index em memberId. RLS owner-only.
  acceptanceCriteria:
    - "supabase/migrations/<data>_daemon_token.sql existe"
    - "Tabela DaemonToken criada com RLS habilitado"
    - "psql consegue inserir DaemonToken como member"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.tables WHERE table_name = 'DaemonToken'"
      expected: "1"
    - kind: sql
      command_or_query: "SELECT relrowsecurity FROM pg_class WHERE relname = 'DaemonToken'"
      expected: "t"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: ZMC-EXT-002
  title: API CRUD para DaemonToken (Zordon)
  description: Endpoints POST/GET/DELETE /api/daemon-tokens. POST gera token plaintext (one-time return) + grava hash. DELETE = soft delete (revokedAt).
  acceptanceCriteria:
    - "POST /api/daemon-tokens cria registro e devolve {id, plaintext_token}"
    - "GET /api/daemon-tokens lista tokens do user atual sem plaintext"
    - "DELETE /api/daemon-tokens/:id seta revokedAt"
    - "Plaintext nunca aparece em log nem response GET"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
    - kind: lint
      command_or_query: "npx eslint src/app/api/daemon-tokens"
      expected: ""
  dependsOn: [ZMC-EXT-001]
  estimateMinutes: 25
  touches: ["src/app/api/daemon-tokens/", "src/lib/dal/daemon-token.ts"]

- id: ZMC-EXT-003
  title: Middleware Bearer token p/ /api/daemon/**
  description: Resolve token (sha256 → DaemonToken row → memberId), atualiza lastUsedAt, anexa memberId no contexto. 401 se token inválido/revogado/expirado.
  acceptanceCriteria:
    - "Requests sem header retornam 401"
    - "Requests com token revogado retornam 401"
    - "Requests válidos têm contexto.memberId populado"
    - "lastUsedAt atualizado a cada hit"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-EXT-001]
  estimateMinutes: 25
  touches: ["src/lib/auth/daemon-auth.ts"]

- id: ZMC-EXT-004
  title: Endpoints /api/daemon/** (register, heartbeat, claim, complete, events, runs)
  description: 6 endpoints conforme §8 da PRD. claim aceita filtro opcional ?kind=forge. events:batch atribui seq server-side via SELECT MAX(seq)+1 dentro da transação.
  acceptanceCriteria:
    - "Os 6 endpoints existem e retornam shapes corretos"
    - "events:batch atribui seq monotonicamente sem colisão (Bug A fix server-side)"
    - "claim retorna 204 quando não há job"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.routines WHERE routine_name LIKE 'daemon_%'"
      expected: ">=0"
  dependsOn: [ZMC-EXT-003]
  estimateMinutes: 30
  touches: ["src/app/api/daemon/"]

- id: ZMC-EXT-005
  title: UI /settings/daemon — list/create/revoke tokens
  description: Página em (dashboard)/settings/daemon. Lista tokens + botão "Novo token" (sheet com label) + revogar (confirm). Mostra plaintext UMA vez com copy + warning.
  acceptanceCriteria:
    - "Página renderiza lista de tokens do user"
    - "Criar token revela plaintext só uma vez"
    - "Botão revogar usa ConfirmDialog (não window.confirm)"
    - "Acesso restrito a access_level >= manager"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
    - kind: manual_browser
      command_or_query: "Visit /settings/daemon as manager, create token, revoke it"
      expected: "fluxo completo sem erros"
  dependsOn: [ZMC-EXT-002]
  estimateMinutes: 30
  touches: ["src/app/(dashboard)/settings/daemon/page.tsx", "src/components/settings/daemon-token-sheet.tsx"]

- id: ZMC-EXT-006
  title: Criar repo volund-ia/zordon-mcp + esqueleto
  description: gh repo create (privado). package.json, tsconfig, .gitignore, .env.example, README, bin/zordon-mcp stub. Commit inicial.
  acceptanceCriteria:
    - "Repo github.com/volund-ia/zordon-mcp existe (privado)"
    - "package.json com name=zordon-mcp, bin entry, deps mínimas (undici, tsx, chalk)"
    - "README com quickstart 5 passos"
    - ".env.example documentado"
  verifiable:
    - kind: http
      command_or_query: "gh repo view volund-ia/zordon-mcp --json name"
      expected: '{"name":"zordon-mcp"}'
  dependsOn: []
  estimateMinutes: 25
  touches: ["(novo repo)"]

- id: ZMC-EXT-007
  title: CLI zordon-mcp com subcomandos (login, daemon, status, test)
  description: bin/zordon-mcp.js parseando argv. login salva ~/.zordon-mcp/auth.json com chmod 600. status faz heartbeat + printa health. test = smoke (POST register + claim mock).
  acceptanceCriteria:
    - "zordon-mcp login --token fdt_... grava ~/.zordon-mcp/auth.json"
    - "Permissões 600 em auth.json"
    - "zordon-mcp status retorna 0 quando daemon registrado"
    - "zordon-mcp test exercita os 3 endpoints (register + heartbeat + claim)"
  verifiable:
    - kind: manual_browser
      command_or_query: "cd ~/zordon-mcp && npm install && ./bin/zordon-mcp test"
      expected: "exit 0 com 'all endpoints ok'"
  dependsOn: [ZMC-EXT-004, ZMC-EXT-006]
  estimateMinutes: 30
  touches: ["zordon-mcp/bin/", "zordon-mcp/scripts/cli.ts"]

- id: ZMC-EXT-008
  title: Migrar scripts/forge/* + src/lib/forge/runtime/* → zordon-mcp
  description: Copia daemon.ts, exec-prd.ts, exec-story.ts pro novo repo. Workspace.ts, event-writer.ts, paths.ts vão pra src/runtime/. Substitui imports db() por client HTTP.
  acceptanceCriteria:
    - "zordon-mcp/scripts/daemon.ts existe e roda npm run daemon sem erro de import"
    - "Zero referência a SUPABASE_SERVICE_ROLE_KEY no novo repo"
    - "Zero import de '@/lib/db' no novo repo"
  verifiable:
    - kind: lint
      command_or_query: "grep -r 'SUPABASE_SERVICE_ROLE_KEY' ~/zordon-mcp/src ~/zordon-mcp/scripts || echo 'clean'"
      expected: "clean"
    - kind: typecheck
      command_or_query: "cd ~/zordon-mcp && npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-EXT-007]
  estimateMinutes: 30
  touches: ["zordon-mcp/scripts/", "zordon-mcp/src/runtime/", "zordon-mcp/src/client/"]

- id: ZMC-EXT-009
  title: Rename FORGE_HOME → TERRAFORMING_HOME (com fallback)
  description: src/runtime/paths.ts no zordon-mcp lê TERRAFORMING_HOME primeiro, cai em FORGE_HOME se existir (warn deprecated), default ~/zordon-terraforming. Updates docstrings.
  acceptanceCriteria:
    - "Resolução de path checa env vars na ordem TERRAFORMING_HOME → FORGE_HOME → default"
    - "Warning emitido quando FORGE_HOME usado"
    - "Workspaces criadas em ~/zordon-terraforming/<slug>/ por default"
  verifiable:
    - kind: manual_browser
      command_or_query: "TERRAFORMING_HOME=/tmp/zt npx tsx -e 'import {getTerraformingHome} from \"./src/runtime/paths\"; console.log(getTerraformingHome())'"
      expected: "/tmp/zt"
  dependsOn: [ZMC-EXT-008]
  estimateMinutes: 20
  touches: ["zordon-mcp/src/runtime/paths.ts"]

- id: ZMC-EXT-010
  title: Bin/sync-mcp-types.ts no Zordon
  description: Script que regenera arquivos shared (event-kinds, ForgeRunManifest, PRD schema) pra ~/zordon-mcp/src/types/. Roda manual via npm run sync:mcp-types.
  acceptanceCriteria:
    - "bin/sync-mcp-types.ts existe no Zordon"
    - "Gera arquivos em ~/zordon-mcp/src/types/ se path existir"
    - "Tipos no zordon-mcp typecheck após sync"
  verifiable:
    - kind: typecheck
      command_or_query: "npm run sync:mcp-types && cd ~/zordon-mcp && npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-EXT-008]
  estimateMinutes: 25
  touches: ["bin/sync-mcp-types.ts", "package.json"]

- id: ZMC-EXT-011
  title: Smoke end-to-end (Zordon UI → zordon-mcp daemon → Claude → push)
  description: Dispara PRD-002 do Volundly pela UI. Daemon do novo repo (com Bearer token) pega job, materializa workspace em ~/zordon-terraforming/volundly/, executa story, faz git push.
  acceptanceCriteria:
    - "Run termina com status=done"
    - "Eventos chegam ao DB via /api/daemon/events:batch (não via service_role)"
    - "Workspace materializada em ~/zordon-terraforming/volundly/ (não ~/volund-forge/)"
    - "PRD-002 fica verde no kanban"
  verifiable:
    - kind: manual_browser
      command_or_query: "Disparar PRD-002 via UI; observar daemon log + kanban"
      expected: "PRD vira CONCLUÍDO; events no DB"
  dependsOn: [ZMC-EXT-005, ZMC-EXT-009, ZMC-EXT-010]
  estimateMinutes: 30
  touches: ["(end-to-end test)"]

- id: ZMC-EXT-012
  title: Thin wrapper em scripts/forge/daemon.ts (deprecation)
  description: Substitui daemon.ts atual por wrapper que printa "use zordon-mcp daemon" + link de instalação. Mantém 1 release pra dar tempo de migração.
  acceptanceCriteria:
    - "scripts/forge/daemon.ts printa mensagem deprecation e exita 1"
    - "Não importa nada do runtime antigo"
  verifiable:
    - kind: manual_browser
      command_or_query: "npx tsx scripts/forge/daemon.ts 2>&1 | head -3"
      expected: "contém 'use zordon-mcp daemon'"
  dependsOn: [ZMC-EXT-011]
  estimateMinutes: 10
  touches: ["scripts/forge/daemon.ts"]
```

**Total: 12 stories, ~300min (5h).**
