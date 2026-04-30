# Capacity Unification — Execution Checklist

> Companion do `docs/capacity-unification-plan-v2.md`. Cada fase = 1 commit via `bash scripts/sync-main.sh -m "..."`.
> Auto-contido: pode retomar de qualquer fase sem ler conversa anterior, basta abrir o V2 pra mockups/SQL detalhado.
> **Alpha agent fora de escopo desta execução** (próxima onda).

---

## Como usar

1. Antes de começar uma fase, leia a fase inteira (não pula a verificação).
2. Faça as edições da seção **Steps**.
3. Rode os comandos da seção **Verify** — todos devem passar.
4. Commit com a frase exata da seção **Commit** (`sync-main.sh` faz rebase + push).
5. Marque o checkbox da fase no topo desse arquivo.
6. Avança pra próxima.

**Caso de erro de hook ou typecheck:** corrige na mesma sessão, não amenda commit, cria commit novo.

---

## Status geral

- [x] Fase 0 — Preparação
- [x] Fase 1 — Migration SQL
- [x] Fase 2 — Regen tipos
- [x] Fase 3 — `OPEN_STATUSES` central
- [x] Fase 4 — Migrar imports de `ACTIVE_STATUSES`
- [x] Fase 5 — APIs de capacity (`profile`, `members/[id]`)
- [x] Fase 6 — API `sprints` (filtrar backlog)
- [x] Fase 7 — APIs `me`, `members`, `projects/[id]`, `projects/[id]/schedule`
- [x] Fase 8 — `weekBuckets.ts` (shape estendido)
- [x] Fase 9 — `MemberBattery` (prop `done`)
- [x] Fase 10 — `/profile` CapacityCard
- [x] Fase 11 — `WeeklyAllocation` + `/profile/capacity`
- [x] Fase 12 — `ProjectCapacityTab` + `/sprints/[id]`
- [x] Fase 13 — Dashboard team-widget (sprint-based)
- [x] Fase 14 — Lista sprints + projects detail + sprint-overview-widget
- [x] Fase 15 — Lista membros + detalhe membro
- [x] Fase 16 — Cleanup (remove aliases)
- [x] Fase 17 — Validação final (backend + typecheck OK · validação visual pendente do usuário)

---

## Fase 0 — Preparação

**Goal:** baseline antes de tocar em código.

**Steps:**
1. Ler `docs/capacity-unification-plan-v2.md` na íntegra (vocabulário §3, mockups §4, matriz §6).
2. Garantir `DIRECT_URL` no `.env`:
   ```bash
   grep '^DIRECT_URL=' .env
   ```
3. Confirmar view atual existe:
   ```bash
   source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
     psql "$DIRECT_URL" -c "SELECT count(*) FROM sprint_member_capacity"
   ```
4. Anotar números atuais do João (pra comparar no fim — Fase 17):
   ```bash
   psql "$DIRECT_URL" -c "
     SELECT m.name, sc.\"sprintId\", sc.fp_allocation, sc.fp_used
     FROM sprint_member_capacity sc
     JOIN \"Member\" m ON m.id = sc.\"memberId\"
     WHERE m.name = 'João Moraes';
   "
   ```

**Verify:** baseline anotado em comentário ou nota local.

**Commit:** nenhum.

---

## Fase 1 — Migration SQL

**Goal:** view nova com `fp_planned/fp_done/fp_open` via `LATERAL + FILTER`.

**Files:**
- `supabase/migrations/20260430_fp_capacity_metrics.sql` (new)

**Steps:**
1. Criar arquivo com SQL do `plan-v2.md §5.1` (copiar exatamente — `LATERAL + FILTER`, não 3 subselects).
2. Aplicar:
   ```bash
   source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
     psql "$DIRECT_URL" -f supabase/migrations/20260430_fp_capacity_metrics.sql
   ```

