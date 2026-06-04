# Projects V2 — PRD-native project management

> **Status:** Planning (draft) · **Owner:** João (admin-only pilot) · **Created:** 2026-06-04
>
> Major change to the PM protocol. Zordon stops being Jira/Trello (Sprint → User Story → Task)
> and becomes **PRD-native**: the unit you manage, drag, open-the-side-sheet-on, and *forge* is a
> **PRD**. This doc is the single source of truth for the change. Decisions live in §2; everything
> below is grounded in the code that exists today (file refs inline).

---

## 1. Vision in one paragraph

A new **admin-only** `projects-v2/` area that is a faithful clone of today's projects feature, with
exactly two swaps: **Task → PRD** (the leaf work-unit, now Forge-able) and **User Story → Spec** (the
parent grouping). Sprints stay; they now hold **PRDs**. The PM allocates PRDs to a sprint via the
planning rituals, and for each PRD the team either **sends it to the Forge** (real action) or **copies
it** and runs it by hand in Claude Code (clipboard, no backend). PRDs become **task-sized and
codebase-grounded** — hundreds per project, not a handful of §1–16 monsters.

---

## 2. Locked decisions

| # | Decision | Value | Rationale |
|---|----------|-------|-----------|
| D1 | Area | New `src/app/(dashboard)/projects-v2/`, gated `admin` via [roles.ts](../../../src/lib/roles.ts) `hasMinAccessLevel(level,"admin")` | Pilot in isolation, zero risk to prod projects |
| D2 | Tree shape | **Spec → PRD** (Spec groups PRDs) | Faithful clone of Story → Task |
| D3 | PRD entity | Existing **`ProductRequirement`** (already Forge-able: `specMarkdown`, `stories[]`, AC, ForgeRun wiring) | One source of truth Vitor → board → Forge |
| D4 | Spec entity | **`UserStory`** relabeled "Spec" (parent grouping, business narrative) | Already exists; legacy table kept |
| D5 | Sprint ↔ PRD | PRDs live **inside** sprints | Matches "sprints hold PRDs" |
| D6 | PRD actions | **Send to Forge** (real) · **Copy** (clipboard → manual Claude Code) | "Cloud Code" is copy/paste, not an integration |
| D7 | PRD producer | **Vitor** stays the *only* agent that authors PRDs | Grounding + quality gates centralized |
| D8 | PRD granularity | **Task-sized, codebase-grounded** (~hundreds/project), "not too small" | Avoid §1–16 monsters; avoid hallucination |
| D9 | Forge eligibility | Forge accepts **any approved PRD linked to the project**, not locked to one Design Session | Decouple Forge from `forgeSourceSessionId` |
| D10 | Granularity pipeline | **Spec-first decompose**: discovery produces Specs (narrative); Vitor slices each Spec into PR-sized PRDs grounded in repo | Controllable sizing; matches Spec→PRD tree + double-diamond |
| D11 | Authoring substrate | **Reuse Vitor's existing surfaces as-is** — quick-ask `prd_session` + two-pane PRD-tree screen + `propose_prd/update_prd/approve_prd`. No new authoring UI | Already built; D7 sole-author preserved |
| D12 | Authoring vs consumption | **Authoring is session-based** (Vitor's workbench), **consumption is project-based** (board/Forge/planning read project PRDs) | Lets Forge decouple from sessions (D9) while Vitor keeps its session-keyed tools |
| D13 | Vitoria in-ceremony create | Vitoria **summons Vitor in the background** (no chat/screen switch) into a per-ceremony session of **`subKind = vitoria_ask`** ("Vitória PRD session" — visually identical to a normal PRD session, tagged for lineage), provisioned via `ensure_sprint_prd_session` + `EntityLink.planningCeremonyId`. Vitoria **announces clearly** ("summoning Vitor… PRD landing in the tree for this sprint"), does not author | User pref: zero chat change, but transparent; lineage visible |
| D14 | Spec is a thin pack | Vitor's PRD elaboration **unchanged**; he gains a **`propose_spec`** tool and **always creates PRDs inside a Spec** (`ProductRequirement.userStoryId`). Spec = `UserStory` as-is; its side sheet becomes the **Spec side sheet**; PRD tree shows a **collapsible card per Spec** | No Spec enrichment / no PRD slimming — just a grouping layer |
| D15 | Authoring surfaces | All three Vitor surfaces share the same PRD machinery + PRD-tree screen: quick-ask `prd_session`, **Inception briefing step**, `super`. Plus the new `vitoria_ask` | Reuse everything; nothing surface-specific to build |

---

## 3. Entity model: today → V2

### 3.1 Mapping

| Role | Today | V2 | Backing table |
|------|-------|----|----|
| Parent grouping | User Story | **Spec** | `UserStory` (relabel only) |
| Leaf work-unit | Task | **PRD** | `ProductRequirement` (reused + extended) |
| Container | Sprint | Sprint | `Sprint` (+ PRD linkage) |
| Internal exec units | — | PRD's `stories[]` (jsonb, what the Forge runs) | `ProductRequirement.stories` |

**Spec is a lightweight pack, not a heavier doc.** Vitor's PRD elaboration is *unchanged* — PRDs keep
their full structure (problem/goal/journey/AC/`stories[]`), just **smaller in scope** (one PR-sized
slice). The **Spec** is a thin grouping layer = the `UserStory` entity **as-is** (title/want/soThat/
persona), whose existing side sheet becomes the **Spec side sheet**. The only schema add is the link:
`ProductRequirement.userStoryId` (the PRD's parent Spec). No Spec enrichment, no PRD slimming.

### 3.2 Tree

```
Sprint
 ├─ PRD   ◄ board card · Send to Forge / Copy   (ProductRequirement)
 │    └─ stories[]  (verifiable units the Forge executes)
 └─ PRD

Spec  (UserStory, relabeled — a collapsible pack in the PRD tree)
 ├─ PRD   (every PRD lives inside a Spec)
 └─ PRD
```

In the **PRD tree** (Vitor's authoring screen + the planning surface), each Spec renders as a
**collapsible card** wrapping its PRDs.

### 3.3 What exists vs. what's new

| Piece | State | Evidence |
|-------|-------|----------|
| `ProductRequirement` rich entity | ✅ exists | [20260530c_product_requirement.sql](../../../supabase/migrations/20260530c_product_requirement.sql) |
| `stories[]` jsonb w/ `verifiable` | ✅ exists | [20260601_pr_stories.sql](../../../supabase/migrations/20260601_pr_stories.sql) |
| `specMarkdown` (§1–16) | ✅ exists | [20260602_pr_spec_markdown.sql](../../../supabase/migrations/20260602_pr_spec_markdown.sql) |
| PRD DAL (create/update/approve/…) | ✅ exists | [product-requirements.ts](../../../src/lib/dal/product-requirements.ts) |
| `Task.productRequirementId` bridge | ✅ exists | coexistence was designed in |
| `ProductRequirement.userStoryId` (Spec parent) | ❌ **new** | — |
| `ProductRequirement.sprintId` | ❌ **new** | no direct link today (only via Task) |
| PRD board/delivery status | ❌ **new** | see §4 |
| PRD estimate/FP (for sprint capacity) | ❌ **new** | capacity sums Task FP today |
| PRD assignees | ❌ **new** | — |
| Vitor `propose_spec` tool (create pack) | ❌ **new** | Vitor today creates PRDs but not their Spec pack |
| PRD tree collapsible Spec card | ❌ **new** | group PRDs by Spec in the tree |
| Spec side sheet | ♻️ **relabel** | reuse `story-hierarchy/story-sheet.tsx` |
| `DesignSession.subKind = vitoria_ask` | ❌ **new** | tag Vitoria-summoned sessions (D13) |

---

## 4. Status model — two axes, reuse the Forge machinery

A PRD carries **two independent statuses**. Conflating them is the trap.

### 4.1 Authoring status (exists, keep)
`draft → review → approved → superseded` — Vitor/spec quality lifecycle ("is this PRD well-specified?").
Drives nothing on the board except eligibility (only `approved` is Forge-able).

### 4.2 Delivery/board status (new) — overlays the Forge run-state
We already have execution machinery; we **mirror + extend** it rather than invent:

- **ForgeRun status:** `queued | running | done | error | aborted | paused-pivot`
  ([20260516_forge_v1.sql](../../../supabase/migrations/20260516_forge_v1.sql))
- **Derived per-PRD runState:** `idle | pending | running | done | failed`
  ([run-state.ts](../../../src/lib/forge/run-state.ts), `derivePrdRunInfo` in [forge-project.ts](../../../src/lib/dal/forge-project.ts))
- **Existing kanban columns:** `inbox | ready | running | failed | done | archived`
  ([forge/kanban/page.tsx](../../../src/app/(dashboard)/projects/[id]/forge/kanban/page.tsx), `classifyPrd`)

**The gap:** the Forge's `done` = "last run ok" (code produced). That is exactly the moment the PM's
**review gate** opens — it is *not* "done." And there is **no production lane** today (the user's
"kanban on what's on production" doesn't exist yet: `archived` = superseded; `Sprint` has
`deployedToStagingAt/deployedToProductionAt`, but `ProductRequirement`/`ForgeRun` do **not**).

**Proposed delivery status** (stored field, mirrors Task's vocabulary so the same `StatusChipSelect`
component is reused):

```
backlog → todo → in_progress → review → done → in_production
                                  └→ changes_requested ─┐
                                  ┌────────────────────┘
```

| Delivery status | Meaning | Set by |
|-----------------|---------|--------|
| `backlog` | not allocated to a sprint | default |
| `todo` | allocated to a sprint, not started | sprint planning commit |
| `in_progress` | Forge running OR PM doing it manually | Forge `running`/`pending`, or manual |
| `review` | **code is in — PM runs/tests/evaluates** | auto on Forge `done`, or manual after Copy-run |
| `changes_requested` | PM kicked it back | PM |
| `done` | PM evaluated, passes | PM |
| `in_production` | deployed | **new** `deployedToProductionAt` on PRD (mirror Sprint) |

**Auto-transition:** PRD already has `lastRunStatus`/`lastRunId` synced by trigger
([20260601_prd_last_run.sql](../../../supabase/migrations/20260601_prd_last_run.sql)). When a ForgeRun
hits terminal `done`, flip delivery status `in_progress → review`. The manual Copy path lands in
`review` when the PM moves it there.

**Migrations to "mirror that":**
1. add `ProductRequirement.deliveryStatus` (enum/text, default `backlog`)
2. add `ProductRequirement.deployedToStagingAt` / `deployedToProductionAt` (mirror Sprint)
3. extend the kanban: insert a **Review** column between `done`(→rename "Ready for review") and a new
   **Production** column; re-point `classifyPrd` to read `deliveryStatus` as the human overlay on top
   of `runState`.

---

## 5. Forge integration changes — unlock the Design Session

**Today:** the Forge tab only runs PRDs from **one loaded session**. The lock is
`Project.forgeSourceSessionId`; `setForgeSourceSession` requires `session.type === 'prd_session'`;
`createForgeRunFromSession` then filters `status ∈ {approved, ready}`
(all in [forge-project.ts](../../../src/lib/dal/forge-project.ts) §334–360, §484–518, §708–813).

**V2:** the Forge accepts **any approved PRD linked to the project**, regardless of which session (if
any) authored it. Concretely:
- Drop the `forgeSourceSessionId` requirement from the run-launch path; add
  `createForgeRunFromProject(projectId, prdRefs[])` that snapshots a manifest from **project-scoped**
  approved PRDs (the manifest/snapshot machinery stays identical).
- Replace the **SessionLoader** UI ([forge-project-card.tsx](../../../src/components/forge/forge-project-card.tsx) §242–442)
  with a **PRD backlog/board selector** — pick PRDs (or a whole sprint) → run.
- The board's **Send to Forge** button = "add this PRD's ref to a run." Multi-select = run a batch /
  a sprint.

Everything downstream (`ForgeRun` → `ForgeJob` → daemon pickup, `verifiable` enforcement) is unchanged.

---

## 6. Planning rituals — re-point to PRD-level

| Ritual | Table | Plans over today | V2 |
|--------|-------|------------------|----|
| **Sprint Planning** | `PlanningCeremony` ([20260528b](../../../supabase/migrations/20260528b_planning_ceremony_core.sql)) | **Tasks** (via `Sprint.id`) | **which PRDs go in THIS sprint** (single-sprint commit) |
| **Release Planning** | `PlanningSession` + `PlanningSessionPRD` ([20260601a](../../../supabase/migrations/20260601a_planning_session.sql)/[b](../../../supabase/migrations/20260601b_planning_session_prd.sql)) | **PRDs across sprints** (already!) | unchanged in spirit — roadmap across many sprints |

Both rituals use **Vitoria** as the agent. Key facts:
- Release Planning **already plans PRDs → sprints**: `PlanningSessionPRD.productRequirementId` +
  `sprintStart`/`sprintCount`, with a drag-drop board ([planning-session/board.tsx](../../../src/components/planning-session/board.tsx))
  and tools `link_prd_to_sprint` / `move_prd` / `unlink_prd` ([vitoria/release-planning.ts](../../../src/lib/agent/agents/vitoria/release-planning.ts)).
  → **mostly done.** It's the multi-sprint horizon.
- Sprint Planning is the one that **re-points from Tasks to PRDs** — the single-sprint horizon ("commit
  these PRDs to sprint N"). Committing writes `ProductRequirement.sprintId` (D5).
- **Capacity gap:** the capacity widget sums **Task** function points. PRDs need their own estimate/FP
  (§3.3) so "PRDs fill a sprint" math keeps working.

**Horizon split (clean mental model):**
- Release Planning = *roadmap* (PRD → which sprint, across the release).
- Sprint Planning = *commit* (lock the PRDs for the active sprint, set `sprintId`, set `deliveryStatus=todo`).

---

## 7. How PRDs are created (resolved)

PRD **authoring is already fully built** — the only new work is letting **Vitoria open the door** from a
ceremony. The unifying frame (D12): **authoring is session-based** (Vitor's workbench), **consumption is
project-based** (board / Forge / planning read project PRDs).

### 7.1 The pipeline — Spec-first (D10)

```
Discovery (Design Session)
  → Vitor authors SPECS (feature narrative)
  → Vitor DECOMPOSES each Spec → PR-sized, repo-grounded PRDs   (propose-batch + curate)

Gap-fill (board / ceremony)
  → usually ONE more PRD slice under an existing Spec (occasionally a new thin Spec)
```

Invariant on every surface: Vitor **grounds in the repo**, **scans existing PRDs/Specs first** (dedup +
`dependsOn`), starts at `draft`/`backlog`, records origin.

### 7.2 Existing surfaces — reuse as-is (D11, D15)

All Vitor authoring surfaces share the **same PRD machinery + the same two-pane PRD-tree screen**
(PRD cards left, Vitor chat right; `propose_prd/update_prd/approve_prd`, [vitor/index.ts](../../../src/lib/agent/agents/vitor/index.ts)):

| Surface | What it is today | subKind |
|---------|------------------|---------|
| **Quick-ask** | `createPrdDraftSession` → finalize → PRD-tree screen ([quick-ask-sheet.tsx](../../../src/components/sessions/prd-session/quick-ask-sheet.tsx), [prd-briefing-step.tsx](../../../src/components/sessions/prd-session/prd-briefing-step.tsx)) | `quick_ask` |
| **Inception** | full DS; **briefing step** (the last of its 9 steps) runs the same Vitor PRD authoring | — (`type=inception`) |
| **Super** | inception-like, ends at the PRD tree | — (`type=super`) |
| **Vitória PRD session** | Vitoria-summoned (D13) — *visually identical*, tagged | **`vitoria_ask`** (new) |

**The new Spec layer (D14).** Vitor gains a **`propose_spec`** tool and **always creates PRDs inside a
Spec** (`ProductRequirement.userStoryId`). The PRD tree renders each Spec as a **collapsible card**
wrapping its PRDs. Vitor's PRD elaboration itself is unchanged. No new authoring UI beyond the Spec
card + relabeling the `UserStory` side sheet → Spec side sheet.

### 7.3 Vitoria in the ceremony (D13) — the only new build

Today Vitoria can `link_prd_to_sprint` / `move_prd` / `unlink_prd` + create tasks, but **cannot create a
session or a PRD** ([vitoria/tools.ts](../../../src/lib/agent/agents/vitoria/tools.ts)). The friction
("leave the ceremony to make a PRD") is closed by one orchestration capability — Vitoria does **not**
author:

1. PM hits a gap mid-Sprint-Planning and asks Vitoria for a PRD.
2. Vitoria **announces clearly**: *"summoning Vitor in the background — he's creating the PRD; it'll
   land in the PRD tree for this sprint."* (Transparency is a hard requirement — the user must always
   know Vitor is acting.)
3. Vitoria calls new tool **`ensure_sprint_prd_session`** → provision-or-reuse **one** session of
   **`subKind = vitoria_ask`** for this ceremony, linked via existing **`EntityLink.planningCeremonyId`**
   (no schema change). `createPrdDraftSession` gains an optional ceremony id + subKind.
4. **Background summon:** Vitoria invokes Vitor in that session — **no chat or screen switch** for the
   PM. Vitor authors (inside a Spec, D14); the PRD appears in the PRD tree for the sprint.
5. On approval, Vitoria allocates it to the sprint via **`allocatePrdToSprint`** (the single-sprint
   commit from `projects-v2-planning` that writes `ProductRequirement.sprintId` + `deliveryStatus=todo`).
   **Not** `link_prd_to_sprint` — that one writes `PlanningSessionPRD` (release-planning staging), a
   different mechanism.

**Resolved (was a fork):** background summon, **not** a deep-link/screen switch — per user preference.
The cost is the agent-in-agent plumbing (Vitoria → Vitor), bought in exchange for zero chat change.

**Granularity:** **one session per ceremony** (= per sprint, since `PlanningCeremony` is UNIQUE per
sprint), lazily created, reused across all gap-fills in that sprint. **Not** one-session-per-PRD. The
`vitoria_ask` subKind is what makes Vitoria-born PRDs visible/queryable as a set.

Lineage: `PRD.designSessionId` → session(`vitoria_ask`) → `EntityLink` → ceremony → sprint.

---

## 8. Smaller, codebase-grounded PRDs

**Granularity shift:** from ~1 big `ProductRequirement` per feature to **many PR-sized PRDs** under a
Spec. The shift is **scope, not structure** — each PRD keeps Vitor's full elaboration (problem/goal/
AC/`stories[]`); it just covers one slice (~1 PR). Roughly: a V2 PRD ≈ the scope of one old `story`,
but with the full PRD shape around it.

**Grounding:** ✅ **already solved** — our agents read repositories today. Vitor authors against the
real repo (real paths, conventions, patterns), so `touches[]` and AC reference code that exists. No new
infra; this is the "knows the codebase, doesn't hallucinate" property the user wants.

**Open: sizing heuristic.** Need a floor/ceiling so PRDs aren't too big or too small. Proposed default
(to confirm): **1 PRD = 1 PR ≈ a handful of files + 1–4 `verifiable` checks + ≤~30 min agent time.**
Encode it as a Vitor decomposition rule + a soft validator on `stories[]` length.

---

## 9. UI / clone plan

~90% of the UI clones for free — `sprint/*`, `story-hierarchy/*`, `TaskSheet`, the tab pattern are
data-agnostic. The work is: new route + admin gate, swap the **data hooks**, relabel, and **merge the
two side sheets**.

| Area | Action |
|------|--------|
| Route | `projects-v2/page.tsx` + `[id]/page.tsx`, admin gate at entry |
| Tabs | reuse tab pattern; tabs become Specs / Sprints / Forge / … |
| Board | **one shared `SpecPrdTree`** (`src/components/prd/spec-prd-tree.tsx`): PRDs grouped by Spec, collapsible Spec card, "Sem Spec" bucket — parameterized by `renderRowActions`/`renderBadge`. Consumed by **all three** PRD surfaces (V2 board, Vitor authoring screen, Sprint Planning) so the tree is built **once**, not three times. Derived from `story-hierarchy/stories-list.tsx` |
| **Side sheet** | **merge** `story-hierarchy/task-sheet.tsx` (status/assignee/sprint/notes/AC/feed) **+** the PRD viewer (`specMarkdown`, `stories[]`) into one PRD sheet; action row = **Send to Forge** · **Copy** |
| Hooks | new `_hooks/` that load PRDs (ProductRequirement) instead of Tasks |
| Kanban | **new** `projects-v2/[id]/forge/kanban` (admin-gated, mirrors the V2 area gate) with the Review + Production columns (§4.2). Classify logic extracted to `src/lib/forge/classify-prd.ts`. The legacy `projects/[id]/forge/kanban` is left untouched |

---

## 10. Schema changes (migrations, atomic — 1 per file)

1. `ProductRequirement.userStoryId` (FK → UserStory) — PRD's parent **Spec**.
2. `ProductRequirement.sprintId` (FK → Sprint, nullable) — PRD lives in a sprint.
3. `ProductRequirement.deliveryStatus` (text/enum, default `backlog`) — board axis (§4.2).
4. `ProductRequirement.deployedToStagingAt` / `deployedToProductionAt` (timestamptz) — mirror Sprint.
5. `ProductRequirement.estimateFp` (or reuse minutes) — sprint capacity math.
6. `ProductRequirement.assignees` (join table `ProductRequirementAssignee` or array) — board assignees.
7. `ProductRequirement.designSessionId` → make nullable + add `originRitualId` — project-scoped creation (§7).
8. RLS: keep `prd_read`/`prd_write` (managers / `can_view_project`); admin-gate the V2 *area* in app layer.

*(Each as its own dated file in `supabase/migrations/`, run via `psql "$DIRECT_URL" -f …`, then update
`database.types.ts`.)*

---

## 11. Phasing

- **Phase 1 — Schema + read-only V2 board.** Migrations §10 (1–6). Clone the projects area to
  `projects-v2/` (admin-gated), board reads PRDs, merged side sheet (view + Copy). No Forge change yet.
- **Phase 2 — Forge unlock + delivery status.** `createForgeRunFromProject`, Send-to-Forge button,
  delivery-status auto-transitions, **new admin-gated `projects-v2/[id]/forge/kanban`** with
  Review/Production columns (classify in `src/lib/forge/classify-prd.ts`).
- **Phase 3 — Planning re-point.** Sprint Planning plans PRDs (writes `sprintId`); PRD capacity math.
  Release Planning already there.
- **Phase 4 — PRD production from anywhere.** Reuse Vitor surfaces (D11); add Vitoria
  `ensure_sprint_prd_session` + ceremony-linked session (D13); board `+ New PRD` + Spec "Decompose".
- **Phase 5 — Sizing discipline.** Vitor decomposition rule + `stories[]` soft validator (§8).

---

## 12. Open questions (need decisions before building)

- ~~**Q1.** PRD production surface / handoff UX~~ — **RESOLVED** (D10–D15): Spec-first; reuse Vitor
  surfaces; Vitoria **background-summons** Vitor into a `vitoria_ask` session with clear messaging.
- **Q2.** Sizing heuristic — confirm "1 PRD = 1 PR ≈ ≤30 min, 1–4 verifiable"? (§8)
- **Q3.** Delivery-status vocabulary — adopt Task's exact set + `in_production`, or trim? (§4.2)
- **Q4.** Production lane — manual PM toggle, or auto on PR-merge detection? (§4.2)
- **Q5.** Does V2 fully replace the existing projects area eventually, or coexist long-term? (affects
  whether we relabel-in-place vs. keep a parallel tree)
- **Q6.** Spec layer — is it actively used in V2 (PM groups PRDs under Specs), or mostly a passthrough
  while the real action is at PRD level? (decides how much Spec UI to build in Phase 1)

---

## 13. References

- Code: [forge-project.ts](../../../src/lib/dal/forge-project.ts) · [product-requirements.ts](../../../src/lib/dal/product-requirements.ts) · [run-state.ts](../../../src/lib/forge/run-state.ts) · [forge/kanban/page.tsx](../../../src/app/(dashboard)/projects/[id]/forge/kanban/page.tsx) · [vitor/index.ts](../../../src/lib/agent/agents/vitor/index.ts) · [vitoria/release-planning.ts](../../../src/lib/agent/agents/vitoria/release-planning.ts)
- Memory: `project_vitor_as_pm`, `project_forge_prd_consumption`, `project_forge_double_diamond`, `project_rituals_taxonomy`, `project_sprint_planning_living_model`, `project_planning_session`, `project_vitor_context_pool`, `project_zordon_ops_pipeline`
