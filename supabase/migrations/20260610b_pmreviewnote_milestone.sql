-- PMReviewNote kind 'milestone' + coluna dueAt — data-marco do projeto.
-- A Vitoria emite no PM Review semanal o próximo marco relevante (go-live,
-- entrega de fase, demo) com data; o Overview de projetos mostra como chip.
-- dueAt é nullable: só kind='milestone' usa (enforced por CHECK).
ALTER TABLE "PMReviewNote"
  ADD COLUMN "dueAt" date;

ALTER TABLE "PMReviewNote"
  DROP CONSTRAINT "PMReviewNote_kind_check";

ALTER TABLE "PMReviewNote"
  ADD CONSTRAINT "PMReviewNote_kind_check" CHECK (kind = ANY (ARRAY[
    'summary'::text,            -- panorama geral (entra no início do report)
    'project_direction'::text,  -- rumo do projeto
    'next_step'::text,
    'risk'::text,
    'need'::text,               -- recursos, decisões, inputs pendentes
    'team_signal'::text,        -- capacidade, moral, blockers do time
    'open_decision'::text,
    'milestone'::text           -- próximo marco do projeto (com dueAt)
  ]));

-- Marco sem data não vira chip — exige dueAt quando kind='milestone'.
ALTER TABLE "PMReviewNote"
  ADD CONSTRAINT "PMReviewNote_milestone_due_check"
  CHECK (kind <> 'milestone' OR "dueAt" IS NOT NULL);