**Verify:**
```bash
# Invariante fp_planned = fp_done + fp_open
psql "$DIRECT_URL" -c "
  SELECT count(*) AS broken
  FROM sprint_member_capacity
  WHERE fp_planned <> fp_done + fp_open;
"
# Resultado deve ser broken = 0

# Estrutura de sprint_capacity_overview
psql "$DIRECT_URL" -c "\d sprint_capacity_overview"
# Deve ter colunas: sprintId, capacity, planned, done, open

# Smoke test João
psql "$DIRECT_URL" -c "
  SELECT m.name, s.name AS sprint, fp_allocation, fp_planned, fp_done, fp_open
  FROM sprint_member_capacity sc
  JOIN \"Member\" m ON m.id = sc.\"memberId\"
  JOIN \"Sprint\" s ON s.id = sc.\"sprintId\"
  WHERE m.name = 'João Moraes' AND s.\"projectId\" IN (
    SELECT id FROM \"Project\" WHERE name = 'Zordon'
  );
"
# Sprint 1 do João deve ter fp_planned = 231 (ou número similar — confirma com baseline)
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "feat(db): unify capacity metrics — fp_planned/done/open"
```

---

## Fase 2 — Regen tipos

**Goal:** `database.types.ts` reflete view nova.

**Files:**
- `src/lib/supabase/database.types.ts`

**Steps:**
```bash
npx supabase gen types typescript --project-id ugvqlmapqlobigkjboae > src/lib/supabase/database.types.ts
```

**Verify:**
```bash
grep "fp_planned" src/lib/supabase/database.types.ts
grep "fp_open" src/lib/supabase/database.types.ts
grep "fp_done" src/lib/supabase/database.types.ts
# 3 matches mínimos cada
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "chore(types): regen after capacity migration"
```

---

## Fase 3 — `OPEN_STATUSES` central

**Goal:** unificar TS com SQL (4 status, não 3).

**Files:**
- `src/lib/function-points.ts`

**Steps:**
1. Renomear `ACTIVE_STATUSES` → `OPEN_STATUSES`.
2. Incluir `changes_requested` na lista:
   ```ts
   export const OPEN_STATUSES = [
     'todo', 'in_progress', 'review', 'changes_requested',
   ] as const;

   /** @deprecated use OPEN_STATUSES — será removido na fase 16 */
   export const ACTIVE_STATUSES = OPEN_STATUSES;
   ```

**Verify:**
```bash
npx tsc --noEmit
# Deve compilar sem erro (alias mantém retrocompat)
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "refactor(fp): rename ACTIVE_STATUSES to OPEN_STATUSES, include changes_requested"
```

---

## Fase 4 — Migrar imports de `ACTIVE_STATUSES`

**Goal:** consumidores passam a importar `OPEN_STATUSES` direto.

**Files:**
- `src/app/api/me/route.ts`
- `src/app/api/members/route.ts`
- `src/app/api/projects/[id]/route.ts`
- `src/app/(dashboard)/page.tsx`
- `src/app/(dashboard)/profile/page.tsx` — **também remover** const `ACTIVE_STATUSES` local (linha 100)
- `src/lib/agent/agents/alpha/tools.ts` — **NÃO TOCAR** (Alpha fora de escopo, fica usando o alias deprecado)
- `src/lib/agent/agents/alpha/context.ts` — **NÃO TOCAR**

**Steps:**
1. Em cada arquivo da lista, trocar `import { ACTIVE_STATUSES }` por `import { OPEN_STATUSES }`.
2. Substituir todas as ocorrências de `ACTIVE_STATUSES` por `OPEN_STATUSES` no corpo.
3. Em `profile/page.tsx`, deletar a const local linha 100; usar `OPEN_STATUSES` importado.

**Verify:**
```bash
# Só os 2 arquivos do Alpha podem continuar usando o alias deprecado
grep -rn "ACTIVE_STATUSES" src/ --include="*.ts" --include="*.tsx" | grep -v "src/lib/agent/agents/alpha" | grep -v "src/lib/function-points.ts"
# Deve retornar vazio

npx tsc --noEmit
# Clean
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "refactor(fp): migrate consumers to OPEN_STATUSES (alpha pendente)"
```

