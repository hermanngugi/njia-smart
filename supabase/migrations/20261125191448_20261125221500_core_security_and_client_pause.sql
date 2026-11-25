-- Njia Smart consolidated repair 01: core role and paused-client boundaries.
-- Supersedes the unapplied draft migrations 20261021100000 and 20261021120000.
-- Additive and data-preserving; does not change role assignments or client records.

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN (
        'director','admin','audit_manager','tax_consultant',
        'advisory_officer','accountant','accounts_assistant','intern',
        'marketing','tax_assistant','audit_assistant','internal_admin','ict_officer'
      )
  );
$$;
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;

-- Internal Admin is deliberately NOT elevated to database Admin.
CREATE OR REPLACE FUNCTION public.guard_client_activation_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.is_paused IS DISTINCT FROM OLD.is_paused
    OR NEW.paused_at IS DISTINCT FROM OLD.paused_at
    OR NEW.paused_by IS DISTINCT FROM OLD.paused_by
  ) AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a Director or Admin can activate or pause a client.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_client_activation_changes ON public.clients;
CREATE TRIGGER guard_client_activation_changes
BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.guard_client_activation_changes();

CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _client_id IS NULL THEN true
    WHEN public.is_admin(auth.uid()) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = _client_id AND NOT COALESCE(c.is_paused, false)
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.can_access_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_client(uuid) TO authenticated, service_role;

-- Keep existing module-rank and assignment rules; add the paused-client filter.
DROP POLICY IF EXISTS "clients select staff" ON public.clients;
DROP POLICY IF EXISTS "clients select by rank" ON public.clients;
CREATE POLICY "clients select by rank" ON public.clients
FOR SELECT TO authenticated
USING (
  (NOT COALESCE(clients.is_paused, false) OR public.is_admin(auth.uid()))
  AND (
    public.can_view_module_all(auth.uid(), 'clients')
    OR (
      public.is_module_assigned_only(auth.uid(), 'clients')
      AND EXISTS (
        SELECT 1 FROM public.client_assignments ca
        WHERE ca.client_id = clients.id AND ca.user_id = auth.uid()
      )
    )
  )
);

-- Restrict access to every client-linked table without replacing its existing
-- permissive module/assignment policies. NULL client_id rows remain unaffected.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'client_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name <> 'clients'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   'paused_client_access_guard', r.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (client_id IS NULL OR public.can_access_client(client_id)) WITH CHECK (client_id IS NULL OR public.can_access_client(client_id))',
      'paused_client_access_guard', r.table_name
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
