# Capacity Unification Plan — V2

> Plano de execução para unificar a visão de FP/capacity em todo o app.
> V1 discutido 2026-04-30. V2 reescrito 2026-04-30 após auditoria completa.
> Alpha (agente) ficou **fora de escopo** — tratado em plano separado.

---

## 1. Problema

Hoje, **três telas mostram três números diferentes** pra "FP do João na Sprint 1 do Zordon":

| Tela | Número | O que mede |
|---|---|---|
| `/profile` widget "esta semana" | **42 / 100 FP** | Carga ativa (`todo+in_progress+review+changes_requested`) |
| `/profile` bateria por projeto | **104 / 100 FP** | Promessa contratual (`ProjectMember.fpAllocation` 54+50) |
| `/sprints/[id]` capacity tab | **246 / 100 FP** | Volume planejado total da sprint (sem filtro — inclui `done` e `backlog`) |

E ainda existem outros pontos espalhados que somam mais um quarto e quinto número:

| Tela extra | Número | Por que diverge |
|---|---|---|
| `/sprints` (lista) coluna FP | **246 / 100 FP** | Mesmo bug do `/sprints/[id]` |
| `/projects/[id]` aba schedule | **231 / 100 FP** | Soma manual no client, sem filtro consistente |
| Dashboard "Capacity do Time" | **? / 50 FP** (capacity / 2) | Bucketiza por **`task.dueDate`**, não por sprint, e divide capacity por 2 (sprint quinzenal antiga) — duas inconsistências |

Resultado: ninguém confia no número, e o PM não consegue defender alocação real.

### Os 4 conceitos misturados

| # | Conceito | Source of truth | Bucketing | Exemplo João |
|---|---|---|---|---|
| **A** | **Capacity semanal** — quanto cabe | `Member.fpCapacity` | n/a | 100 FP |
| **B** | **Acordo contratual** — promessa por projeto | `ProjectMember.fpAllocation` | n/a | Zordon 54 + Zelar 50 = 104 FP |
| **C** | **Em aberto** — FP não-feitos atribuídos | view `sprint_member_capacity.fp_open` | sprint | 42 FP |
| **D** | **Planejado da sprint** — FP totais comprometidos | view `sprint_member_capacity.fp_planned` | sprint | 231 FP |

**Sobre o `team-capacity-widget` do dashboard:** hoje ele bucketiza por `task.dueDate` e divide capacity por 2 — duas decisões herdadas que confundem (parece um quinto conceito mas não é). V2 unifica: o widget vira **sprint-based** como o resto do app, mostrando `fpPlanned` (D) vs `fpContract` (B) vs `fpCapacity` (A) por membro. Quando um membro tem várias sprints ativas na mesma semana, soma. Tasks sem `dueDate` deixam de existir como caso especial — ou estão numa sprint (conta) ou em backlog (não conta).

---

## 2. Decisões fechadas

| # | Decisão | Justificativa |
|---|---|---|
| 1 | **Métrica primária = `fpPlanned` (status ≠ `backlog`)** | Backlog é "pode entrar", não "comprometido"; demais status (incluindo `done`) representam o que foi planejado pra sprint |
| 2 | **Semana continua sendo a unidade de bucketing** | Multi-sprint na mesma semana; preparação pra sprints de 15 dias |
| 3 | **Acordo contratual continua existindo como referência inline** | PM precisa defender overcommit/ociosidade |
| 4 | **Overcommit é permitido** | Sinaliza visualmente (`>100%`) mas não bloqueia |
| 5 | **Filtro de status padronizado: `≠ backlog`** | Mesma regra em view, APIs, dashboard, widgets |
| 6 | **Capacity = 5 dias úteis (seg–sex), exibido na referência seg–dom** | `fpCapacity` representa esforço útil; widget mostra seg→dom só pra contexto |
| 7 | **`OPEN_STATUSES` central inclui `changes_requested`** | Hoje TS tem 3 status, SQL tem 4 — divergência. SQL é fonte de verdade |
| 8 | **Conceito E (FP-com-prazo) ganha nome próprio: `fpDue`** | Mantém o widget útil sem confundir com `fpPlanned` |
| 9 | **Agente Alpha fora de escopo desta V2** | 8+ pontos de leitura; tratar em plano dedicado depois que vocabulário estabilizar |

