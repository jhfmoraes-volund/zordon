<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:repo-structure -->
# Onde mora cada coisa (e onde colocar coisa nova)

Mapa de alto nível. O detalhe vive nos READMEs locais — leia-os antes de criar arquivo numa pasta que não conhece: [`docs/README.md`](docs/README.md), [`scripts/README.md`](scripts/README.md).

## src/

| Pasta | Conteúdo | Onde colocar coisa nova |
|-------|----------|-------------------------|
| `src/app/` | Rotas (App Router). Grupos: `(auth)`, `(dashboard)`, `(focus)`, `(onboarding)`. API em `src/app/api/`. | Página → no grupo certo. Endpoint → `api/`. **Validação Zod fica só aqui**, não no client. |
| `src/components/ui/` | Primitivos reutilizáveis (Button, Field, ResponsiveSheet…). | Componente genérico/reutilizável vai **aqui**. Ver bloco "UI patterns" antes de criar. |
| `src/components/<feature>/` | Componentes de uma feature (`sprint/`, `design-session/`, `story-hierarchy/`…). | Componente acoplado a uma feature → pasta da feature, não em `ui/`. |
| `src/lib/` | Lógica de domínio, integrações, helpers. Subsistemas grandes têm pasta própria (`agent/`, `dal/`, `insights/`, `optimistic/`). | Helper de domínio → `src/lib/`. Acesso a dados/queries → `src/lib/dal/`. |
| `src/hooks/` | React hooks compartilhados (ex: `use-optimistic-collection.ts`). | Hook reutilizável entre features. |
| `src/contexts/` | React contexts (auth, design-session). | Context global novo. |
| `src/eval/` | Harness de avaliação dos agentes. | Baselines/testes de agente. |
| `src/proxy.ts` | Middleware (Next 16) — auth + resolução de access_level por rota. | — |

## Raiz do repo

| Caminho | Conteúdo | Regra |
|---------|----------|-------|
| `docs/` | Planos, runbooks, PRDs — organizados por domínio. | **Doc novo vai na subpasta certa** (`docs/features/<domínio>/`, `docs/agents/<agente>/`, `docs/platform/`, `docs/prd/<estado>/`, `docs/runbooks/`), nunca solto na raiz de `docs/`. PRDs vivem em `docs/prd/{backlog,ready,in-progress,blocked,done,archive}/` — subdir é o status. |
| `scripts/` | CLIs de agente, ops, automação de git. | One-shot já executado → `scripts/archive/` (não some, só sai da vista). Migration de schema **não** vai aqui (ver Supabase). |
| `supabase/migrations/` | Migrations de schema (`YYYYMMDD_nome.sql`). | **Toda** mudança de schema vai aqui e roda via `psql` (ver bloco Supabase). |
| `public/` | Assets servidos estáticos. | Asset usado pela app. Não deixar asset órfão. |

**Princípio:** antes de criar componente/modal/form/mutação, checar se um padrão canônico já cobre (ver "UI patterns"). Antes de criar doc na raiz de `docs/` ou script solto em `scripts/`, escolher a subpasta.
<!-- END:repo-structure -->

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

4. **Forms — Field compound API** (ver `docs/platform/forms-standardization-plan.md`):
   - `<Field name required error><Field.Label/><Field.Control><Input|Select|Textarea/></Field.Control><Field.Hint/></Field>` — `Field.Control` injeta `id`/`aria-describedby`/`aria-invalid`/`aria-required` via `cloneElement`.
   - `<FormBody density="comfortable|compact">` controla densidade no escopo. `<Field.Row cols={2|3}>` para grid.
   - Altura via CSS var `--field-h` (não passar `h-9` no className do campo).
   - Estado: `useState` direto (sem react-hook-form). Validação Zod só em `src/app/api/**`, **não no client**.
   - Sem masked-input lib. Use `<Input type="date|number|tel|email">` nativo.

5. **Optimistic updates (sempre que mutar coleção)** — ver `docs/platform/optimistic-updates-runbook.md`:
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

