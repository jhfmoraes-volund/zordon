# Capacity Unification Plan

> Plano de execução para unificar a visão de FP/capacity em todo o app.
> Discutido 2026-04-30. Pendência: implementação.

---

## 1. Problema

Hoje, **três telas diferentes mostram três números diferentes** pra "FP do João na Sprint 1 do Zordon":

| Tela | Número | O que mede |
|---|---|---|
| `/profile` widget "esta semana" | **42 / 100 FP** | Carga ativa (só status `todo+in_progress+review+changes_requested`) |
| `/profile` bateria por projeto | **104 / 100 FP** | Promessa contratual (`ProjectMember.fpAllocation` Zordon 54 + Zelar 50) |
| `/sprints/[id]` capacity tab | **246 / 100 FP** | Volume planejado total da sprint (sem filtro — inclui `done` e `backlog`) |

Cada widget escolhe um numerador e um denominador diferentes, sem dizer ao usuário qual conceito está medindo. Resultado: ninguém confia no número, e o PM não consegue defender alocação real.

### Os 4 conceitos misturados

| # | Conceito | Source of truth | Exemplo João hoje |
|---|---|---|---|
| **A** | **Capacity semanal** — quanto cabe numa semana de trabalho útil | `Member.fpCapacity` | 100 FP |
| **B** | **Acordo contratual** — promessa de alocação por projeto | `ProjectMember.fpAllocation` | Zordon 54 + Zelar 50 = 104 FP |
| **C** | **Carga em aberto** — FP de tasks não-feitas atribuídas | view `sprint_member_capacity.fp_used` | 42 FP |
| **D** | **Volume planejado** — FP totais da sprint | `Task.functionPoints` agregado | 246 FP (com backlog) / 231 FP (sem backlog) |

---

## 2. Decisões fechadas

| # | Decisão | Justificativa |
|---|---|---|
| 1 | **Métrica primária = planejado da sprint, status ≠ `backlog`** | Backlog é "pode entrar", não "comprometido"; demais status (incluindo `done`) representam o que foi planejado pra sprint |
| 2 | **Semana continua sendo a unidade de bucketing** | Multi-sprint na mesma semana (membros em vários projetos); preparação pra sprints de 15 dias no futuro |
| 3 | **Acordo contratual continua existindo como referência inline** | PM precisa defender "membro tá em overcommit do contrato" ou "membro tá ocioso, podemos puxar trabalho" |
| 4 | **Overcommit é permitido** | Sinaliza visualmente (`>100%`) mas não bloqueia |
| 5 | **Filtro de status padronizado: `≠ backlog`** | Mesma regra em view, APIs, dashboard, widgets |
| 6 | **Capacity = 5 dias úteis (seg–sex), exibido na referência seg–dom** | `fpCapacity` representa esforço útil; widget mostra a janela seg→dom só pra contexto visual |

---

## 3. Vocabulário final

Pra evitar futuras ambiguidades, padronizamos os 4 conceitos como:

| Termo | Símbolo na UI | Source SQL | Status incluídos |
|---|---|---|---|
| **Capacity semanal** | `fpCapacity` | `Member.fpCapacity` | n/a |
| **Acordo contratual** | `fpContract` | `ProjectMember.fpAllocation` | n/a |
| **Planejado da sprint** | `fpPlanned` | `sprint_member_capacity.fp_planned` | `done + todo + in_progress + review + changes_requested` |
| **Em aberto** | `fpOpen` | `sprint_member_capacity.fp_open` | `todo + in_progress + review + changes_requested` |
| **Entregue** | `fpDone` | `sprint_member_capacity.fp_done` | `done` |

**Invariante:** `fpPlanned = fpDone + fpOpen` (sempre).

**Override de sprint:** `SprintMember.fpAllocation` continua sobrescrevendo `ProjectMember.fpAllocation` quando presente — via `COALESCE`.

---

## 4. Mockups finais

### 4.1 `/profile` — visão pessoal da semana atual

