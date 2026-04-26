<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:supabase-agent-rules -->
# Supabase — migrations via psql

All database migrations MUST be executed via `psql`, never through the Supabase Dashboard SQL Editor or any other method.

## How to run a migration

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f supabase/migrations/<filename>.sql
```

The `DIRECT_URL` env var (in `.env`) points to the Supabase Postgres connection on port 5432 (session mode, no pgbouncer). Load it into shell before running psql.

## Rules

- Migration files go in `supabase/migrations/` with a descriptive name prefixed by date (e.g. `20260419_add_member_specialty.sql`).
- Always run via `psql "$DIRECT_URL" -f <path>` — this ensures consistent execution, proper error output, and works in CI.
- After running the migration, update `src/lib/supabase/database.types.ts` to reflect schema changes.
- Never use `prisma migrate` — Prisma is not the migration tool for this project.
<!-- END:supabase-agent-rules -->

<!-- BEGIN:git-agent-rules -->
# Git — commit + push via sync-main.sh

Pra commit + push em main, use sempre o script:

```bash
bash scripts/sync-main.sh -m "tag: area — short message"
```

O script:
- Stagea tudo (untracked + modified), bloqueia arquivos sensíveis (.env, *.pem, *.key, credentials.*, id_rsa)
- Auto-tagueia o commit se `-m` não for passado (formato `ZRD-JM-NN`)
- Rebase em cima do remote primário (linear history, nunca merge)
- **Push pra TODOS os remotes por default** (origin = prod, staging = staging) — não pergunta interativamente
- Pra single target: `--to staging` ou `--to origin`

LLMs podem rodar `bash scripts/sync-main.sh -m "..."` direto sem se preocupar com prompts. O default já faz o certo.
<!-- END:git-agent-rules -->
