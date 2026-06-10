# Projects V2 — DB Changes Registry (rollback ledger)

> Single source of truth for **every database object Projects V2 adds**. Each row is appended
> when its migration lands. The consolidated `*_pv2_rollback.sql` drops these in reverse order.
> See [projects-v2-isolation-plan.md §6](./projects-v2-isolation-plan.md).

## Rules

- **Additive only on shared tables.** `ADD COLUMN` (nullable), `CREATE TABLE`, triggers/policies
  on **v2 columns only**. Never `ALTER`/`DROP`/retype a column v1 reads.
- **Tag every object.** Filename `YYYYMMDD_pv2_<name>.sql`; `COMMENT ON … IS 'projects-v2 · …'`.
- **Append a row here** the moment a migration is written. No silent DB changes.
- **Keep the rollback current.** Every row maps to a DROP line in `*_pv2_rollback.sql`.

## Ledger

| # | Object | Kind | On table | Migration | Rollback line |
|---|--------|------|----------|-----------|---------------|
| _none yet — schema PRD not run_ | | | | | |

<!--
Example rows once schema runs:
| 1 | ProductRequirement.userStoryId | column (FK→UserStory, nullable) | ProductRequirement | 20260604a_pv2_prd_user_story_id.sql | ALTER TABLE "ProductRequirement" DROP COLUMN "userStoryId"; |
| 2 | ProductRequirement.sprintId | column (FK→Sprint, nullable) | ProductRequirement | 20260604b_pv2_prd_sprint_id.sql | ALTER TABLE "ProductRequirement" DROP COLUMN "sprintId"; |
| 7 | ProductRequirementAssignee | table + RLS | (new) | 20260604g_pv2_product_requirement_assignee.sql | DROP TABLE "ProductRequirementAssignee"; |
-->

## Consolidated rollback

`supabase/migrations/<latest>_pv2_rollback.sql` — drops all rows above in reverse dependency
order. Run with:

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/<latest>_pv2_rollback.sql
```