---

## 3. Vocabulário final

| Termo | Símbolo na UI/código | Source SQL/TS | Status incluídos | Bucketing |
|---|---|---|---|---|
| **Capacity semanal** | `fpCapacity` | `Member.fpCapacity` | n/a | n/a |
| **Acordo contratual** | `fpContract` | `ProjectMember.fpAllocation` | n/a | n/a |
| **Planejado da sprint** | `fpPlanned` | `sprint_member_capacity.fp_planned` | `done + todo + in_progress + review + changes_requested` | sprint |
| **Em aberto** | `fpOpen` | `sprint_member_capacity.fp_open` | `todo + in_progress + review + changes_requested` | sprint |
| **Entregue** | `fpDone` | `sprint_member_capacity.fp_done` | `done` | sprint |
| **Com prazo na janela** | `fpDue` | `Task.dueDate` agregado em JS | `OPEN_STATUSES` (i.e. ≠ `done` e ≠ `backlog`) | data |

**Invariantes:**
- `fpPlanned = fpDone + fpOpen` (sempre, por construção da view)
- `fpDue` ⊥ `fpPlanned` — eixos diferentes (data vs sprint), comparáveis mas independentes

**Override de sprint:** `SprintMember.fpAllocation` continua sobrescrevendo `ProjectMember.fpAllocation` quando presente — via `COALESCE`.

**Constante única `OPEN_STATUSES`** vive em `src/lib/function-points.ts`:
```ts
export const OPEN_STATUSES = ['todo', 'in_progress', 'review', 'changes_requested'] as const;
```
A view SQL e todo TS importam dessa lista. `ACTIVE_STATUSES` é removido (alias deprecated).

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

### 4.2 `/profile/capacity` — detalhado, multi-semana

```
ACORDO CONTRATUAL                                        104 / 100 FP
█████████████████████████████████████████░░  Zordon 54 · Zelar 50

ALOCAÇÃO POR SEMANA
┌─ Sem 27/abr–03/mai (atual) ─────────────────── 231 / 100 FP  2.3× ─┐
│ ████████████████████████████  ▓189 ▒42                              │
│   • Zordon Sprint 1   231 FP  (contrato 54)                         │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 `/sprints/[id]` aba Capacity — visão da sprint inteira

```
SPRINT 1 — ZORDON (27/abr → 01/mai · active · 5 dias úteis)

┌─ Capacity por membro ──────────────────────────────────────────────┐
│ João Moraes        ████████████████████████  231 / 100 FP  2.3×    │
│                    ▓189 ▒42 · contrato 54 · ⚠️ overcommit          │
└────────────────────────────────────────────────────────────────────┘
```

### 4.4 Dashboard "Capacity do Time" — explicitando o conceito E

```
┌─ Capacity do Time ─────────────────────────────────────────────┐
│ FP com prazo nesta e próxima semana (dueDate) vs 50 FP/semana  │
│                                                                 │
│ João Moraes                                                     │
│  Vence essa semana    ███████████████░░░░  42 / 50 FP (3 tasks) │
│  Vence próx semana    ████░░░░░░░░░░░░░░    8 / 50 FP (1 task)  │
└─────────────────────────────────────────────────────────────────┘
```

Diferenças vs widget de `/profile`:
- Label "vence" em vez de "esta semana" (deixa o conceito E explícito)
- Subtítulo do card cita "(dueDate)" pra distinguir de bucketing por sprint

---

## 5. Mudanças no banco

### 5.1 Migration: `supabase/migrations/20260430_fp_capacity_metrics.sql`

```sql
-- Recria sprint_member_capacity com fp_planned/fp_done/fp_open via FILTER
-- (1 scan por par sprint/member, em vez de 3 subqueries correlacionadas)

DROP VIEW IF EXISTS sprint_capacity_overview CASCADE;
DROP VIEW IF EXISTS sprint_member_capacity CASCADE;