<!-- BEGIN:prd-and-ralph -->
# PRDs — escrever pra Ralph desde o dia 1

Todo PRD no Volund é candidato a rodar via **Ralph** (loop autônomo, ver [docs/runbooks/ralph-process.md](docs/runbooks/ralph-process.md)). Pra não retrabalhar depois, escreva o PRD **já no formato que o Rito 1 (Intake) exige**.

## Onde mora — filesystem é estado

PRDs vivem em `docs/prd/<estado>/prd-<feature>.md`. O **subdir é o status**:

| Subdir | Significado |
|--------|-------------|
| `backlog/` | Ideia em rascunho. Rito 1 (Intake) não rodou. |
| `ready/` | Rito 1 done. `prd.json` existe. Pronto pra Ralph. |
| `in-progress/` | Ralph rodando ou pausado entre loops. |
| `blocked/` | Loop terminou. Checkpoint humano pendente. |
| `done/` | Stories 100% passes, aguardando closeout. |
| `archive/` | Pós-closeout. Filename ganha sufixo `-YYYYMMDD`. |

Fila de execução: `scripts/ralph/features/<feature>/prd.json` (derivada do §16 do PRD).

## Comandos canônicos (skill `/ralph` orquestra)

```bash
# Ver fila completa:
for d in backlog ready in-progress blocked done; do echo "── $d ──"; ls docs/prd/$d/ 2>/dev/null; done

# Pegar próximo PRD em ready/ e disparar loop:
bash scripts/ralph/next.sh

# Validar PRD pronto pra ready/:
bash scripts/ralph/intake.sh <feature>

# Review pós-loop (PRD em blocked/):
bash scripts/ralph/checkpoint.sh <feature>

# Arquivar + abrir PR (PRD em done/):
bash scripts/ralph/closeout.sh <feature>

# Mover PRD entre estados:
source scripts/ralph/lib/prd-paths.sh && prd_move <feature> <state>
```

**Regra:** nunca crie PRD direto em `ready/` ou estado posterior — sempre nasce em `backlog/`, passa por Rito 1, então move pra `ready/`.

## Anatomia obrigatória do PRD

Toda decisão arquitetural **fechada** (sem TBD). Toda métrica com instrumento. Toda story com critério verificável.

| § | Seção | Conteúdo mínimo |
|---|---|---|
| 1 | Problema | 2-3 problemas concretos com fonte (não abstrato) |
| 2 | Solução em uma frase | Uma frase. Se não couber, escopo grande demais |
| 3 | Não-objetivos | Lista explícita do que **fica de fora** |
| 4 | Personas e jornada | Citações em 1ª pessoa por persona |
| 5 | Decisões fixadas | Tabela `Dn` numerada: escolha + por quê. **Sem TBD aqui** |
| 6 | Arquitetura | Diagrama ASCII + componentes; cada caixa = endpoint/função real |
| 7 | Schema | DDL completo (CREATE/ALTER + índices + **RLS policies explícitas**); migrations atômicas, uma por arquivo |
| 8 | APIs | Tabela método/path/contrato; sempre async se envolve LLM ou job |
| 9 | UX | Wireframe ASCII das telas principais |
| 10 | Integrações | Como esta feature toca outras (DS, meetings, agentes…) |
| 11 | Faseamento | 1→2→3→4 limpo. Fase 1 entrega **mais** que o sistema atual, nunca menos |
| 12 | Riscos | Tabela `Risco | Prob | Impacto | Mitigação`. Mitigação acionável |
| 13 | Métricas de sucesso | Cada métrica com **instrumento** (query SQL, evento, dashboard). Sem instrumento → remova |
| 14 | Open questions | Idealmente vazio. Se preencher, marque qual fase resolve |
| 15 | Referências | Links pra código vivo, memories, PRDs relacionados |
| **16** | **Stories implementáveis** | **Lista numerada conforme schema abaixo** |

### §16 — Schema das stories (espelha o prd.json)