---

## Fase 5 — APIs de capacity (profile, members/[id])

**Goal:** endpoints retornam `fpPlanned/fpDone/fpOpen` em vez de `fpUsed`.

**Files:**
- `src/app/api/profile/capacity/route.ts`
- `src/app/api/members/[id]/capacity/route.ts`

**Steps em cada arquivo:**
1. Trocar `.select("sprintId, projectId, fp_allocation, fp_used, has_sprint_override")` por:
   ```ts
   .select("sprintId, projectId, fp_allocation, fp_planned, fp_done, fp_open, has_sprint_override")
   ```
2. No map de retorno, substituir `fpUsed: Number(sc.fp_used)` por:
   ```ts
   fpPlanned: Number(sc.fp_planned) || 0,
   fpDone: Number(sc.fp_done) || 0,
   fpOpen: Number(sc.fp_open) || 0,
   ```

**Verify:**
```bash
# Smoke test
curl -s http://localhost:3000/api/profile/capacity | jq '.sprints[0] | keys'
# Deve incluir: fpAllocation, fpPlanned, fpDone, fpOpen, hasOverride

npx tsc --noEmit
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "feat(api): expose fp_planned/done/open in capacity endpoints"
```

---

## Fase 6 — API `sprints` (filtrar backlog)

**Goal:** `/api/sprints` deixa de somar tasks de backlog. `fpAllocated` vira `fpPlanned`.

**Files:**
- `src/app/api/sprints/route.ts`

**Steps:**
1. No reduce de `members[]`, filtrar `task.status !== 'backlog'`:
   ```ts
   for (const task of tasks) {
     if (task.status === 'backlog') continue;  // novo
     const fp = task.functionPoints ?? 0;
     for (const a of task.assignments) {
       if (a.member) {
         const existing = memberMap.get(a.member.id);
         if (existing) existing.fpPlanned += fp;     // renomeado
         else memberMap.set(a.member.id, { ...a.member, fpPlanned: fp });
       }
     }
   }
   ```
2. Renomear no shape: `fpAllocated` → `fpPlanned` (Map type, member object).
3. `totalFp` no retorno: filtrar backlog também (consistência).

**Verify:**
```bash
curl -s "http://localhost:3000/api/sprints?status=active" | jq '.[0].members[0] | keys'
# Deve ter fpPlanned, não fpAllocated

npx tsc --noEmit
# Vai quebrar nos consumidores (sprints/page.tsx, projects/[id]/page.tsx, sprint-overview-widget) — corrigir nas fases 14
# Pra esta fase, ajustar minimamente: rename de fpAllocated em sprints/page.tsx + sprint-overview-widget só pro typecheck passar
```

**Nota:** typecheck pode quebrar consumidores. Aceitável aqui se a fase 14 cobrir; **mas o build precisa estar verde no fim de cada fase**. Se precisar, fazer o rename em `sprints/page.tsx` e `sprint-overview-widget.tsx` agora junto (1 commit maior).

**Commit:**
```bash
bash scripts/sync-main.sh -m "fix(api): exclude backlog from sprint capacity, rename fpAllocated → fpPlanned"
```

---

## Fase 7 — APIs `me`, `members`, `projects/[id]`, `projects/[id]/schedule`

**Goal:** alinhar nomes do conceito C com vocabulário (`fpAllocated` ambíguo → `fpOpen`).

**Files:**
- `src/app/api/me/route.ts` (`fpAllocated` → `fpOpen`)
- `src/app/api/members/route.ts` (idem)
- `src/app/api/projects/[id]/route.ts` (idem)
- `src/app/api/projects/[id]/schedule/route.ts` (validar `totalFp/fpDone`; alinhar com vocabulário se possível)

