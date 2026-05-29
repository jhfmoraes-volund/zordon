-- Add UI theme preference to Member.
--
-- charcoal = default (grafite premium); oled = preto absoluto. Source of truth
-- da lista de temas válidos: src/lib/theme/themes.ts. Sem CHECK constraint por
-- design — adicionar tema novo = só TS + CSS, sem migration acoplada.
-- Server faz fallback ao default em caso de id desconhecido.

ALTER TABLE public."Member"
  ADD COLUMN "theme" text NOT NULL DEFAULT 'charcoal';

COMMENT ON COLUMN public."Member"."theme" IS
  'UI theme id. Validado em src/lib/theme/themes.ts. Sem CHECK por design.';