```yaml
- id: <FEATURE>-NNN          # WIKI-001, AUTH-007 — sequencial
  title: <imperativo curto>
  description: <1 parágrafo>
  acceptanceCriteria:        # AC objetivos, sem subjetividade
    - "Arquivo X existe com shape Y"
    - "Endpoint Z retorna 202 com jobId"
  verifiable:                # checks AUTOMATIZÁVEIS — sem isso Ralph não roda
    - kind: typecheck | lint | sql | http | manual_browser
      command_or_query: "<bash command ou query>"
      expected: "<output esperado>"
  dependsOn: [<ids>]         # DAG; vazio se story-raiz
  estimateMinutes: <int>     # ≤ 30 — não cabe em 1 context window se for maior
  touches: [<path/file>]     # arquivos previstos (orientativo)
```

## Regras de redação

- **Decisão antes de prosa.** Se a seção `Decisões fixadas` está vazia, o PRD não está pronto. Cada decisão recebe `Dn` numerada e fica imutável depois do Rito 1.
- **DDL completo no §7**, nunca "schema TBD" ou "definir índices depois". Inclui RLS policies — `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` por operação.
- **Migrations atômicas:** 1 ALTER ou 1 CREATE TABLE por arquivo. Rollback granular > economia de arquivos.
- **API sempre async se envolve LLM/job/processamento > 1s.** Endpoint retorna `202 + jobId`, cliente faz poll em `GET /jobs/[jobId]`. Não muda contrato entre fases.
- **Fase 1 ≥ sistema atual.** Se a Fase 1 entrega menos do que existe, ninguém vai chegar na Fase 2. Reescope.
- **Story ≤ 30min de implementação.** Maior que isso = não cabe em 1 context window do Claude → quebra.
- **Toda story precisa de ≥ 1 `verifiable` automatizável** (não só `manual_browser`). Sem check automático, a story exige Checkpoint humano e não pode rodar em loop > 1 iter.
- **`dependsOn` forma DAG, sem ciclos.** Stories paralelas (sem deps comum) podem ser pegas em ordem qualquer.
- **Refs tipadas.** Conteúdo gerado por LLM (sumários, decisões) sempre vem com referência tipada a meeting/DS/task. Sem ref clicável, não publica.

## Antes de publicar um PRD novo

Auto-checklist (responda mentalmente):

- [ ] §5 tem Decisões fixadas com pelo menos 8 entradas e zero TBD?
- [ ] §7 tem DDL completo com RLS, separado em migrations atômicas?
- [ ] §8 tem todos os endpoints com método + path + contrato?
- [ ] §11 Fase 1 entrega mais que o sistema atual (ou roda em paralelo)?
- [ ] §13 cada métrica tem query/evento/dashboard nomeado?
- [ ] §14 está vazio ou só com não-bloqueantes marcados pra Fase ≥ 2?
- [ ] §16 tem ≥ 5 stories, todas com `verifiable` automatizável, total ≤ 25?
- [ ] Existe `scripts/ralph/features/<feature>/prd.json` espelhando §16?

Se qualquer item falhar, o PRD não está pronto pra Rito 2. Volte e endereça.

## Quando o usuário pedir "escreva um PRD"

1. Pergunte o **problema** (não a solução).
2. Pergunte personas, escopo e o que **não** entra.
3. Escreva PRD em `docs/prd/backlog/prd-<feature>.md` seguindo o schema §1-§16 acima.
4. Gere `scripts/ralph/features/<feature>/prd.json` junto.
5. Rode o auto-checklist. Se 100% ok, proponha `bash scripts/ralph/intake.sh <feature>` pra promover pra `ready/`.

Modelos vivos no repo (referência boa): [docs/prd/ready/prd-opportunities.md](docs/prd/ready/prd-opportunities.md), [docs/prd/in-progress/prd-project-wiki.md](docs/prd/in-progress/prd-project-wiki.md).
<!-- END:prd-and-ralph -->