**Steps:**
1. Em cada arquivo, renomear `fpAllocated` → `fpOpen` no shape de retorno.
2. Confirmar filtros usam `OPEN_STATUSES` (deve já estar feito na Fase 4).
3. Atualizar consumidores frontend dos campos renomeados (typecheck guia).

**Verify:**
```bash
# Cada API
curl -s http://localhost:3000/api/me | jq '. | keys'
curl -s http://localhost:3000/api/members | jq '.[0] | keys'

# Build limpo
npx tsc --noEmit
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "refactor(api): align FP field names with new vocabulary"
```

---

## Fase 8 — `weekBuckets.ts` (shape estendido)

**Goal:** prorata semanal aplica nos 3 campos novos.

**Files:**
- `src/lib/weekBuckets.ts`

**Steps:**
1. Estender `SprintInput`:
   ```ts
   fpPlanned: number;
   fpDone: number;
   fpOpen: number;   // renomeado de fpUsed
   ```
2. Estender `WeekSprintRow`:
   ```ts
   fpPlannedWeek: number;
   fpDoneWeek: number;
   fpOpenWeek: number;
   ```
3. Estender `WeekBucket`:
   ```ts
   totalPlanned: number;
   totalDone: number;
   totalOpen: number;
   ```
4. Aplicar prorata aos 3 novos no loop (mesma fórmula que `fpAllocationWeek`).

**Verify:**
```bash
npx tsc --noEmit
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "refactor(capacity): add planned/done/open to week buckets"
```

---

## Fase 9 — `MemberBattery` (prop `done`)

**Goal:** bateria empilhada (`▓done ▒open`) opcional.

**Files:**
- `src/components/member-battery.tsx`

**Steps:**
1. Adicionar prop opcional `done?: number`.
2. Quando `done` definido: render barra com 2 cores (sólida pra `done`, clara pra `committed - done`).
3. Quando `done` undefined: comportamento atual (1 cor).

**Verify:**
```bash
npx tsc --noEmit

# Visual: abrir /members em dev e confirmar que sem prop done a bateria continua igual
npm run dev
# Abrir http://localhost:3000/members
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "feat(ui): stacked battery for done vs open FP"
```

---

## Fase 10 — `/profile` CapacityCard

**Goal:** card unificado conforme mockup §4.1 do plano.

**Files:**
- `src/app/(dashboard)/profile/page.tsx`

**Steps:**
1. Reescrever `CapacityCard`:
   - Linha 1: bateria principal com `fpPlanned` empilhado (`fpDone` + `fpOpen`)
   - Linha 2: lista de projetos com barra individual + `fpPlanned` + `fpContract` + flag (overcommit/ocioso/saudável)
   - Linha 3: contagem de sprints ativas com nomes
2. Substituir `weekUsed`/`weekActiveSprints` por `weekPlanned`/`weekDone`/`weekOpen` derivados do bucket atual.
3. Confirmar que const local `ACTIVE_STATUSES` foi removida na Fase 4 (sanity check).

**Verify:**
```bash
npx tsc --noEmit
npm run dev
# Abrir /profile como João
# Esperado: 231/100 FP, ▓189 ▒42, Zordon 231 contrato 54 ⚠️ +4.3×, Zelar 0 contrato 50 💤 ocioso
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "feat(profile): unified capacity card with project breakdown"
```

---

## Fase 11 — `WeeklyAllocation` + `/profile/capacity`

**Goal:** widget multi-semana usa `fpPlanned` como primário, sub-barra done/open.

**Files:**
- `src/components/weekly-allocation.tsx`
- `src/app/(dashboard)/profile/capacity/page.tsx`

**Steps:**
1. `weekly-allocation.tsx`: trocar `bucket.totalUsed` por `bucket.totalPlanned`; adicionar sub-barra com `totalDone/totalOpen`.
2. `profile/capacity/page.tsx`: header novo de "Acordo contratual" (mockup §4.2 do plano) usando `commitment.committed/capacity`.

