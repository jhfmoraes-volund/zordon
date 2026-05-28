# scripts/

Utilitários de operação, CLIs de agente e automações de git. Scripts de TypeScript rodam via `tsx`.

> Migrations de schema **não** vivem aqui — vão em [`supabase/migrations/`](../supabase/migrations/) e rodam via `psql` (ver [AGENTS.md](../AGENTS.md)). Os `.sql` em [`archive/`](archive/) são one-shots de migrações já concluídas.

## Git / deploy

| Script | O que faz |
|--------|-----------|
| [`sync-main.sh`](sync-main.sh) | Commit + push local→`main` (rebase linear, push pra todos os remotes). Uso canônico de commit do repo. |
| [`sync-joao-dev.sh`](sync-joao-dev.sh) | Mesma máquina, dedicado à branch pessoal `joao-dev` (push só pra origin, sem `--force-branch`). |
| [`lib/gh-account-switch.sh`](lib/gh-account-switch.sh) | Troca a conta `gh` ativa por remote. Usado pelos `sync-*`. |

## CLIs de agente

Rodam com o shim que neutraliza o guard `server-only`:

```bash
tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts
```

| Script | O que faz |
|--------|-----------|
| [`alpha-cli.ts`](alpha-cli.ts) | Conversa com o agente **Alpha** direto pela engine. |
| [`vitor-cli.ts`](vitor-cli.ts) | Conversa com o agente **Vitor** direto pela engine. |
| [`approve-module-cli.ts`](approve-module-cli.ts) | Aprova um módulo de Design Session via CLI. |
| `_server-only-shim.cjs` / `_server-only-noop.cjs` | Infra do `--require` acima. Mantêm-se juntos na raiz. |

## Operação / dados (reutilizáveis)

| Script | O que faz |
|--------|-----------|
| [`create-member.ts`](create-member.ts) | Cria um Member + usuário Supabase Auth (senha de 8 dígitos). |
| [`reset-credentials.ts`](reset-credentials.ts) | Sincroniza `auth.users.email` com `Member.email` e reseta senha. |
| [`granola-recent.ts`](granola-recent.ts) / [`granola-raw.ts`](granola-raw.ts) | Puxa transcripts recentes do Granola. |
| [`roam-recent.ts`](roam-recent.ts) | Puxa notas recentes do Roam. |
| [`zelar-blob.ts`](zelar-blob.ts) | Concatena inputs do Zelar num blob de contexto (`/tmp/zelar-context.txt`). |
| [`upload-persona-avatars.mjs`](upload-persona-avatars.mjs) | Cria bucket `persona-avatars` e sobe os PNGs. |

## archive/

One-shots já executados, mantidos só para histórico — **não rodar de novo**:

- **Migração UUID** (concluída abr/2026): `uuid-build-migration.sql`, `uuid-restore-2.*.sql`, `dump-pre-migration.sql`. Contexto em [`docs/archive/uuid-migration-plan.md`](../docs/archive/uuid-migration-plan.md).
- **Migração de drafts/thread do Zelar**: `zelar-backfill-drafts.ts`, `zelar-migrate-drafts.ts`, `zelar-dedup-drafts.ts`, `zelar-persist-prework.ts`, `zelar-compact-thread.sql`, `zelar-truncate-message.{ts,sql}`.
- **Provisionamentos pontuais**: `create-levi-cro.ts`, `reset-vinicius-password.ts`.
