CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.clients DROP COLUMN IF EXISTS portal_password;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS portal_password_hash text;

REVOKE SELECT (portal_password_hash), UPDATE (portal_password_hash)
  ON public.clients FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.set_client_portal_password(_client_id uuid, _password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.clients
     SET portal_password_hash = CASE
           WHEN _password IS NULL OR length(_password) = 0 THEN NULL
           ELSE extensions.crypt(_password, extensions.gen_salt('bf'))
         END,
         portal_password_updated_at = now(),
         portal_password_updated_by = auth.uid()
   WHERE id = _client_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_client_portal_password(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_client_portal_password(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_client_portal_password(_client_id uuid, _password text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients
     WHERE id = _client_id
       AND portal_password_hash IS NOT NULL
       AND portal_password_hash = extensions.crypt(_password, portal_password_hash)
  );
$$;

REVOKE ALL ON FUNCTION public.verify_client_portal_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_client_portal_password(uuid, text) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id
       AND role IN (
         'director','admin','audit_manager','tax_consultant',
         'advisory_officer','accountant','accounts_assistant','intern'
       )
  )
$$;