# Projects V2 — Isolation, Sandbox & Cutover Plan

> **Status:** Plan (design locked) · **Owner:** João · **Created:** 2026-06-04
> **Companion of:** [projects-v2-plan.md](./projects-v2-plan.md) (design SSOT) ·
> [db-changes-registry.md](./db-changes-registry.md) (DB rollback ledger)

## 0. The principle (non-negotiable)

**Projects V2 is a second Zordon — a parallel branch of the project workspace.** It will take
**weeks to calibrate**. During that whole time, **production behaves byte-for-byte identically**.

We buy that guarantee with **forking, not sharing**: every diverging surface gets its own
V2-owned file in a V2 namespace. We **never edit a production-owned file** to serve V2.
Duplication is accepted and expected — yes, it copies code; that is the price of a clean branch.
Drift is managed by *organization + a freeze list*, not by clever sharing. Every DB change is
**additive and tagged** so a single rollback erases all of V2 without a trace. When we're
comfortable, **cutover is a swap**, not a migration.

Locked decisions (João, 2026-06-04):
- **Agents forked** → `vitor-v2`, `vitoria-v2`. Prod agents untouched.
- **Forge forked** → V2 Forge accepts any approved PRD of the project; prod Forge untouched.
- **Every action/button forked** → activate sprint, new sprint, new task/PRD, edit, access,
  settings… all get V2-owned copies. Full duplication is the plan.
- **DB additive + tagged** → every column/table marked for one-command rollback.
- **Rollback & cutover are first-class** features.

---

## 1. The isolation contract — 5 concerns

| Concern | Production (v1) | V2 sandbox | Guarantee |
|---------|-----------------|------------|-----------|
| **Route** | `/projects`, `projects/[id]` | `/projects-v2/**` (admin-gated) | Separate URLs; v1 routes never imported by v2. |
| **Component + actions** | `story-hierarchy/*`, `sprint/*`, `planning/*`, project sheets, all action hooks | `components/projects-v2/*`, `components/prd/*`, `projects-v2/[id]/_hooks/*` | Every button/mutation has a V2 copy. v2 imports shared **UI primitives** (`components/ui/*`) read-only only. |
| **Forge** | `forge-project.ts`, forge tab/kanban, session-locked runs | `lib/dal/projects-v2/forge-*`, `api/projects-v2/forge/*`, v2 kanban | V2 Forge = its own DAL/API/UI; accepts any project PRD. Prod Forge frozen. |
| **Agent** | `agents/vitor`, `agents/vitoria` | `agents/vitor-v2`, `agents/vitoria-v2` | Forked brains; one dispatch seam routes v2 sessions → v2 agents; default = prod agent. |
| **Database** | shared tables | **additive-only** columns/tables, tagged | v1 reads the same shape; new columns nullable + ignored by v1. |

**Golden rule:** *V2 work creates V2-owned files. It never edits a v1-owned file.* The only seams
that touch a shared boundary are (a) additive tagged DB migrations and (b) the single
agent-dispatch branch — both enumerated below.

---

## 2. The V2 namespace — where every V2 thing lives

```
src/
  app/(dashboard)/projects-v2/            ← ALL v2 routes
    layout.tsx                              admin gate (done)
    page.tsx                                list (v2-owned)
    [id]/
      page.tsx                              detail entry
      _hooks/                               v2 action+data hooks (PRD/sprint/forge actions)
      forge/kanban/page.tsx                 v2 kanban (Review + Production lanes)
  app/api/projects-v2/                    ← ALL v2 APIs (prds, forge, planning, sprints…)
  components/projects-v2/                 ← v2-owned components: board, prd-sheet, spec-sheet,
                                            sprint-board, sprint dialogs, project-edit/access,
                                            settings, planning-prd-panel, forge button
  components/prd/                         ← v2 PRD primitives, NEW (SpecPrdTree, PrdRow)
  lib/dal/projects-v2/                    ← v2 data access (PRD/sprint/forge/planning)
  lib/agent/agents/vitor-v2/              ← forked Vitor (Spec-first authoring)
  lib/agent/agents/vitoria-v2/            ← forked Vitoria (PRD planning + summon)
  lib/forge/classify-prd.ts              ← v2 classify (new file)
  lib/sessions/projects-v2/              ← v2 session helpers (ceremony PRD session, summon)
supabase/migrations/
  YYYYMMDD_pv2_*.sql                      ← every v2 migration carries the `pv2_` tag
  YYYYMMDD_pv2_rollback.sql              ← consolidated DROP of all v2 DB objects
docs/features/projects-v2/
  projects-v2-plan.md / projects-v2-isolation-plan.md / db-changes-registry.md
```

