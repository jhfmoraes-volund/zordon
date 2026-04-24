-- Allow draft tasks generated during a design session to exist without a reference.
-- Tasks with status='draft' + reference=NULL are session-scoped and excluded from
-- project backlog/sprint views until the session is exported.
-- On export, the reference is populated via next_task_reference() and status flips to 'backlog'.
ALTER TABLE public."Task" ALTER COLUMN reference DROP NOT NULL;
