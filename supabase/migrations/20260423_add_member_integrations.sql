-- ─── Member Integrations (per-user API tokens) ────────────
-- Stores per-PM credentials for third-party services (Roam, etc).
-- Secrets live in Supabase Vault (vault.secrets); only the vault.secrets.id
-- is kept here. Access is restricted to service_role via RPCs below.

CREATE TABLE public."MemberIntegration" (
  "memberId"   TEXT NOT NULL REFERENCES public."Member"(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,            -- 'roam' | future: 'github' | 'composio' ...
  "secretId"   UUID NOT NULL,            -- vault.secrets.id
  "tokenHint"  TEXT,                     -- last 4 chars, for UI display
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("memberId", provider)
);

-- Lock it down: RLS on, no policies = no direct access from authenticated role.
-- Server code uses service_role which bypasses RLS.
ALTER TABLE public."MemberIntegration" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."MemberIntegration" FROM anon, authenticated;

-- ─── RPC: upsert integration (encrypts token into Vault) ──
CREATE OR REPLACE FUNCTION public.set_member_integration(
  p_member_id  TEXT,
  p_provider   TEXT,
  p_token      TEXT,
  p_token_hint TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_existing_secret_id UUID;
  v_new_secret_id      UUID;
BEGIN
  SELECT "secretId" INTO v_existing_secret_id
  FROM public."MemberIntegration"
  WHERE "memberId" = p_member_id AND provider = p_provider;

  IF v_existing_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_secret_id, p_token);
    UPDATE public."MemberIntegration"
    SET "tokenHint" = p_token_hint,
        "updatedAt" = now()
    WHERE "memberId" = p_member_id AND provider = p_provider;
  ELSE
    v_new_secret_id := vault.create_secret(
      p_token,
      format('member_%s_%s', p_member_id, p_provider)
    );
    INSERT INTO public."MemberIntegration"("memberId", provider, "secretId", "tokenHint")
    VALUES (p_member_id, p_provider, v_new_secret_id, p_token_hint);
  END IF;
END;
$$;

-- ─── RPC: read decrypted token ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_member_integration_secret(
  p_member_id TEXT,
  p_provider  TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id UUID;
  v_secret    TEXT;
BEGIN
  SELECT "secretId" INTO v_secret_id
  FROM public."MemberIntegration"
  WHERE "memberId" = p_member_id AND provider = p_provider;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = v_secret_id;

  RETURN v_secret;
END;
$$;

-- ─── RPC: delete integration (also removes vault secret) ──
CREATE OR REPLACE FUNCTION public.delete_member_integration(
  p_member_id TEXT,
  p_provider  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT "secretId" INTO v_secret_id
  FROM public."MemberIntegration"
  WHERE "memberId" = p_member_id AND provider = p_provider;

  IF v_secret_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public."MemberIntegration"
  WHERE "memberId" = p_member_id AND provider = p_provider;

  DELETE FROM vault.secrets WHERE id = v_secret_id;
END;
$$;

-- Only service_role may call these (server-side, after DAL validates identity).
REVOKE EXECUTE ON FUNCTION public.set_member_integration(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_member_integration_secret(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_member_integration(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_integration(TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_member_integration_secret(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_member_integration(TEXT, TEXT) TO service_role;