**Test for "V2-owned?"** → path contains `projects-v2`, `vitor-v2`, `vitoria-v2`, or
`components/prd`, **or** it's a `pv2_`-tagged migration. Everything else is **frozen** to V2 work.

---

## 3. Full duplication inventory — the "second Zordon" surface

**The rule (one line):** *Duplicate everything that IS the project workspace (tabs, buttons,
sheets, hooks, the agents). Reuse read-only only the Lego bricks (Button, Field, Sheet…) and
plumbing (auth, db client). Never touch Alpha or production.*

**Why rollback stays clean:** reusing a shared Lego brick **read-only** does not compromise
rollback — we never *edit* it. Rollback only gets messy when you edit a shared file, which we never
do. Delete the V2 folder + drop the `pv2_` columns = clean rollback, always.

### 3.0 Three buckets — definitive

- **🟢 DUPLICATE into V2** (free to change): the whole project-workspace layer — see table below.
  Includes **agents Vitor + Vitoria** → `agents/vitor-v2/`, `agents/vitoria-v2/`.
- **🔵 REUSE read-only** (never duplicate): `components/ui/*` · `lib/supabase/*` + auth/session
  (`lib/dal.ts`, `contexts/auth-context`) · `hooks/use-optimistic-collection` · `lib/roles`,
  `lib/utils`, `lib/date-utils` · app shell / layout. The agent **runtime/engine** is shared — we
  fork agent *brains* (prompt/tools), not the engine.
- **🔴 NEVER TOUCH:** **Alpha** (`agents/alpha/*` — out of scope, another level) · all production
  (`projects/**`, `agents/vitor`, `agents/vitoria`) · existing DB columns/tables (additive only).

### 3.1 Surface table

Every interactive surface of the project workspace and its V2 fate. **Coverage** = which of the 6
PRDs builds it, or **GAP** = needs a story we must add (see §10).

| Surface / button | Today (v1) | V2-owned target | Coverage |
|------------------|-----------|-----------------|----------|
| **Project header** — Edit project, Access | `ProjectEditSheet`, `ProjectAccessSheet` | `components/projects-v2/project-edit-sheet.tsx`, `…/project-access-sheet.tsx` (fork) | **GAP** → shell PRD |
| **Tab nav** (Specs·Sprints·Rituais·Wiki·Sessions·Forge·Settings) | inline in `projects/[id]/page.tsx` | v2 board container owns it | `area` (partial) |
| **Specs tab** (was Stories) — tree, PRD rows, create/delete | `StoriesList` | `SpecPrdTree`, `PrdRow`, v2 board | **area** ✅ |
| **PRD side sheet** — view/edit, AC, Send-to-Forge, Copy | `TaskSheet` + PRD viewer | `components/projects-v2/prd-sheet.tsx` | **area** ✅ |
| **PRD actions** — status/assignee/sprint inline, duplicate, clone, bulk, tags | `use-task-actions.ts` | `projects-v2/[id]/_hooks/use-prd-actions.ts` | area (patch) + **GAP** (dup/clone/bulk) |
| **Sprints tab** — ribbon, sprint board | `SprintRibbon`, `SprintsTab` | `components/projects-v2/sprint-board.tsx` | **GAP** → shell PRD |
| **Sprint lifecycle** — new, edit, activate, complete, reopen, delete, suggest, context(goal/retro) | `Sprint*Dialog`, `use-sprint-actions.ts` | `components/projects-v2/sprint-*`, `_hooks/use-sprint-v2-actions.ts` | **GAP** → shell PRD |
| **Sprint capacity** — FP math (PRD-based) | Task FP sum | `lib/dal/projects-v2/planning-allocation.ts` | **planning** ✅ |
| **Rituais tab** — ceremonies | `ProjectCeremoniesTab` | `components/projects-v2/planning-prd-panel.tsx` + ceremony fork | **planning** / **vitoria-create** |
| **Wiki tab** | `ProjectWiki` | reuse read-only or thin fork | shell PRD (low) |
| **Sessions tab** — PRD/discovery | `ProjectSessionsTab` | v2 authoring surface | **spec-authoring** |
| **Settings tab** — taxonomy (modules/personas), project update | `SettingsTab`, `use-taxonomy-actions.ts` | `components/projects-v2/settings/*` | **GAP** → shell PRD |
| **Forge tab** — run launch | `ForgeTab` (session loader) | v2 forge board (PRD selector) | **forge-unlock** ✅ |
| **Forge kanban** — Review + Production lanes | `forge/kanban` (no review/prod lane) | `projects-v2/[id]/forge/kanban` | **forge-unlock** ✅ |
| **Project list** — table/list view, new project, edit/delete | `ProjectsView` | `components/projects-v2/projects-v2-list.tsx` (fork) | §9 separation |

