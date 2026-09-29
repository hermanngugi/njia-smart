-- ============================================================================
-- "Last updated" audit trail for the main operational records.
--
-- Tax already tracks filed_at/filed_by/assigned_at. This extends the same
-- idea — when was this record last changed, and by whom — to clients,
-- tasks, engagements (audit), audit_workpapers, advisory_projects and
-- documents, so the same question can be answered anywhere in the system,
-- not just on a tax filing.
--
-- public.set_updated_at() already exists (used by invoices) and only touches
-- updated_at, so it's left alone. public.set_record_audit() is new: it sets
-- BOTH updated_at and updated_by on every UPDATE, via a plain trigger (no
-- security definer needed — the row is already visible/writable to the
-- caller under its own RLS policy, we're just stamping who did it).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_record_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients', 'tasks', 'engagements', 'audit_workpapers',
    'advisory_projects', 'documents'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I_record_audit ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_record_audit BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_record_audit()', t, t);
  END LOOP;
END $$;

-- invoices already has updated_at (from its own trigger) but never captured
-- who — add updated_by and switch it onto the same audit trigger.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
DROP TRIGGER IF EXISTS invoices_updated_at ON public.invoices;
CREATE TRIGGER invoices_record_audit BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_record_audit();
