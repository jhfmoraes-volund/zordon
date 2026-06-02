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
  OR (OLD.phase = 'closed'    AND NEW.phase = 'proposing')
  OR (OLD.phase = 'closed'    AND NEW.phase = 'archived')
  ) THEN
    RAISE EXCEPTION 'PlanningCeremony.phase: transição % → % não permitida',
      OLD.phase, NEW.phase
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