**Verify:**
```bash
npx tsc --noEmit
npm run dev
# /profile/capacity como João: header contrato 104/100, semana atual 231/100 com ▓189 ▒42
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "feat(capacity): weekly allocation uses fp_planned with done/open split"
```

---

## Fase 12 — `ProjectCapacityTab` + `/sprints/[id]`

**Goal:** sprint board capacity tab lê da view, mostra contrato inline.

**Files:**
- `src/components/project-capacity-tab.tsx`
- `src/app/(dashboard)/sprints/[id]/board/page.tsx`

**Steps:**
1. `project-capacity-tab.tsx`:
   - Puxar `fpPlanned` da view `sprint_member_capacity` (não somar Task.functionPoints em JS)
   - Cores baseadas em `fpPlanned / fpCapacity`
   - Mostrar `fpContract` (= `fpAllocation`) inline
2. `sprints/[id]/board/page.tsx`: consumir nova shape do tab.

**Verify:**
```bash
npx tsc --noEmit
npm run dev
# /sprints/<sprint-1-zordon-id>/board aba capacity:
# João: 231/100 FP, ▓189 ▒42, contrato 54, ⚠️ overcommit
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "refactor(capacity): sprint tab reads from view, contract inline"
```

---

## Fase 13 — Dashboard team-widget (sprint-based)

**Goal:** widget vira sprint-based, sem `dueDate`, sem `/2`. Mostra `fpPlanned` vs `fpContract` vs `fpCapacity`.

**Files:**
- `src/components/team-capacity-widget.tsx`
- `src/app/(dashboard)/page.tsx`

**Steps:**

1. **`team-capacity-widget.tsx`** — novo shape:
   ```ts
   export type TeamCapacityMember = {
     id: string;
     name: string;
     role: string;
     squads: string[];
     fpCapacity: number;     // sem /2
     fpContract: number;     // novo
     fpPlanned: number;      // novo
     fpDone: number;
     fpOpen: number;
     activeSprints: { id: string; name: string; projectName: string }[];
   };
   ```
2. UI conforme mockup §4.4 do V2:
   - Card title: "Capacity do Time — Sprint atual"
   - Por membro: `fpPlanned/fpCapacity`, multiplicador, sub-barra `▓fpDone ▒fpOpen`, linha de contrato (`fpContract`) com `+N acima` ou `sobra N`.
   - Cor: vermelho se `fpPlanned/fpCapacity > 1`; amarelo se entre `fpContract/fpCapacity` e 1; verde caso contrário.
3. Remover `weeklyCapacity = fpCapacity / 2`.

4. **`src/app/(dashboard)/page.tsx`** — montagem dos dados:
   - **Substituir** o loop linhas 187–223 (que olha `task.dueDate`).
   - Nova fonte: query a `sprint_member_capacity` filtrada por sprints `active`/`planning` da semana atual:
     ```ts
     const { data: capRows } = await supabase
       .from("sprint_member_capacity")
       .select(`*, sprint:Sprint!inner(id, name, status, startDate, endDate, projectId, project:Project(name))`)
       .in("sprint.status", ["active", "planning"]);
     ```
   - Filtrar por sprints que **se sobrepõem** à semana atual (usar `bucketSprintsByWeek` ou check inline `startDate <= weekEnd && endDate >= weekStart`).
   - Agregar por `memberId`: somar `fp_planned`, `fp_done`, `fp_open`, `fp_allocation` (= contrato efetivo, com override aplicado).
   - Buscar `fpCapacity` separado do `Member`.

5. Detector de overload (linhas 271–286): substituir `m.fpThisWeek / weeklyCapacity` por `m.fpPlanned / m.fpCapacity`. Threshold mantém `>0.85` overload, `<0.1` idle.

