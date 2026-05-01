# Story Hierarchy — Cleanup Plan (Wave 7+10)

**Status:** pendente · pronto pra execução
**Última atualização:** 2026-05-01
**Audience:** agente (humano ou IA) executando o cleanup pós-backfill.
**Pré-requisito satisfeito:** zero tasks órfãs em projetos não-archived (validado 2026-05-01 após backfill ZRD-JM-08).

**Documentos relacionados:**
- [story-hierarchy-execution-runbook.md](./story-hierarchy-execution-runbook.md) — status global das waves
- [story-hierarchy-plan.md](./story-hierarchy-plan.md) — schema-alvo V2 (§3.12: `area` substitui `type`+`scope`)
- [story-hierarchy-migration.md](./story-hierarchy-migration.md) — migração técnica original

---

## Por quê

A hierarquia Module → UserStory → Task entrou em produção com 3 colunas legacy ainda no schema:

- `Task.acceptanceCriteria` (text) — substituída pela tabela `AcceptanceCriterion`
- `Task.type` (`feature`/`bugfix`/`setup`/...) — substituída por `Task.area` (§3.12 do plano V2)
- `Task.scope` (`micro`/`small`/`medium`/`large`) — idem

Plus 1 página inteira de kanban legacy (`/sprints/[id]/board`) que sobreviveu à migração e precisa ser substituída por deep-link na page nova do projeto.

Manter as colunas + a page kanban significa código duplicado, drift entre plano e implementação, e bugs onde o mesmo dado é editado em dois lugares.

---

## Estratégia: 4 ondas

| Onda | Escopo | Risco | Reversível | Tempo |
|---|---|---|---|---|
| **A** | Delete-only (zero leitores fora do próprio legacy) | zero | git revert | ~15 min |
| **B** | Drop sprint kanban + redirect dos 4 consumers pra deep-link na page nova | baixo | git revert | ~45 min |
| **C** | Refactor de ~14 arquivos pra parar de ler `task.type/scope/acceptanceCriteria(text)` | médio | git revert | ~2h |
| **D** | `ALTER TABLE Task DROP COLUMN` — schema final | **irreversível** | restore backup | ~10 min |

**Sequência recomendada:** A+B numa rajada (mesma natureza, riscos baixos), depois C separado (mais cirúrgico), D só após C compilar limpo + smoke test passar.

---

## Onda A — Delete-only

**Objetivo:** remover arquivos com **zero leitores** fora do próprio legacy.

### Arquivos a deletar

| Caminho | Tamanho | Por que é seguro |
|---|---|---|
| `src/app/(dashboard)/projects/[id]/_deprecated/page-legacy.tsx` | ~62KB | Já está em `_deprecated/`. Nada importa dele. |
| `src/app/api/projects/[id]/schedule/route.ts` | ~3KB | Só consumida pelo page-legacy acima. |
| `src/components/sprint-deploy-panel.tsx` | — | Só usada pelo page-legacy. |
| `src/components/sprint-overview-widget.tsx` | — | Só usada pelo page-legacy. |

### Validação

```bash
bunx tsc --noEmit  # zero novos erros
grep -rn "page-legacy\|sprint-deploy-panel\|sprint-overview-widget\|api/projects/.*/schedule" src/ \
  | grep -v "_deprecated\|node_modules"
# resultado esperado: vazio
```

### Commit

```bash
bash scripts/sync-main.sh -m "ZRD-JM-NN: cleanup A — drop _deprecated page + sprint-deploy/overview-widget + schedule route"
```

---

## Onda B — Drop sprint kanban + deep-link

**Objetivo:** remover a página global de sprints (`/sprints` e `/sprints/[id]/board`) e redirecionar consumers pra page do projeto com a sprint focada via URL.

### Decisão registrada (PM 2026-05-01)

> "Tela de sprint que tem kanban deve deixar de existir. Vamos adaptar o Kanban para nossa V2 depois."
> "Quem apertar para ir na sprint, deve ir na aba de sprint do projeto filtrando na sprint citada."