```
┌─ Capacity ──────────────────────────────────── [Ver detalhes ↗] ─┐
│                                                                   │
│ ESTA SEMANA   (27/abr–03/mai · seg→dom · 5 dias úteis)            │
│ ████████████████████████████████░░░░░  231 / 100 FP    2.3×      │
│ ▓ entregue 189   ▒ em aberto 42                                   │
│                                                                   │
│ POR PROJETO                                                       │
│ ┌─────────────────────────────────────────────────────────────┐  │
│ │ Zordon   ████████████████████  231 FP · contrato 54 ⚠️ +4.3× │  │
│ │          ▓ 189 entregue · ▒ 42 em aberto                    │  │
│ ├─────────────────────────────────────────────────────────────┤  │
│ │ Zelar    ░░░░░░░░░░░░░░░░░░░░    0 FP · contrato 50 💤 ocioso│  │
│ └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│ 1 sprint ativa · Zordon Sprint 1 (27/abr–01/mai)                  │
└───────────────────────────────────────────────────────────────────┘
```

**Leituras:**
- `231/100 FP` → trabalho planejado essa semana vs capacidade
- `189 entregue / 42 em aberto` → burndown
- `2.3×` → overcommit (ok, permitido)
- `Zordon: contrato 54, planejado 231, +4.3×` → "PM extrapolou o contrato dele em Zordon"
- `Zelar: contrato 50, planejado 0, ocioso` → "PM tem 50 FP livres em Zelar pra puxar trabalho"

### 4.2 `/profile/capacity` — detalhado, multi-semana

```
ACORDO CONTRATUAL                                        104 / 100 FP
█████████████████████████████████████████░░  Zordon 54 · Zelar 50

ALOCAÇÃO POR SEMANA
┌─ Sem 27/abr–03/mai (atual) ─────────────────── 231 / 100 FP  2.3× ─┐
│ ████████████████████████████  ▓189 ▒42                              │
│   • Zordon Sprint 1   231 FP  (contrato 54)                         │
└─────────────────────────────────────────────────────────────────────┘
┌─ Sem 04/mai–10/mai ─────────────────────────────── 0 / 100 FP ─────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░                                        │
│   • Zordon Sprint 2 (planning) — sem tasks atribuídas               │
└─────────────────────────────────────────────────────────────────────┘
```

**Diferenças vs widget de `/profile`:**
- Header fixo com acordo contratual no topo
- Múltiplas semanas com prorata
- Cada semana lista quais sprints contribuem
- Mantém o componente `WeeklyAllocation` (apenas troca o numerador)

### 4.3 `/sprints/[id]` aba Capacity — visão da sprint inteira

```
SPRINT 1 — ZORDON (27/abr → 01/mai · active · 5 dias úteis)

┌─ Capacity por membro ──────────────────────────────────────────────┐
│ João Moraes        ████████████████████████  231 / 100 FP  2.3×    │
│                    ▓189 ▒42 · contrato 54 · ⚠️ overcommit          │
│ Outro membro       ███████░░░░░░░░░░░░░░░░░   45 / 100 FP  0.5×    │
│                    ▓20 ▒25 · contrato 60 · saudável                │
└────────────────────────────────────────────────────────────────────┘
```

Resolve o `246/100`: vira `231/100` (filtra backlog) com burndown explícito e contrato lado a lado.

---

## 5. Mudanças no banco

### 5.1 Migration: `supabase/migrations/20260430_fp_capacity_metrics.sql`