**Verify:**
```bash
npx tsc --noEmit

# Search global: nada deve usar fpThisWeek/fpNextWeek
grep -rn "fpThisWeek\|fpNextWeek\|dueThisWeek\|dueNextWeek" src/ --include="*.ts" --include="*.tsx"
# Vazio

npm run dev
# Dashboard como João:
# - Capacity do Time mostra: João 231/100 FP · 2.3× ⚠️ · contrato 104 → +127 acima · ▓189 ▒42
# - Detector de overload sinaliza João
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "refactor(dashboard): team widget uses sprint-based fpPlanned vs contract vs capacity"
```

---

## Fase 14 — Lista sprints + projects detail + sprint-overview-widget

**Goal:** todos os pontos com `fpAllocated` viram `fpPlanned`.

**Files:**
- `src/app/(dashboard)/sprints/page.tsx`
- `src/app/(dashboard)/projects/[id]/page.tsx` (linhas ~1222 e ~1286)
- `src/components/sprint-overview-widget.tsx`

**Steps:**
1. Renomear `fpAllocated` → `fpPlanned` em todo lugar (já vem com nome novo da `/api/sprints` após Fase 6).
2. Atualizar labels/cores se houver branch baseado em valor.
3. Em `projects/[id]/page.tsx`, garantir que as 2 seções fora do tab também usam o número correto.

**Verify:**
```bash
grep -rn "fpAllocated" src/ --include="*.ts" --include="*.tsx"
# Vazio

npx tsc --noEmit
npm run dev
# /sprints e /projects/<zordon-id>: linha do João Sprint 1 mostra 231/100, não 246/100
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "refactor(capacity): align sprints list and project detail with fpPlanned"
```

---

## Fase 15 — Lista membros + detalhe membro

**Goal:** `/members` e `/members/[id]` espelham vocabulário novo.

**Files:**
- `src/app/(dashboard)/members/page.tsx`
- `src/app/(dashboard)/members/[id]/page.tsx`

**Steps:**
1. `members/page.tsx`:
   - Trocar query: `fp_used` → `fp_planned` na soma semanal (linha ~313).
   - Renomear `fpUsedWeek` → `fpPlannedWeek` (linhas 73, 182, 265, 308–320, 357, 480, 526).
2. `members/[id]/page.tsx`:
   - Trocar `fpUsed` → `fpOpen` no shape (linha 35).
   - Espelhar mockup §4.1 (mesmo card que `/profile`).

**Verify:**
```bash
grep -rn "fpUsed\|fp_used\|totalUsed" src/ --include="*.ts" --include="*.tsx"
# Vazio (a função-points.ts ainda tem o alias deprecado, OK)

npx tsc --noEmit
npm run dev
# /members: linha do João mostra 231/100 (planejado semanal)
# /members/<joao-id>: card igual ao /profile
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "feat(members): align list and detail with new vocabulary"
```

---

## Fase 16 — Cleanup (remove aliases)

**Goal:** apagar `ACTIVE_STATUSES` e qualquer alias deprecado restante.

**Files:**
- `src/lib/function-points.ts` — remover alias deprecado
- Arquivos do Alpha: `src/lib/agent/agents/alpha/{tools,context}.ts` — migrar pra `OPEN_STATUSES`

**Steps:**
1. Migrar Alpha (mínimo: trocar import e nome da const, sem mudar lógica):
   - `tools.ts:4` → `import { suggestFunctionPoints, OPEN_STATUSES } from "@/lib/function-points";`
   - `context.ts:2` → `import { OPEN_STATUSES, FP_MATRIX_DEFAULT, type FpMatrix } from "@/lib/function-points";`
   - Substituir todas as referências `ACTIVE_STATUSES` por `OPEN_STATUSES` nesses 2 arquivos.

   **Nota:** Isso é só rename do nome, não muda a semântica de capacity do agente. A revisão completa do Alpha (vocabulário, prompt, métricas) é a próxima onda — fora desta execução.