Kanban view será reimplementado **no futuro** dentro da tab Sprints da page do projeto. Por ora, deep-link abre a tab Sprints com a sprint selecionada (lista padrão).

### Format do deep-link

```
/projects/<projectId>?tab=sprints&sprint=<sprintId>
```

### Passo 1 — Page nova suporta deep-link

**Arquivo:** `src/app/(dashboard)/projects/[id]/page.tsx`

**Mudanças:**

```tsx
// 1. Importar useSearchParams
import { useSearchParams } from "next/navigation";

// 2. Ler params no início do componente (próximo de useState atuais)
const searchParams = useSearchParams();
const tabParam = searchParams.get("tab") as TabKey | null;
const sprintParam = searchParams.get("sprint");

// 3. Inicializar state com fallback aos params
const [activeTab, setActiveTab] = useState<TabKey>(tabParam ?? "stories");
const [focusSprintId, setFocusSprintId] = useState<string | null>(sprintParam);
```

**Opcional (recomendado):** sync state→URL via `router.replace` quando user troca tab/sprint, pra que refresh/share preserve o estado. Custo baixo, valor alto.

```tsx
const router = useRouter();
const pathname = usePathname();

useEffect(() => {
  const params = new URLSearchParams();
  if (activeTab !== "stories") params.set("tab", activeTab);
  if (activeTab === "sprints" && focusSprintId) params.set("sprint", focusSprintId);
  const qs = params.toString();
  router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
}, [activeTab, focusSprintId, pathname, router]);
```

### Passo 2 — Atualizar 4 consumers + globais

| Arquivo | Linha | URL atual | URL novo | Mudança extra |
|---|---|---|---|---|
| `src/app/(dashboard)/profile/page.tsx` | 390 | `/sprints/${s.id}/board` | `/projects/${s.projectId}?tab=sprints&sprint=${s.id}` | Adicionar `projectId: string` em `MeSprint` (linha 52); extrair de `t.projectId` ao popular `sprintMap` (linha 148) |
| `src/components/weekly-allocation.tsx` | 310 | `/sprints/${row.sprintId}/board` | `/projects/${row.projectId}?tab=sprints&sprint=${row.sprintId}` | Nenhuma — `WeekSprintRow` já tem `projectId` |
| `src/components/app-shell/page-title/page-title-slot.tsx` | 12 | `"/sprints": "Sprints"` no `STATIC_FALLBACKS` | **deletar entry** | — |
| `src/components/app-shell/page-title/page-title-slot.tsx` | 30+ | `ENTITY_LABEL.sprints: "Sprint"` | **deletar entry** | — |
| `src/components/app-shell/page-title/page-title-slot.tsx` | 39 | regex `/^\/sprints\/[^/]+\/board$/` → "Board do sprint" | **deletar regex** | — |
| ~~`src/lib/agent/agents/alpha/route-context.ts`~~ | — | — | **deixar como está** | `kind: "sprint"` é usado por `context.ts`/`tools.ts`/`index.ts` do Alpha; após drop das pages o regex não casa nada (dead code inofensivo). Limpeza fora do escopo. |

**Sidebar/menu** — caçar links do menu lateral pra `/sprints`:

```bash
grep -rn '"/sprints"\|href="/sprints"' src/components/app-shell src/components/sidebar 2>/dev/null
```

Se houver, remover a entry.

### Passo 3 — Delete pages

```
src/app/(dashboard)/sprints/page.tsx           ← delete
src/app/(dashboard)/sprints/layout.tsx          ← delete
src/app/(dashboard)/sprints/[id]/board/page.tsx ← delete
src/app/(dashboard)/sprints/[id]/               ← delete (pasta vazia)
src/app/(dashboard)/sprints/                    ← delete (pasta vazia)
```

### Validação