```sql
-- Recria sprint_member_capacity com fp_planned, fp_done, fp_open
-- e renomeia fp_used → fp_open pra deixar a semântica explícita

DROP VIEW IF EXISTS sprint_member_capacity CASCADE;

CREATE VIEW sprint_member_capacity AS
SELECT
  s.id AS "sprintId",
  pm."memberId",
  m.name AS member_name,
  s."projectId",
  COALESCE(sm."fpAllocation", pm."fpAllocation") AS fp_allocation,

  -- planejado: tudo menos backlog (= métrica primária)
  COALESCE((
    SELECT SUM(t."functionPoints")
    FROM "Task" t
    JOIN "TaskAssignment" ta ON ta."taskId" = t.id
    WHERE t."sprintId" = s.id
      AND ta."memberId" = pm."memberId"
      AND t.status <> 'backlog'
  ), 0)::int AS fp_planned,

  -- entregue
  COALESCE((
    SELECT SUM(t."functionPoints")
    FROM "Task" t
    JOIN "TaskAssignment" ta ON ta."taskId" = t.id
    WHERE t."sprintId" = s.id
      AND ta."memberId" = pm."memberId"
      AND t.status = 'done'
  ), 0)::int AS fp_done,

  -- em aberto (= antigo fp_used)
  COALESCE((
    SELECT SUM(t."functionPoints")
    FROM "Task" t
    JOIN "TaskAssignment" ta ON ta."taskId" = t.id
    WHERE t."sprintId" = s.id
      AND ta."memberId" = pm."memberId"
      AND t.status IN ('todo', 'in_progress', 'review', 'changes_requested')
  ), 0)::int AS fp_open,

  sm."fpAllocation" IS NOT NULL AS has_sprint_override

FROM "Sprint" s
JOIN "ProjectMember" pm ON pm."projectId" = s."projectId"
JOIN "Member" m ON m.id = pm."memberId"
LEFT JOIN "SprintMember" sm ON sm."sprintId" = s.id AND sm."memberId" = pm."memberId";

-- sprint_capacity_overview: agrega por sprint
DROP VIEW IF EXISTS sprint_capacity_overview CASCADE;

CREATE VIEW sprint_capacity_overview AS
SELECT
  "sprintId",
  SUM(fp_allocation)::int AS capacity,
  SUM(fp_planned)::int    AS planned,
  SUM(fp_done)::int       AS done,
  SUM(fp_open)::int       AS open
FROM sprint_member_capacity
GROUP BY "sprintId";
```

**Como rodar:**
```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/20260430_fp_capacity_metrics.sql
```

### 5.2 Regen de tipos

Após a migration:
```bash
npx supabase gen types typescript --project-id ugvqlmapqlobigkjboae > src/lib/supabase/database.types.ts
```

### 5.3 Decisão de dias úteis

**Não há mudança de schema.** A semântica fica documentada:

- `Member.fpCapacity` = capacidade pra **5 dias úteis** (seg–sex)
- A janela visual da semana é **seg–dom** (7 dias corridos), só pra referência
- `bucketSprintsByWeek` continua usando dias corridos no `overlapDays` (sprints normais alinhadas seg→sex caem inteiras numa semana → ratio = 1.0; sprints longas que cruzam fim de semana ainda funcionam corretamente)
- Se no futuro precisarmos prorata por dias úteis, adicionar `overlapBusinessDays` — fora do escopo atual

---

## 6. Mudanças no backend

### 6.1 `src/app/api/profile/capacity/route.ts`

Trocar query do view e shape de retorno:

```ts
// antes
.select("sprintId, projectId, fp_allocation, fp_used, has_sprint_override")

// depois
.select("sprintId, projectId, fp_allocation, fp_planned, fp_done, fp_open, has_sprint_override")
```

E no map:
```ts
sprints: [...{
  fpAllocation: Number(sc.fp_allocation) || 0,
  fpPlanned:    Number(sc.fp_planned) || 0,   // novo
  fpDone:       Number(sc.fp_done) || 0,      // novo
  fpOpen:       Number(sc.fp_open) || 0,      // novo (renomeado de fpUsed)
  hasOverride:  Boolean(sc.has_sprint_override),
}]
```

### 6.2 `src/app/api/members/[id]/capacity/route.ts`

Mesma mudança — espelha o shape de `/profile/capacity`.

### 6.3 `src/app/api/sprints/route.ts`

Filtrar `members[].fpAllocated` por status ≠ `backlog`:

```ts
// antes: soma TODOS os FP atribuídos (inclui done E backlog → 246)
const fpAllocated = tasks
  .filter(t => assignments.includes(memberId))
  .reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);

// depois: só status ≠ backlog (= fpPlanned)
const fpPlanned = tasks
  .filter(t => t.status !== 'backlog' && assignments.includes(memberId))
  .reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);
```

Renomear retorno: `members[].fpAllocated` → `members[].fpPlanned` (e atualizar consumidores).

### 6.4 `src/app/(dashboard)/page.tsx` (dashboard team)

Renomear `ACTIVE_STATUSES` → `OPEN_STATUSES` e **incluir `changes_requested`** (hoje só tem `todo+in_progress+review`):

```ts
const OPEN_STATUSES = ['todo', 'in_progress', 'review', 'changes_requested'] as const;
```

Lógica de overload/idle mantida (essa regra usa "em aberto", não "planejado" — alerta deve ser sobre trabalho restante).

---

## 7. Mudanças no frontend

### 7.1 `src/lib/weekBuckets.ts`

Estender `SprintInput` e `WeekSprintRow`:

```ts
// SprintInput ganha 3 campos
export type SprintInput = {
  // ...existentes
  fpAllocation: number;
  fpPlanned: number;     // novo
  fpDone: number;        // novo
  fpOpen: number;        // novo (renomeado de fpUsed)
  hasOverride: boolean;
};

// WeekSprintRow ganha o equivalente prorateado
export type WeekSprintRow = {
  // ...existentes
  fpAllocationWeek: number;
  fpPlannedWeek: number;  // novo (prorata de fpPlanned)
  fpDoneWeek: number;     // novo
  fpOpenWeek: number;     // novo (renomeado de fpUsedWeek)
};

// WeekBucket totals
export type WeekBucket = {
  // ...
  totalAllocation: number;
  totalPlanned: number;   // novo (= métrica primária do widget)
  totalDone: number;      // novo
  totalOpen: number;      // novo (renomeado de totalUsed)
};
```

Aplicar prorata aos três campos novos no loop.

### 7.2 `src/components/member-battery.tsx`

Adicionar prop opcional `done` pra renderizar barra empilhada (▓ done + ▒ open) dentro da bateria:

```tsx
type Props = {
  capacity: number;
  committed: number;
  done?: number;           // novo — quanto do committed já foi entregue
  breakdown?: BatterySegment[];
  // ...
};
```

Quando `done` definido: renderiza barra com 2 cores (verde sólido pra `done`, verde claro pra `committed - done`).

### 7.3 `src/components/weekly-allocation.tsx`

Trocar numerador:
- Antes: usa `bucket.totalUsed` como métrica primária
- Depois: usa `bucket.totalPlanned`; mostra `totalDone`/`totalOpen` na sub-barra

### 7.4 `src/app/(dashboard)/profile/page.tsx` — `CapacityCard`

Reescrever conforme mockup 4.1:
- Linha 1: bateria principal com `fpPlanned` empilhado (`fpDone` + `fpOpen`)
- Linha 2: lista de projetos com barra individual + `fpPlanned` + `fpContract` + flag (overcommit/ocioso/saudável)
- Linha 3: contagem de sprints ativas com nomes

Substituir o `weekUsed`/`weekActiveSprints` por `weekPlanned`/`weekDone`/`weekOpen` derivados do bucket atual.

### 7.5 `src/components/project-capacity-tab.tsx`

Refatorar pra puxar dados direto da view `sprint_member_capacity` (em vez de calcular em JS misturando filtros):

- `fpPlanned` da view — não somar manualmente Task.functionPoints
- Cores baseadas em `fpPlanned / fpCapacity`
- Mostrar `fpContract` (= `fpAllocation`) inline ao lado do `fpPlanned`

### 7.6 `src/app/(dashboard)/profile/capacity/page.tsx`

Header novo de "Acordo contratual" (4.2) usando `commitment.committed` / `commitment.capacity`.