CREATE VIEW sprint_member_capacity AS
SELECT
  s.id                                                AS "sprintId",
  pm."memberId",
  m.name                                              AS member_name,
  s."projectId",
  COALESCE(sm."fpAllocation", pm."fpAllocation")::int AS fp_allocation,
  COALESCE(agg.fp_planned, 0)::int                    AS fp_planned,
  COALESCE(agg.fp_done, 0)::int                       AS fp_done,
  COALESCE(agg.fp_open, 0)::int                       AS fp_open,
  (sm."fpAllocation" IS NOT NULL)                     AS has_sprint_override
FROM "Sprint" s
JOIN "ProjectMember" pm ON pm."projectId" = s."projectId"
JOIN "Member" m ON m.id = pm."memberId"
LEFT JOIN "SprintMember" sm
  ON sm."sprintId" = s.id AND sm."memberId" = pm."memberId"
LEFT JOIN LATERAL (
  SELECT
    SUM(t."functionPoints") FILTER (WHERE t.status <> 'backlog') AS fp_planned,
    SUM(t."functionPoints") FILTER (WHERE t.status = 'done') AS fp_done,
    SUM(t."functionPoints") FILTER (
      WHERE t.status IN ('todo','in_progress','review','changes_requested')
    ) AS fp_open
  FROM "Task" t
  JOIN "TaskAssignment" ta ON ta."taskId" = t.id
  WHERE t."sprintId" = s.id AND ta."memberId" = pm."memberId"
) agg ON true;

GRANT SELECT ON sprint_member_capacity TO service_role, authenticated;

-- sprint_capacity_overview: agrega por sprint a partir da view acima.
-- Mantém colunas legadas (capacity) e adiciona planned/done/open.
CREATE VIEW sprint_capacity_overview AS
SELECT
  "sprintId",
  SUM(fp_allocation)::int AS capacity,
  SUM(fp_planned)::int    AS planned,
  SUM(fp_done)::int       AS done,
  SUM(fp_open)::int       AS open
FROM sprint_member_capacity
GROUP BY "sprintId";

