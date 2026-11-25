-- Realtime coverage for Clients, Documents and HR pages.
-- Adds the remaining tables to the supabase_realtime publication.
-- Safe to re-run: tables already in the publication (or views) are skipped.
-- Note: leave_balances is a VIEW, so it cannot be published; it is covered
-- by leave_requests changes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients', 'client_assignments', 'client_contacts', 'client_tax_obligations',
    'engagements', 'advisory_projects', 'tasks', 'tax_returns',
    'documents',
    'profiles', 'user_roles', 'hr_employment', 'hr_documents',
    'leave_types', 'leave_requests', 'payslips'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END $$;
