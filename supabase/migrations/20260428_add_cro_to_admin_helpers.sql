-- Include 'cro' alongside ceo/head-ops in admin/manager helpers used by RLS.
-- Without this, CRO members fail manager_or_viewer_select on Project (and any
-- other policy gated by is_manager()/is_admin()) and see zero rows.

CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
AS $$
  SELECT public.get_my_role() IN ('ceo', 'cro', 'head-ops')
$$;

CREATE OR REPLACE FUNCTION public.is_manager()
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
AS $$
  SELECT public.get_my_role() IN ('pm', 'head-ops', 'ceo', 'cro')
$$;