```bash
bunx tsc --noEmit
grep -rn '/sprints/\${\|href={`/sprints/\|href="/sprints"' src/ | grep -v "_deprecated\|node_modules"
# resultado esperado: vazio
```

**Manual:** subir `bun dev`:
- Click "Meus Sprints" card no `/profile` → abre `/projects/X?tab=sprints&sprint=Y` com sprint focada
- Click "Abrir board" no widget de weekly-allocation → idem
- Acessar `/sprints` direto → 404 esperado
- Refresh em `/projects/X?tab=sprints&sprint=Y` → mantém tab + sprint focada

### Commit

```bash
bash scripts/sync-main.sh -m "ZRD-JM-NN: cleanup B — drop /sprints kanban + deep-link na page do projeto"
```

---

## Onda C — Refactor pra dropar `Task.acceptanceCriteria(text)`

**Objetivo:** remover toda leitura/escrita da coluna text legacy de AC, sem quebrar features. Pré-requisito pra Onda D.

### Princípio

- `task.acceptanceCriteria` (text) → substituído pela tabela `AcceptanceCriterion` (já existe, já populada).
- ~~`task.type` + `task.scope` → `task.area`~~ — **revisado em 2026-05-01.** `Task.area` já foi dropada (migration `20260501_task_tags.sql` substituiu por `TaskTag`/`TaskTagAssignment`). `task.type` e `task.scope` **permanecem por enquanto** porque alimentam o `suggestFunctionPoints(scope, complexity)` — matriz 4×4 que define FP automático. Sem decisão sobre como FP funciona sem scope (1D? manual? tag-based?), ambos ficam.
- Resultado prático: Onda C cuida só de AC. Onda D dropa só `acceptanceCriteria`.

### Inventário de readers (snapshot 2026-05-01)

#### 1. AC backend writers (param de gravar string `acceptanceCriteria`)

| Arquivo | Linha(s) | Mudança |
|---|---|---|
| `src/components/meetings/meeting-task-action-sheet.tsx` | 547-554, 39, 550-551 | Remover bloco `<Textarea>` "Critérios de aceitação". AC sai do escopo de meeting actions; preenchido via story sheet depois. Remover field do shape. |
| `src/lib/meetings/task-action-executor.ts` | 99 | Remover `acceptanceCriteria: (p.acceptanceCriteria as string) ?? null` do INSERT da `applyCreate`. |
| `src/lib/meetings/task-action-executor.ts` | 136 | Remover `"acceptanceCriteria"` do array `allowed` de `applyUpdate`. |
| `src/lib/agent/tools/manage-tasks.ts` | 84, 118-119 | Remover `acceptanceCriteria` do schema Zod e o `JSON.stringify(...)` no handler. Alpha cria AC via outro fluxo (story sheet ou RPC dedicada). |
| `src/app/api/tasks/[id]/duplicate/route.ts` | 89 | Remover `acceptanceCriteria: source.acceptanceCriteria` do INSERT. Após o INSERT da task, fazer SELECT em `AcceptanceCriterion` (taskId=source.id) e INSERT em batch com novo `taskId`. |
| `src/app/api/tasks/[id]/clone/route.ts` | 114 | Idem ao duplicate. |

**Bug latente que isso conserta:** tasks criadas via meeting/Alpha hoje gravam AC como string mas nunca viram rows na tabela `AcceptanceCriterion`. Logo, abrem no fluxo novo com AC vazio. Após Onda C, AC só nasce via story sheet (que insere na tabela), e duplicate/clone copiam rows reais.

#### 2. Pages que usam components legacy → migrar pra new

| Page | Hoje importa | Decisão |
|---|---|---|
| `src/app/(dashboard)/tasks/page.tsx` | `TaskSheet`, `TaskList` legacy | **Delete** — rota órfã (sem entry no menu, sem links externos). Listagem cross-project já é coberta por `/profile`. |
| `src/app/(dashboard)/profile/page.tsx` | `TaskSheet` legacy | **Migrar** pra `TaskSheet` de `@/components/story-hierarchy`. UI muda (chip TASK_TYPE colorido vira Select texto; FP layout idêntico). |
| `src/app/(dashboard)/design-sessions/[id]/review/page.tsx` | `TaskSheet` legacy + chip `TASK_TYPE` colorido na listagem | **Migrar** pra `TaskSheet` novo. Decidir se mantém chip TASK_TYPE colorido na listagem (registry permanece) ou troca por exibição texto. Recomendação: manter chip por enquanto (estética). |

#### 3. Components/files a deletar

| Arquivo | Razão |
|---|---|
| `src/app/(dashboard)/tasks/page.tsx` | Page órfã (sem nav entry). |
| `src/app/(dashboard)/tasks/` (pasta) | Idem |
| `src/components/task-sheet.tsx` | Após `/profile` e `/design-sessions/[id]/review` migrarem. |
| `src/components/task-list.tsx` | Após `/tasks` deletar. |
| `src/components/design-session/task-preview.tsx` | **Componente órfão** — não importado em lugar nenhum (verificado via grep). |

#### 4. Mantém intacto

| Arquivo | Por que |
|---|---|
| `src/components/story-hierarchy/task-sheet.tsx` | Mantém Tipo/Scope/Complexity (PM decidiu manter por enquanto — FP matriz 4×4 ainda depende). |
| `src/components/story-hierarchy/types.ts` | Mantém `TaskType`/`TaskScope`/`TYPE_VALUES`/`SCOPE_VALUES`. |
| `src/components/story-hierarchy/adapters.ts` | Mantém mapping de `type`/`scope`. |
| `src/lib/github.ts` (`task.scope` no body) | Mantém — coluna ainda existe. |
| `src/lib/agent/agents/alpha/tools.ts` (log de scope) | Mantém. |
| `src/lib/status-chips.ts` (registries `TASK_TYPE`, `SCOPE`) | Mantém — chip ainda usado pela `/design-sessions/[id]/review`. |
| `src/components/sprint/helpers.ts` (linhas 517-518) | Já lê AC como `AC[]` (verificado: usa `.checked`). Sem mudança. |
| `src/app/(dashboard)/projects/[id]/page.tsx` (linhas 791, 794) | Já lê AC como `AC[]`. Sem mudança. |

### Validação

```bash
bunx tsc --noEmit                                    # zero erros

