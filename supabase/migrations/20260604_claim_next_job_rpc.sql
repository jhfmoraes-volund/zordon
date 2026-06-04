-- claim_next_job — claim atômico de ForgeJob pro zordon-daemon (D3=combo).
--
-- Substitui o claim two-step (SELECT+UPDATE não-atômico) de
-- src/lib/forge/dal/job.ts por uma transação única com FOR UPDATE SKIP LOCKED,
-- consertando a race FDM-003 e habilitando múltiplos daemons concorrentes.
--
-- SECURITY DEFINER: roda com privilégio do owner (bypassa RLS), MAS resolve o
-- member do caller via auth.uid() — NUNCA confia num id passado pelo cliente.
-- Logo um user só consegue claimar jobs com ownerId == seu próprio Member.id
-- OU assignToAnyone = true. Concedida só a `authenticated`.

CREATE OR REPLACE FUNCTION public.claim_next_job(p_daemon_id uuid, p_kind text)
RETURNS SETOF public."ForgeJob"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member uuid;
  v_job_id uuid;
BEGIN
  -- Identidade do caller a partir do JWT.
  SELECT id INTO v_member FROM public."Member" WHERE "userId" = auth.uid();

  -- Job elegível mais antigo, com lock; SKIP LOCKED evita corrida entre daemons.
  SELECT id INTO v_job_id
  FROM public."ForgeJob"
  WHERE status = 'queued'
    AND kind = p_kind
    AND ("assignToAnyone" = true
         OR (v_member IS NOT NULL AND "ownerId" = v_member))
  ORDER BY "createdAt" ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job_id IS NULL THEN
    RETURN; -- nada elegível pra esse caller/kind
  END IF;

  RETURN QUERY
  UPDATE public."ForgeJob"
  SET status = 'claimed',
      "claimedBy" = p_daemon_id,
      "claimedAt" = now(),
      "heartbeatAt" = now(),
      "updatedAt" = now()
  WHERE id = v_job_id
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_job(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_next_job(uuid, text) TO authenticated;
-- PoC local roda com service-role (guard de localhost no daemon).
GRANT EXECUTE ON FUNCTION public.claim_next_job(uuid, text) TO service_role;
