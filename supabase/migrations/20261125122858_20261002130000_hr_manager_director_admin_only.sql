-- The updated access matrix moves Accountant's HR access from Full to
-- View-only, so Accountant can no longer create/edit employee records,
-- documents or payslips. HR management (is_hr_manager) is now Director/Admin
-- only. Leave approval is unaffected — Accountant remains a leave approver
-- (see LEAVE_APPROVAL_ROLES in src/lib/permissions.ts), that's a separate,
-- narrower permission from general HR record management.
CREATE OR REPLACE FUNCTION public.is_hr_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('director', 'admin')
  )
$$;