GRANT SELECT ON sprint_capacity_overview TO service_role, authenticated;
```

**Notas estruturais:**
- `LATERAL` + `FILTER` agrega num único scan por par (sprint, member). Substitui 3 subselects correlacionados do plano V1.
- Invariante `fp_planned = fp_done + fp_open` garantida desde que todos os status estejam em `{backlog, todo, in_progress, review, changes_requested, done}`. Se um novo status for adicionado, atualizar a view e a constante TS no mesmo PR.
- `sprint_capacity_overview.capacity` continua sendo soma de `fpAllocation` (conceito B agregado por sprint, ou seja: contrato dos membros do projeto). **Não é** soma de `Member.fpCapacity`.

**Como rodar:**
```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/20260430_fp_capacity_metrics.sql
```

### 5.2 Regen de tipos

```bash
npx supabase gen types typescript --project-id ugvqlmapqlobigkjboae > src/lib/supabase/database.types.ts
```

### 5.3 Views vizinhas (mantidas como estão)

- `member_commitment_overview` (em `20260423_fp_allocation_model.sql`) — continua canônica pro **conceito B** (acordo contratual = soma de `ProjectMember.fpAllocation` por membro).
- `member_capacity_overview` (em `rls-setup.sql`) — continua canônica pro **conceito A** (capacity nominal por membro).
- Não tocar nessas duas. Documentar no plano qual conceito cada uma representa pra evitar reinvenção.

### 5.4 Decisão de dias úteis

Sem mudança de schema. Semântica documentada:
- `Member.fpCapacity` = capacidade pra **5 dias úteis** (seg–sex).
- Janela visual da semana é seg–dom (7 dias corridos), só pra referência.
- `bucketSprintsByWeek` continua usando dias corridos no `overlapDays`.
- Se no futuro precisar prorata por dias úteis: adicionar `overlapBusinessDays` — fora do escopo.

---

## 6. Cobertura completa — matriz de impacto

Todos os pontos do app que tocam capacity hoje, com a ação no plano:

### 6.1 Backend (APIs)

| Arquivo | Conceito hoje | Ação V2 |
|---|---|---|
| `src/app/api/profile/capacity/route.ts` | C (`fp_used`) | Renomear → `fp_planned/fp_done/fp_open` |
| `src/app/api/members/[id]/capacity/route.ts` | C | Idem |
| `src/app/api/members/commitments/route.ts` | A+B (commitments view) | **Sem mudança** — view mantida |
| `src/app/api/sprints/route.ts` | D ambíguo (soma todos os status) | Filtrar status ≠ `backlog`, renomear `fpAllocated` → `fpPlanned` |
| `src/app/api/sprints/[id]/members/[memberId]/route.ts` | B (override) | **Sem mudança** |
| `src/app/api/me/route.ts` | C (`ACTIVE_STATUSES`) | Trocar pra `OPEN_STATUSES`, renomear `fpAllocated` → `fpOpen` |
| `src/app/api/members/route.ts` | C | Idem |
| `src/app/api/projects/[id]/route.ts` | C | Idem (filter + rename) |
| `src/app/api/projects/[id]/schedule/route.ts` | task aggregates | Validar uso; alinhar `totalFp/fpDone` com vocabulário (`fpPlanned/fpDone`) |

### 6.2 Frontend (componentes)

| Arquivo | Conceito hoje | Ação V2 |
|---|---|---|
| `src/components/member-battery.tsx` | A+B | Adicionar prop `done` para barra empilhada (▓ done + ▒ open) |
| `src/components/weekly-allocation.tsx` | C (`fpUsed`) | Trocar numerador → `fpPlanned`; sub-barra `fpDone/fpOpen` |
| `src/components/capacity-widget.tsx` | A+B | Sem mudança estrutural; revisar labels |
| `src/components/team-capacity-widget.tsx` | **E (dueDate)** | Renomear props/labels: `fpThisWeek` → `fpDueThisWeek`, label "Vence essa semana" |
| `src/components/project-capacity-tab.tsx` | misturado | Refatorar pra ler `sprint_member_capacity.fp_planned` direto da view |
| `src/components/sprint-overview-widget.tsx` | D ambíguo | Consumir `fpPlanned` da `/api/sprints` (após fix backend) |
| `src/components/ui/pixel-bar.tsx` | agnóstico | Sem mudança |

### 6.3 Frontend (páginas)

| Arquivo | O que renderiza | Ação V2 |
|---|---|---|
| `src/app/(dashboard)/page.tsx` | Dashboard team | Migrar `cap.allocated` → `cap.planned`; renomear `ACTIVE_STATUSES` → `OPEN_STATUSES` (importar do central) |
| `src/app/(dashboard)/profile/page.tsx` | CapacityCard | Reescrever conforme mockup 4.1; **remover** const local `ACTIVE_STATUSES` (linha 100) |
| `src/app/(dashboard)/profile/capacity/page.tsx` | Detalhe multi-semana | Header de contrato + sub-barras done/open |
| `src/app/(dashboard)/sprints/page.tsx` | Lista de sprints | Renomear `fpAllocated` → `fpPlanned` (vem da API) |
| `src/app/(dashboard)/sprints/[id]/board/page.tsx` | Board kanban | Validar uso de capacity tab |
| `src/app/(dashboard)/projects/[id]/page.tsx` | Projeto detalhe | Atualizar 2 seções de barra (linhas 1222, 1286) — alinhar com `fpPlanned` |
| `src/app/(dashboard)/members/page.tsx` | Lista membros | Renomear `fpUsedWeek` → `fpPlannedWeek`; mudar query da view (`fp_open` ou `fp_planned`?) — decisão: **`fp_planned`** (consistente com primária) |
| `src/app/(dashboard)/members/[id]/page.tsx` | Detalhe membro | Espelhar `/profile` (mockup 4.1) |
| `src/app/(onboarding)/.../sprints-scene.tsx` | Demo mockada | Atualizar labels só se virem dissonantes |

### 6.4 Bibliotecas TS

| Arquivo | Ação V2 |
|---|---|
| `src/lib/function-points.ts` | **Renomear** `ACTIVE_STATUSES` → `OPEN_STATUSES`; **incluir** `changes_requested`; manter alias `ACTIVE_STATUSES` deprecado por 1 commit pra facilitar migração |
| `src/lib/weekBuckets.ts` | Estender `SprintInput` e `WeekSprintRow` com `fpPlanned/fpDone/fpOpen`; aplicar prorata |
| `src/lib/capacity.ts` | Sem mudança (calcula sugestão de capacity) |
| `src/lib/supabase/database.types.ts` | Regenerar |
| `src/lib/supabase/types.ts` | Sem mudança |

### 6.5 Fora de escopo

- **`src/lib/agent/agents/alpha/{context,tools,prompt}.ts`** — 8+ queries em views, prompt do system, ferramentas que retornam números. Tratar em plano dedicado **após** essa V2 estabilizar e o vocabulário estar consolidado nas views.

---

## 7. Constante `OPEN_STATUSES` — passo dedicado

Hoje há **divergência silenciosa**:
- TS (`ACTIVE_STATUSES` em `function-points.ts`) = 3 status: `todo+in_progress+review`
- SQL (`sprint_member_capacity.fp_used`) = 4 status: `todo+in_progress+review+changes_requested`

A SQL é a fonte de verdade. Migrar o TS:

1. Em `src/lib/function-points.ts`:
```ts
export const OPEN_STATUSES = [
  'todo', 'in_progress', 'review', 'changes_requested',
] as const;

