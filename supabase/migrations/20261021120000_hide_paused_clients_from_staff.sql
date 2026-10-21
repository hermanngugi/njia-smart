-- Paused clients are hidden from ordinary staff at the database boundary.
-- Admin/Director can still see paused clients so they can review and reactivate them.

-- Used by restrictive policies on client-linked tables. SECURITY DEFINER lets this
-- check see the client row even when the caller's client SELECT policy hides it.
CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = _client_id
        AND NOT COALESCE(c.is_paused, false)
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_client(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_client(uuid) TO authenticated;

-- Keep the existing module-rank/assignment logic, while excluding paused clients
-- from every non-Admin/Director client list query.
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
          SELECT 1
          FROM public.client_assignments ca
          WHERE ca.client_id = clients.id
            AND ca.user_id = auth.uid()
        )
      )
    )
  );

-- Add a restrictive guard to every public table with a client_id column.
-- This prevents bypassing the client detail page by opening its tax returns,
-- documents, engagements, tasks, contacts, assignments, or other linked records
-- through their separate modules. NULL client_id rows remain unaffected.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'client_id'
      AND tb.table_type = 'BASE TABLE'
      AND c.table_name <> 'clients'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'paused_client_access_guard', t.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (client_id IS NULL OR public.can_access_client(client_id)) WITH CHECK (client_id IS NULL OR public.can_access_client(client_id))',
      'paused_client_access_guard', t.table_name
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