---

## 8. Ordem de execução (commitável passo a passo)

| # | Passo | Arquivos | Commit |
|---|---|---|---|
| 1 | Migration SQL — recria views | `supabase/migrations/20260430_fp_capacity_metrics.sql` | `feat(db): unify capacity metrics — fp_planned/done/open` |
| 2 | Regen de tipos | `src/lib/supabase/database.types.ts` | `chore(types): regen after capacity migration` |
| 3 | API capacity (`/profile`, `/members/[id]`) | 2 routes | `feat(api): expose fp_planned/done/open in capacity endpoints` |
| 4 | API sprints — filtrar backlog | `src/app/api/sprints/route.ts` | `fix(api): exclude backlog from sprint capacity totals` |
| 5 | `weekBuckets.ts` — estender shape | `src/lib/weekBuckets.ts` | `refactor(capacity): add planned/done/open to week buckets` |
| 6 | `MemberBattery` — prop `done` | `src/components/member-battery.tsx` | `feat(ui): stacked battery for done vs open FP` |
| 7 | `CapacityCard` em `/profile` | `src/app/(dashboard)/profile/page.tsx` | `feat(profile): unified capacity card with project breakdown` |
| 8 | `WeeklyAllocation` + `/profile/capacity` | 2 arquivos | `feat(capacity): weekly allocation uses fp_planned with done/open split` |
| 9 | `ProjectCapacityTab` + `/sprints/[id]` | 2 arquivos | `refactor(capacity): sprint tab reads from view, contract inline` |
| 10 | Dashboard `OPEN_STATUSES` rename | `src/app/(dashboard)/page.tsx` | `refactor(dashboard): rename ACTIVE_STATUSES to OPEN_STATUSES, include changes_requested` |
| 11 | Limpeza — remover `fpUsed`/`totalUsed` antigos | múltiplos | `chore(capacity): remove deprecated fpUsed alias` |

Cada passo é independente e quebra mínima entre eles. Passos 1–4 são backend-only (UI continua funcionando com fallback). Passos 5–10 são frontend incremental.

---

## 9. Critério de pronto

- [ ] `/profile` mostra `231 / 100 FP` pro João, com Zordon `231 FP · contrato 54 ⚠️ +4.3×` e Zelar `0 FP · contrato 50 💤 ocioso`
- [ ] `/profile/capacity` mostra header de acordo contratual + breakdown semanal com sub-barras done/open
- [ ] `/sprints/c3e38650.../board` aba capacity mostra `231 / 100 FP` pro João (não 246, não 42, não 104)
- [ ] Dashboard team capacity inclui `changes_requested` no detector de overload/idle
- [ ] Search global `grep -r "fpUsed\|totalUsed\|fp_used"` retorna zero matches em `src/`
- [ ] Tipos do Postgres regenerados em `database.types.ts`
- [ ] Sem regressão nas Sprints 2/3/4 (planning) — devem mostrar `0 / 100 FP` (todas as tasks delas estão em backlog)

---

## 10. Notas pra execução futura

- O `fp_used` da view antiga **continuou sendo carga em aberto** o tempo todo, só foi mal-nomeado. Renomear pra `fp_open` evita futuras confusões.
- A view `sprint_capacity_overview` já existia mas alimentava só o widget de time do dashboard. Após a migration, ela vira a fonte canônica pra QUALQUER agregação por sprint (não somar Task.functionPoints em JS).
- `Member.fpCapacity` continua como capacidade semanal nominal (5 dias úteis). Se futuramente quisermos modular por `dedicationPercent`, isso é trivial (`effectiveCapacity = fpCapacity * dedicationPercent / 100`) — fora do escopo atual.
- Backlog **fora** da métrica é decisão consciente: backlog atribuído é "intenção de trabalho", não compromisso. Se um dia quisermos mostrar "intenção total" (planejado + backlog), adicionar `fp_intended` na view sem alterar `fp_planned`.