2. Remover o alias deprecado em `function-points.ts`:
   ```ts
   // remover:
   /** @deprecated ... */
   export const ACTIVE_STATUSES = OPEN_STATUSES;
   ```

**Verify:**
```bash
grep -rn "ACTIVE_STATUSES" src/ --include="*.ts" --include="*.tsx"
# Vazio

npx tsc --noEmit
```

**Commit:**
```bash
bash scripts/sync-main.sh -m "chore(capacity): remove deprecated ACTIVE_STATUSES alias"
```

---

## Fase 17 — Validação final

**Goal:** rodar checklist do plano §10 e fechar o ciclo.

**Steps — checklist (todas devem passar):**

### Backend
- [ ] View `sprint_member_capacity` retorna `fp_planned/fp_done/fp_open`
- [ ] Invariante `fp_planned = fp_done + fp_open` (já validada na Fase 1, reconfirmar)
- [ ] `sprint_capacity_overview` retorna `capacity, planned, done, open`
- [ ] Tipos regenerados em `database.types.ts`
- [ ] `OPEN_STATUSES` em `function-points.ts` tem 4 status

### Telas (cada uma deve mostrar `231/100 FP` pro João, com `▓189 ▒42`):
- [ ] `/profile` widget capacity
- [ ] `/profile/capacity` página completa
- [ ] Dashboard "Capacity do Time" — linha do João mostra `231/100 FP · 2.3× ⚠️ · contrato 104`
- [ ] `/sprints` lista (linha do João na Sprint 1)
- [ ] `/sprints/<sprint-1-zordon-id>/board` aba capacity
- [ ] `/projects/<zordon-id>` aba schedule (membro João, Sprint 1)
- [ ] `/projects/<zordon-id>` aba team (bateria do João)
- [ ] `/members` lista (linha do João)
- [ ] `/members/<joao-id>` detalhe do João

### Regressões
- [ ] Sprints 2/3/4 (planning) mostram `0 / 100 FP`
- [ ] Dashboard team-widget detector de overload usa `fpPlanned / fpCapacity` (sem `/2`)
- [ ] Tasks sem `dueDate` deixam de aparecer somadas em "esta semana" do dashboard
- [ ] Search global limpo:
  ```bash
  grep -rn "fpUsed\|totalUsed\|fp_used\|fpThisWeek\|fpNextWeek\|fpAllocated\|ACTIVE_STATUSES" src/ --include="*.ts" --include="*.tsx"
  # Vazio
  ```
- [ ] Build limpo: `npx tsc --noEmit`
- [ ] Lint limpo: `npm run lint` (se existir)

**Commit (se houver ajustes):**
```bash
bash scripts/sync-main.sh -m "chore(capacity): final adjustments after validation"
```

---

## Pós-execução

- Atualizar `MEMORY.md` indexando esse work.
- Abrir issue/plano pra **Alpha agent** (ondas seguinte): inventariar prompts, métricas das tools (`get_sprint_overview`, `get_member_commitments`, etc.), ajustar vocabulário.
- Considerar agendar agente em 2 semanas pra rodar `grep -rn "fp_open\|fp_used\|fpAllocated"` e flagar regressões/contaminação.

---

## Apêndice — comandos úteis

**psql shortcut:**
```bash
alias volund-psql='source <(grep "^DIRECT_URL=" .env | sed "s/^/export /") && psql "$DIRECT_URL"'
```

**Smoke test rápido pra cada fase de UI:**
```bash
npm run dev
# Login como João, abrir cada página e validar visualmente
```

**Reverter migration (emergência):**
```bash
# Recriar a view antiga a partir de supabase/migrations/20260423_fp_allocation_model.sql §5
psql "$DIRECT_URL" -c "DROP VIEW IF EXISTS sprint_capacity_overview CASCADE; DROP VIEW IF EXISTS sprint_member_capacity CASCADE;"
psql "$DIRECT_URL" -f supabase/migrations/20260423_fp_allocation_model.sql
```