**Reading this table:** the 6 PRDs build the **PRD-native core** (tree, sheet, Forge, planning,
agents). The **workspace chrome parity** — sprint lifecycle buttons, project edit/access,
settings/taxonomy, PRD dup/clone/bulk — is **not fully covered** and becomes a new
`projects-v2-shell` workstream (§10).

---

## 4. Forge fork — production Forge vs V2 Forge

The Forge is two different machines now:

| | Production Forge | V2 Forge |
|-|------------------|----------|
| **Source of PRDs** | one loaded session (`Project.forgeSourceSessionId`, `type='prd_session'`) | **any approved PRD of the project** (no session lock) |
| **Launch DAL** | `createForgeRunFromSession` (frozen) | new `createForgeRunFromProject(projectId, prdRefs[])` in `lib/dal/projects-v2/forge-run.ts` |
| **API** | `api/forge/projects/[id]/runs` (frozen) | new `api/projects-v2/forge/**` routes |
| **UI** | session loader card; kanban `inbox→done` | PRD/sprint selector; kanban with **Review + Production** lanes |
| **Classify** | inline `classifyPrd` in legacy kanban | `lib/forge/classify-prd.ts` (new, v2-owned) |
| **Downstream** | `ForgeRun→ForgeJob→daemon`, `verifiable` enforcement | **identical** — shared, unchanged, read-only from v2 |

Only the **launch + selection + board** fork. The execution engine (daemon, jobs, verifiable) is
shared and untouched — v2 just feeds it new runs. Prod Forge keeps its session-locked path intact.

---

## 5. Agent fork — `vitor-v2` / `vitoria-v2`

Fork the **brain**, not every **surface**:
1. **Fork the definitions** → `agents/vitor/` → `agents/vitor-v2/` with V2 deltas (Spec-first
   prompt, `propose_spec`, `userStoryId`, sizing). Same for `vitoria-v2` (PRD allocation, summon).
2. **One dispatch seam** — a single branch picks the agent by a **V2-mode signal** on the
   session/ceremony (`subKind=vitoria_ask` or a `pmProtocol` marker). v2 → v2 agent; everything
   else → prod agent.
3. **Prod is the default** — production sessions never carry the signal, so they always resolve to
   the prod agent. Zero prod behavior change.

---

## 6. Database change tagging & rollback

Every V2 DB object is **additive** and **tagged**, recorded in
[db-changes-registry.md](./db-changes-registry.md) — the single ledger of "what V2 touched."

1. **Filename tag:** `YYYYMMDD_pv2_<name>.sql`.
2. **SQL comment tag** on each column/table:
   ```sql
   COMMENT ON COLUMN "ProductRequirement"."deliveryStatus"
     IS 'projects-v2 · added 20260604 · rollback: 20260604z_pv2_rollback.sql';
   ```
3. **Additive only on shared tables** — `ADD COLUMN` (nullable), `CREATE TABLE`, triggers/policies
   on **v2 columns only**. Never `ALTER`/`DROP`/retype a column v1 reads; never modify a v1
   trigger/policy.
4. **Consolidated rollback** — `YYYYMMDD_pv2_rollback.sql` drops every v2 object in reverse order.
5. **Registry row per object** — no silent DB change.

---

## 7. Cleanup: restore production to pristine, fork the current mirror

The navigable mirror shares two v1 files (good for the demo, against the freeze rule):
`project-detail-view.tsx` (extracted from v1) and `projects-view.tsx` (`hrefBase` prop).

**Separation step (do first):**
1. **Restore v1 to pristine** — revert the `ProjectDetailView` extraction and `ProjectsView`
   `hrefBase`, so `projects/**` + `projects-view.tsx` are exactly the original production code.