# Zero leitura das colunas legacy (exceto migration files)
grep -rn '\btask\.\(type\|scope\)\b' src/            # vazio
grep -rn '\btask\.acceptanceCriteria\b' src/         # vazio (texto string — AC[] é diferente)
grep -rn '"acceptanceCriteria":\s*[^[]' src/         # vazio (objetos com AC text)

# Components legacy não importados
grep -rn 'from "@/components/task-sheet"' src/       # vazio
grep -rn 'from "@/components/task-list"' src/        # vazio

# Chip registry
grep -rn 'TASK_TYPE\|SCOPE\b' src/                   # vazio
```

**Manual (smoke test em `bun dev`):**

1. **Tasks page** (`/tasks`) — listagem carrega, abre task, edita area/complexity, salva.
2. **Profile** (`/profile`) — abre task pela lista, edita, salva.
3. **Design session review** — abre task gerada, edita.
4. **Project page** (`/projects/<id>`):
   - Abre story → vê AC validados
   - Cria task nova → form sem campos type/scope; tem area; FP calcula só de complexity
   - Duplica task → AC vem da tabela
   - GitHub issue body mostra "Area: X" (não "Scope: X")
5. **Meetings** — task action sheet sem campo AC (AC entra via story).

### Commits (sugestão de splits)

```bash
# Comitar em pedaços pra rastreabilidade
bash scripts/sync-main.sh -m "ZRD-JM-NN: cleanup C1 — types e components story-hierarchy sem type/scope"
bash scripts/sync-main.sh -m "ZRD-JM-NN: cleanup C2 — lib/api refactor (github, alpha, meetings, duplicate, clone)"
bash scripts/sync-main.sh -m "ZRD-JM-NN: cleanup C3 — pages legacy (tasks, profile, design-sessions/review) migram pra NewTaskSheet"
bash scripts/sync-main.sh -m "ZRD-JM-NN: cleanup C4 — drop task-sheet/task-list legacy + TASK_TYPE/SCOPE registry"
```

Ou tudo num commit só, se preferir simplicidade. Recomendação: **3 commits** (C1+C2 juntos, C3 separado, C4 separado).

---

## Onda D — `ALTER TABLE Task DROP COLUMN acceptanceCriteria`

**Objetivo:** remover fisicamente a coluna text legacy de AC. **Irreversível.** `type` e `scope` mantidos.

### Pré-condição obrigatória

```bash
bunx tsc --noEmit                                            # PASSA limpo
grep -rn '\btask\.acceptanceCriteria\b' src/                 # zero hits (texto string)
grep -rn '"acceptanceCriteria":\s*[^[]' src/                 # zero hits (objetos com AC text)
```

Se qualquer um falhar — **não rodar Onda D**. Voltar pra Onda C.

### Backup

```bash
# Backup completo do banco antes do drop irreversível
pg_dump "$DIRECT_URL" > backups/pre-cleanup-D-$(date +%Y%m%d-%H%M).sql
```

### Migration

**Arquivo:** `supabase/migrations/<YYYYMMDD>_drop_task_acceptance_criteria_text.sql`

```sql
-- Drop coluna legacy text de AC após cleanup completo do código.
--
-- Pré-condição: bunx tsc --noEmit passa, grep das colunas é vazio.
-- Backup completo do banco gerado antes do drop.
--
-- Substituto:
--   acceptanceCriteria (text) → tabela AcceptanceCriterion (rows interativos)
--
-- Type e scope NÃO são dropados aqui — alimentam suggestFunctionPoints (matriz 4×4).
-- Cleanup deles fica pra um futuro plano separado, junto com decisão sobre FP matrix.