/** @deprecated use OPEN_STATUSES — será removido após migração */
export const ACTIVE_STATUSES = OPEN_STATUSES;
```

2. Atualizar imports nos seguintes arquivos:
   - `src/app/api/me/route.ts`
   - `src/app/api/members/route.ts`
   - `src/app/api/projects/[id]/route.ts`
   - `src/app/(dashboard)/page.tsx`
   - `src/app/(dashboard)/profile/page.tsx` (e remover const local!)

3. Commit final: deletar o alias deprecado.

---

## 8. Mudanças no frontend — detalhes

### 8.1 `src/lib/weekBuckets.ts`

```ts
export type SprintInput = {
  // ...existentes
  fpAllocation: number;
  fpPlanned: number;     // novo
  fpDone: number;        // novo
  fpOpen: number;        // novo (renomeado de fpUsed)
  hasOverride: boolean;
};

export type WeekSprintRow = {
  // ...existentes
  fpAllocationWeek: number;
  fpPlannedWeek: number;  // novo
  fpDoneWeek: number;     // novo
  fpOpenWeek: number;     // novo
};

export type WeekBucket = {
  // ...
  totalAllocation: number;
  totalPlanned: number;   // novo (= métrica primária do widget)
  totalDone: number;
  totalOpen: number;
};
```

Aplicar prorata aos três campos novos no loop.

### 8.2 `src/components/member-battery.tsx`

```tsx
type Props = {
  capacity: number;
  committed: number;
  done?: number;          // novo — quanto do committed já foi entregue
  breakdown?: BatterySegment[];
};
```

Quando `done` definido: barra com 2 cores (sólida pra `done`, clara pra `committed - done`).

### 8.3 `src/components/weekly-allocation.tsx`

- Antes: usa `bucket.totalUsed` como métrica primária
- Depois: usa `bucket.totalPlanned`; mostra `totalDone`/`totalOpen` na sub-barra

### 8.4 `src/components/team-capacity-widget.tsx` (conceito E)

Renomear pra deixar explícito que é por `dueDate`, não por sprint:

```ts
export type TeamCapacityMember = {
  // ...
  fpDueThisWeek: number;     // antes: fpThisWeek
  fpDueNextWeek: number;     // antes: fpNextWeek
  dueThisWeek: number;       // contagem (mantém)
  dueNextWeek: number;
};
```

Labels na UI:
- Card title: "Capacity do Time — por prazo"
- Subtitle: "FP com prazo nesta e próxima semana (dueDate) vs capacity semanal"
- Coluna 1: "Vence essa semana"
- Coluna 2: "Vence próx semana"

### 8.5 `src/app/(dashboard)/profile/page.tsx` — `CapacityCard`

- Reescrever conforme mockup 4.1
- Remover `const ACTIVE_STATUSES` local (linha 100); importar do `function-points.ts`
- Linha 1: bateria principal com `fpPlanned` empilhado (`fpDone` + `fpOpen`)
- Linha 2: lista de projetos com barra individual + `fpPlanned` + `fpContract` + flag (overcommit/ocioso/saudável)
- Linha 3: contagem de sprints ativas com nomes

### 8.6 `src/components/project-capacity-tab.tsx`

Refatorar pra puxar dados direto da view `sprint_member_capacity`:
- `fpPlanned` da view — não somar manualmente Task.functionPoints
- Cores baseadas em `fpPlanned / fpCapacity`
- Mostrar `fpContract` (= `fpAllocation`) inline ao lado do `fpPlanned`

### 8.7 `src/app/(dashboard)/profile/capacity/page.tsx`

Header novo de "Acordo contratual" (mockup 4.2) usando `commitment.committed` / `commitment.capacity`.

### 8.8 `src/app/(dashboard)/members/page.tsx`

- Renomear `fpUsedWeek` → `fpPlannedWeek`
- Mudar query da view: `fp_used` → `fp_planned` (consistente com métrica primária)
- Atualizar barra/labels (linhas 182, 265, 480, 526)

### 8.9 `src/app/(dashboard)/members/[id]/page.tsx`

Espelhar mockup 4.1 (mesmo card que `/profile`).

### 8.10 `src/app/(dashboard)/sprints/page.tsx` e `src/app/(dashboard)/projects/[id]/page.tsx`

- Renomear `fpAllocated` → `fpPlanned` em todos os lugares
- Garantir que API de origem (`/api/sprints`) já filtra `≠ backlog` antes de renomear no client

---

## 9. Ordem de execução (commitável passo a passo)

| # | Passo | Arquivos | Commit |
|---|---|---|---|
| 1 | Migration SQL — recria views com `FILTER`/`LATERAL` | `supabase/migrations/20260430_fp_capacity_metrics.sql` | `feat(db): unify capacity metrics — fp_planned/done/open` |
| 2 | Regen de tipos | `src/lib/supabase/database.types.ts` | `chore(types): regen after capacity migration` |
| 3 | `OPEN_STATUSES` central + alias deprecated | `src/lib/function-points.ts` | `refactor(fp): rename ACTIVE_STATUSES to OPEN_STATUSES, include changes_requested` |
| 4 | Migrar imports de `ACTIVE_STATUSES` → `OPEN_STATUSES` | 5 arquivos (api/me, api/members, api/projects, dashboard, profile) | `refactor(fp): migrate consumers to OPEN_STATUSES` |
| 5 | API `profile/capacity` + `members/[id]/capacity` | 2 routes | `feat(api): expose fp_planned/done/open in capacity endpoints` |
| 6 | API `sprints` — filtrar backlog + rename | `src/app/api/sprints/route.ts` | `fix(api): exclude backlog from sprint capacity, rename fpAllocated → fpPlanned` |
| 7 | API `me`, `members`, `projects/[id]`, `projects/[id]/schedule` — alinhar nomes | 4 routes | `refactor(api): align FP field names with new vocabulary` |
| 8 | `weekBuckets.ts` — estender shape + prorata | `src/lib/weekBuckets.ts` | `refactor(capacity): add planned/done/open to week buckets` |
| 9 | `MemberBattery` — prop `done` | `src/components/member-battery.tsx` | `feat(ui): stacked battery for done vs open FP` |
| 10 | `CapacityCard` em `/profile` | `src/app/(dashboard)/profile/page.tsx` | `feat(profile): unified capacity card with project breakdown` |
| 11 | `WeeklyAllocation` + `/profile/capacity` | 2 arquivos | `feat(capacity): weekly allocation uses fp_planned with done/open split` |
| 12 | `ProjectCapacityTab` + `/sprints/[id]` | 2 arquivos | `refactor(capacity): sprint tab reads from view, contract inline` |
| 13 | `team-capacity-widget` — renomear pra conceito E | `src/components/team-capacity-widget.tsx` + dashboard | `refactor(dashboard): team widget uses fpDue (dueDate-based), labels explícitos` |
| 14 | Lista de sprints + projects detail (barras fora da tab) | `src/app/(dashboard)/sprints/page.tsx`, `src/app/(dashboard)/projects/[id]/page.tsx`, `sprint-overview-widget.tsx` | `refactor(capacity): align sprints list and project detail with fpPlanned` |
| 15 | Lista de membros + detalhe | `src/app/(dashboard)/members/page.tsx`, `src/app/(dashboard)/members/[id]/page.tsx` | `feat(members): align list and detail with new vocabulary` |
| 16 | Limpeza — remover `ACTIVE_STATUSES` alias, `fpUsed/totalUsed` antigos | múltiplos | `chore(capacity): remove deprecated aliases (ACTIVE_STATUSES, fpUsed)` |

Cada passo é independente. Passos 1–7 são backend-only (UI continua com fallback). Passos 8–15 são frontend incremental. Passo 16 fecha.

---

## 10. Critério de pronto

Backend:
- [ ] Migration aplicada, view `sprint_member_capacity` retorna `fp_planned/fp_done/fp_open`
- [ ] Invariante `fp_planned = fp_done + fp_open` validada com query
- [ ] `sprint_capacity_overview` retorna `capacity, planned, done, open`
- [ ] Tipos regenerados em `database.types.ts`
- [ ] `OPEN_STATUSES` em `function-points.ts` tem 4 status (`todo, in_progress, review, changes_requested`)
- [ ] Search global `grep -r "ACTIVE_STATUSES" src/` retorna zero matches (só na linha de definição inicial, depois zero após cleanup)

Telas (cada uma deve mostrar `231/100 FP` pro João, com `▓189 ▒42`):
- [ ] `/profile` widget capacity
- [ ] `/profile/capacity` página completa
- [ ] `/sprints` lista (linha do João na Sprint 1)
- [ ] `/sprints/c3e38650.../board` aba capacity
- [ ] `/projects/[id]` aba schedule (membro João, Sprint 1)
- [ ] `/projects/[id]` aba team (bateria do João)
- [ ] `/members` lista (linha do João)
- [ ] `/members/[id]` detalhe do João

Telas com conceito E (FP-com-prazo, número diferente):
- [ ] Dashboard "Capacity do Time" mostra label "Vence essa semana / Vence próx semana"
- [ ] Subtítulo do card cita "(dueDate)"

Regressões:
- [ ] Sprints 2/3/4 (planning) mostram `0 / 100 FP` (todas as tasks delas estão em backlog)
- [ ] Dashboard team capacity inclui `changes_requested` no detector de overload/idle
- [ ] Search global `grep -r "fpUsed\|totalUsed\|fp_used"` em `src/` retorna zero matches

Fora de escopo (validar separadamente em V3):
- [ ] Agente Alpha — context, tools, prompt — tratado em plano dedicado

---

## 11. Notas pra execução futura

- O `fp_used` da view antiga **continuou sendo carga em aberto** o tempo todo — só foi mal-nomeado. Renomear pra `fp_open` evita confusão.
- A view `sprint_capacity_overview` já existia mas alimentava só o dashboard team. Após a migration, ela vira a fonte canônica pra QUALQUER agregação por sprint.
- `Member.fpCapacity` continua como capacidade semanal nominal (5 dias úteis). Se futuramente quisermos modular por `dedicationPercent`, isso é trivial (`effectiveCapacity = fpCapacity * dedicationPercent / 100`).
- Backlog **fora** da métrica é decisão consciente. Se um dia quisermos "intenção total" (planejado + backlog), adicionar `fp_intended` na view sem alterar `fp_planned`.
- **Conceito E (`fpDue`)** continua existindo no código sem virar coluna de view — agregação simples em JS sobre `Task.dueDate`. Se virar caro, criar view `member_due_window` depois.
- **Agente Alpha**: a próxima onda. Inventário inicial: `src/lib/agent/agents/alpha/context.ts` (5 queries), `tools.ts` (3 queries + filtros JS), `prompt.ts` (vocabulário no system prompt). Tratar como bloco isolado.
