-- PlanningCeremony.phase — trigger SQL guardrail.
--
-- A state machine rica (pré-condições + side effects) vive em
-- src/lib/planning/phase.ts. Este trigger é o CINTO DE SEGURANÇA contra
-- escrita via service_role / seed / SQL direto que pule a camada de API.
--
-- Regra única: a transição (old.phase → new.phase) tem que estar na MATRIZ
-- de transições permitidas. Pré-condições (ex: "≥1 transcript linkado pra
-- idle→reading") são responsabilidade do TS — o trigger não tenta replicar.
--
-- Aprendizado: Meeting tem can_view_meeting nos 2 lados (TS + SQL). Phase
-- segue o mesmo princípio: TS valida rico, SQL é fail-safe.
--
-- Aditivo e idempotente: DROP/CREATE da função e do trigger.

BEGIN;

CREATE OR REPLACE FUNCTION public.validate_planning_phase_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Sem mudança de phase → passa direto (UPDATE de outros campos).
  IF NEW.phase = OLD.phase THEN
    RETURN NEW;
  END IF;

  -- Matriz de transições permitidas. Espelha src/lib/planning/phase.ts.
  -- Se algo aqui for divergir do TS, isso É um bug — alinhar antes de mergear.
  IF NOT (
       (OLD.phase = 'idle'      AND NEW.phase = 'reading')
    OR (OLD.phase = 'reading'   AND NEW.phase = 'proposing')
    OR (OLD.phase = 'reading'   AND NEW.phase = 'idle')        -- reset briefing
    OR (OLD.phase = 'proposing' AND NEW.phase = 'approving')
    OR (OLD.phase = 'proposing' AND NEW.phase = 'idle')        -- reset briefing
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

DROP TRIGGER IF EXISTS planning_phase_guardrail ON public."PlanningCeremony";

CREATE TRIGGER planning_phase_guardrail
  BEFORE UPDATE OF phase ON public."PlanningCeremony"
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_planning_phase_transition();

COMMIT;
