-- PlanningCeremony — staging-commit model.
--
-- Dois ajustes coordenados:
--
-- 1) Drop UNIQUE(projectId, sprintId): plannings agora são append-only por
--    sprint. PM faz N plannings na mesma sprint (commits do "branch" sprint).
--    Mid-sprint ajustes acontecem em nova planning, não reabrindo a anterior.
--
-- 2) Replace do trigger validate_planning_phase_transition: a matriz ganha
--    atalhos `* → closed` pra qualquer fase ativa (idle/reading/proposing).
--    Razão: "Concluir planning" pode ser disparado de qualquer ponto, sem
--    passar pelas fases intermediárias. concludePlanning() (DAL) aplica os
--    pending actions em cascata antes do UPDATE de phase.
--
-- Espelho TS: src/lib/planning/phase.ts (ALLOWED_TRANSITIONS). Trigger é
-- GERADO via `npx tsx scripts/gen-phase-sql.ts`. NÃO editar à mão.

BEGIN;

-- 1) Drop UNIQUE — plannings múltiplas por sprint ok.
ALTER TABLE public."PlanningCeremony"
  DROP CONSTRAINT IF EXISTS "PlanningCeremony_project_sprint_key";

-- 2) Replace trigger — matriz nova com atalhos pra closed.
CREATE OR REPLACE FUNCTION public.validate_planning_phase_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Sem mudança de phase → passa direto (UPDATE de outros campos).
  IF NEW.phase = OLD.phase THEN
    RETURN NEW;
  END IF;

  -- Matriz de transições permitidas. GERADA por scripts/gen-phase-sql.ts
  -- a partir de src/lib/planning/phase.ts (ALLOWED_TRANSITIONS).
  -- NÃO editar à mão — regenerar via `npm run gen:phase-sql`.
  IF NOT (
     (OLD.phase = 'idle'      AND NEW.phase = 'reading')
  OR (OLD.phase = 'idle'      AND NEW.phase = 'closed')
  OR (OLD.phase = 'reading'   AND NEW.phase = 'proposing')
  OR (OLD.phase = 'reading'   AND NEW.phase = 'idle')     -- reset briefing
  OR (OLD.phase = 'reading'   AND NEW.phase = 'closed')
  OR (OLD.phase = 'proposing' AND NEW.phase = 'approving')
  OR (OLD.phase = 'proposing' AND NEW.phase = 'idle')     -- reset briefing
  OR (OLD.phase = 'proposing' AND NEW.phase = 'closed')
  OR (OLD.phase = 'approving' AND NEW.phase = 'closed')
  OR (OLD.phase = 'closed'    AND NEW.phase = 'archived')
  ) THEN
    RAISE EXCEPTION 'PlanningCeremony.phase: transição % → % não permitida',
      OLD.phase, NEW.phase
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
