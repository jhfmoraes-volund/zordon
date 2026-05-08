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

<!-- BEGIN:ui-patterns -->
# UI patterns — reuse first

Cinco padrões canônicos. Antes de criar componente novo, modal, form ou mutação client-side, verificar se um destes cobre.

1. **Componentes reutilizáveis** vivem em `src/components/ui/`. Inventário completo: ver memory `project_ui_patterns.md`. Inclui `Field`/`FormBody`, `Button`, `Input`, `Textarea`, `Select`, `StatusChip`, `StatusChipSelect`, `Card`, `Badge`, `Skeleton`, `Tooltip`, `DropdownMenu`, `Sidebar`, `Markdown`, `Sonner`, etc.

2. **Responsive Sheet/Dialog (sempre)** — nunca `<Dialog>` ou `<Sheet>` nu. Use:
   - `ResponsiveSheet` (`src/components/ui/responsive-sheet.tsx`) — desktop side-sheet, mobile bottom-sheet 90dvh. Para edição rica de item de lista (story/task/project/design session). `size="sm|md|lg"` = 480/640/760px no desktop.
   - `ResponsiveDialog` (`src/components/ui/responsive-dialog.tsx`) — desktop modal, mobile bottom-sheet. Para 1–3 fields / decisão pontual.
   - Ambos resolvem mobile via `useIsMobile()` (768px) com context. Sub-components (Header/Body/Footer) tratam padding e safe-area.

3. **Custom Confirm/Alert** — proibido `window.confirm()` / `alert()`. Use `ConfirmDialog` (`src/components/ui/confirm-dialog.tsx`): stateless, recebe `state: { title, description?, confirmLabel?, cancelLabel?, destructive?, onConfirm: () => void|Promise<void> } | null`, trata busy + close async. Erros vão em **Sonner toast** (não em alert/dialog).

4. **Forms — Field compound API** (ver `docs/forms-standardization-plan.md`):
   - `<Field name required error><Field.Label/><Field.Control><Input|Select|Textarea/></Field.Control><Field.Hint/></Field>` — `Field.Control` injeta `id`/`aria-describedby`/`aria-invalid`/`aria-required` via `cloneElement`.
   - `<FormBody density="comfortable|compact">` controla densidade no escopo. `<Field.Row cols={2|3}>` para grid.
   - Altura via CSS var `--field-h` (não passar `h-9` no className do campo).
   - Estado: `useState` direto (sem react-hook-form). Validação Zod só em `src/app/api/**`, **não no client**.
   - Sem masked-input lib. Use `<Input type="date|number|tel|email">` nativo.

5. **Optimistic updates (sempre que mutar coleção)** — ver `docs/optimistic-updates-runbook.md`:
   - Hook canônico: `useOptimisticCollection<T, X>(initial, reducer?)` em `src/hooks/use-optimistic-collection.ts`. Mutations base: `patch | create | delete | bulkPatch | bulkDelete | external_update`. Estende com `combineReducers(extra)`.
   - API: `mutate(mutation, persist, { errorLabel, reconcile?, retry? })` — aplica reducer otimista, roda `persist(signal)`, reconcilia committed.
   - Errors via `showErrorToast` (`src/lib/optimistic/toast.ts`): 403 → "sem permissão", 409 → "outro usuário editou", 5xx → auto-retry 1× + toast com "Tentar de novo", network/abort → "sem conexão. Mudança revertida".
   - AbortController por chave (`${type}:${id}`) cancela mutation prévia. Para fetch simples, `fetchOrThrow` joga `HttpError` com status preservado.
   - **Regra**: nunca `setState` direto após `fetch` em listas. Sempre `mutate(...)`.
<!-- END:ui-patterns -->

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
