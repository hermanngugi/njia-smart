-- Internal GK documents in the central Documents library.
-- Keep client-prefixed objects subject to the existing active-client guard.
-- Internal objects still require the existing Documents module storage policies.
-- Only unlinked client_master metadata is visible to users with Documents view access.

CREATE OR REPLACE FUNCTION private.document_path_client_accessible(_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_segment text := split_part(COALESCE(_path, ''), '/', 1);
  v_client uuid;
BEGIN
  -- Internal files are not tied to a client. The permissive Storage policies
  -- still require the caller to have Documents module access.
  IF v_segment = 'internal' THEN
    RETURN true;
  END IF;

  -- All client files retain the existing UUID + active-client access check.
  IF v_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  v_client := v_segment::uuid;
  RETURN public.can_access_client(v_client);
END;
$function$;

-- Assigned-only Documents users may circulate unlinked internal records.
-- Client-linked documents continue to require the previous full-module or
-- client-assignment checks. Restricted metadata remains admin-only through
-- the existing restrictive documents_restricted_guard policy.
DROP POLICY IF EXISTS documents_select_consolidated ON public.documents;
CREATE POLICY documents_select_consolidated
ON public.documents
FOR SELECT
TO authenticated
USING (
  private.can_view_module_all((SELECT auth.uid()), 'documents')
  OR (
    client_id IS NULL
    AND document_group = 'client_master'
    AND private.can_view_module((SELECT auth.uid()), 'documents')
  )
  OR (
    private.is_module_assigned_only((SELECT auth.uid()), 'documents')
    AND (
      uploaded_by = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.client_assignments ca
        WHERE ca.client_id = documents.client_id
          AND ca.user_id = (SELECT auth.uid())
      )
    )
  )
  OR (
    private.can_view_module((SELECT auth.uid()), 'tax')
    AND tax_return_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.tax_returns t
      WHERE t.id = documents.tax_return_id
        AND t.client_id = documents.client_id
    )
  )
);

NOTIFY pgrst, 'reload schema';