2. **Fork v2's shell** — give `projects-v2` its own list + detail copies under the v2 namespace,
   so reverting v1 doesn't break v2. These are the seed the `area` PRD evolves into the real board.
3. After this, **v1 and v2 share zero behavior-bearing code.**

---

## 8. PRD → V2 target re-pointing map

The 6 PRD **specs are unchanged** (audited). Only their *implementation targets* move into the V2
namespace so nothing edits a frozen file:

| PRD | Shared touch (current) | Re-point to (V2-owned) |
|-----|------------------------|------------------------|
| **schema** | migrations on `ProductRequirement`; `database.types.ts` | Keep (additive). Add `pv2_` tag + COMMENTs + registry rows. |
| **area** | `lib/status-chips.ts` | `components/prd/delivery-status.ts` (v2 registry). |
| **spec-authoring** | `agents/vitor/*`, `prd-briefing-step.tsx`, `story-sheet.tsx` | `agents/vitor-v2/*`, v2 authoring surface, `components/projects-v2/spec-sheet.tsx`. |
| **planning** | `agents/vitoria/tools.ts`, `planning-sheet.tsx`, `planning-prd-allocation.ts` | `agents/vitoria-v2/tools.ts`, `components/projects-v2/planning-prd-panel.tsx`, `lib/dal/projects-v2/planning-allocation.ts`. |
| **forge-unlock** | `forge-project.ts`, `api/forge/projects/[id]/runs` | `lib/dal/projects-v2/forge-run.ts`, `api/projects-v2/forge/**`. Trigger `pv2_`-tagged, fires on v2 column only. |
| **vitoria-create** | `sessions/prd-session/dal.ts`, `agents/vitoria/*` | `lib/sessions/projects-v2/*`, `agents/vitoria-v2/*`. |

*(Execution updates each `prd.json` `touches[]` to the re-pointed paths; acceptance criteria stay
identical.)*

---

## 9. Coverage gap → new `projects-v2-shell` PRD

The 6 PRDs build the PRD-native core. The **workspace chrome parity** (from §3) is not covered and
needs its own PRD before V2 feels like a full Zordon:

- Sprint lifecycle (new/edit/activate/complete/reopen/delete/suggest/context) — PRD-aware
- Project header — Edit project + Access (v2 forks)
- Settings tab — taxonomy (modules/personas) + project update
- PRD actions parity — duplicate/clone/bulk/tags
- Project list fork — `projects-v2-list.tsx`

→ **Action:** author `docs/prd/backlog/prd-projects-v2-shell.md` (+ `prd.json`) following the
Ralph schema, all targets V2-owned. Slots into the DAG after `area`.

---

## 10. Execution order (DAG, isolation-safe)

```
0. Separation (§7)   — restore v1 pristine + fork v2 shell        ← first
1. schema            — additive migrations, tagged + registry
2. area              — v2 board, SpecPrdTree, PrdSheet, v2 API
3. projects-v2-shell — sprint lifecycle + edit/access + settings + list (NEW PRD)  ┐ after area
   forge-unlock      — v2 forge DAL/API + v2 kanban                                 ┤
   planning          — v2 planning panel + vitoria-v2                               ┤
   spec-authoring    — vitor-v2 + v2 authoring surface                              ┘
4. vitoria-create    — vitoria-v2 summon + ceremony session   (after spec-authoring + planning)
```

After every step, **v1 routes render identically** — that's the acceptance gate for "no prod
interference."

---

## 11. Cutover (v1 → v2, when comfortable)

Q5 locked: **V2 is future-main.** After weeks of calibration, when V2 reaches parity+:
1. **Flip the nav** — point "Projetos" / `/projects` at the V2 experience (or redirect). Reversible.
2. **Promote agents** — make `*-v2` the default (flip the dispatch seam).
3. **Retire v1** — after a soak: delete `projects/**` + prod agent forks; DB columns become main.

Until cutover, **v1 is the source of truth**; V2 is purely additive on top.

---

## 12. Rollback (nuke V2 entirely)

1. `psql "$DIRECT_URL" -f supabase/migrations/*_pv2_rollback.sql` — drop all v2 DB objects.
2. `git rm -r` the V2 namespaces (§2) + agent forks.
3. Regenerate `database.types.ts` against the rolled-back schema.
4. v1 was never touched → nothing to restore.

[db-changes-registry.md](./db-changes-registry.md) is the checklist that makes step 1 exhaustive.