BEGIN;

ALTER TABLE "Task"
  DROP COLUMN "acceptanceCriteria";

COMMIT;
```

### Rodar

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/<file>.sql
```

### Regen types

```bash
bun run db:types  # ou comando equivalente — verificar package.json
```

### Validação

```sql
\d "Task"
-- Não deve listar acceptanceCriteria, type, scope
```

```bash
bunx tsc --noEmit  # ainda passa (database.types.ts regenerado sem campos)
```

### Commit

```bash
bash scripts/sync-main.sh -m "ZRD-JM-NN: cleanup D — drop Task.acceptanceCriteria/type/scope (irreversível)"
```

### Rollback

**Sem rollback simples.** Precisa restore do backup:

```bash
# Última cartada
psql "$DIRECT_URL" < backups/pre-cleanup-D-<timestamp>.sql
```

---

## Checklist final

Após Onda D:

- [ ] `\d "Task"` não mostra `acceptanceCriteria`, `type`, `scope`
- [ ] `bunx tsc --noEmit` passa
- [ ] `grep -rn 'task\.\(type\|scope\)\|task\.acceptanceCriteria\b' src/` → vazio
- [ ] `grep -rn 'task-sheet\|task-list\|sprint-deploy-panel\|sprint-overview-widget\|page-legacy' src/` → vazio
- [ ] `grep -rn '/sprints/\${\|href="/sprints"\|href={`/sprints/' src/` → vazio
- [ ] Smoke test em 5 fluxos (project page, profile, tasks list, design-session review, meetings action) sem console errors
- [ ] Runbook atualizado: Wave 7 = ✅ completo

---

## Bloqueadores humanos

- Antes de Onda D: PM aprova explicitamente o `DROP COLUMN` (irreversível).
- Durante Onda C: se `tasks/page.tsx` precisar de listagem global complexa, decidir entre adaptar `NewTasksList` ou reescrever simples.
- Se algum smoke test em C falhar: parar e investigar antes de seguir pra D.

---

## Convenções do repo (recap)

- **Migrations** rodam via `psql "$DIRECT_URL" -f ...`, nunca pelo dashboard.
- **Commits** via `bash scripts/sync-main.sh -m "ZRD-JM-NN: <msg>"` — empurra pra origin + staging automático.
- **Após qualquer migration:** regerar `src/lib/supabase/database.types.ts`.
- **Não pular hooks** — se commit falhar, investigar.
