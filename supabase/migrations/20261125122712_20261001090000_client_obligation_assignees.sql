-- ============================================================================
-- Client obligation assignees
--
-- Staff assigned to a client can now be given specific tax obligations under
-- that client (e.g. Jane -> VAT + PAYE for Client X). This table is the
-- standing rule, so every FUTURE period that auto-renews for that client/tax
-- type picks the same people up automatically.
--
-- Nothing existing is altered: tax_returns.assigned_to (primary) and
-- tax_return_assignees (collaborators) keep working exactly as before, and
-- both stay on the row after it is filed, which is what the "Assigned to"
-- column in the filing records reads.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_obligation_assignees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tax_type    text NOT NULL REFERENCES public.tax_policies(tax_type),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, tax_type, user_id)
);

CREATE INDEX IF NOT EXISTS idx_client_obl_assignees_client ON public.client_obligation_assignees(client_id, tax_type);
CREATE INDEX IF NOT EXISTS idx_client_obl_assignees_user   ON public.client_obligation_assignees(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_obligation_assignees TO authenticated;
GRANT ALL ON public.client_obligation_assignees TO service_role;
ALTER TABLE public.client_obligation_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client obligation assignees select" ON public.client_obligation_assignees;
CREATE POLICY "client obligation assignees select" ON public.client_obligation_assignees
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "client obligation assignees write full only" ON public.client_obligation_assignees;
CREATE POLICY "client obligation assignees write full only" ON public.client_obligation_assignees
  FOR ALL TO authenticated
  USING (public.has_full_module(auth.uid(), 'clients'))
  WITH CHECK (public.has_full_module(auth.uid(), 'clients'));

-- New filings (manual or auto-renewed) pick up the standing assignees.
-- BEFORE INSERT: fill the primary assignee only when none was given.
-- Named "00_" so it runs before trg_tax_return_assigned stamps assigned_at/by.
CREATE OR REPLACE FUNCTION public.tg_tax_return_default_assignee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_to IS NULL THEN
    SELECT user_id INTO NEW.assigned_to
      FROM public.client_obligation_assignees
      WHERE client_id = NEW.client_id AND tax_type = NEW.return_type
      ORDER BY created_at
      LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tax_return_00_default_assignee ON public.tax_returns;
CREATE TRIGGER trg_tax_return_00_default_assignee
BEFORE INSERT ON public.tax_returns
FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_default_assignee();

-- AFTER INSERT: everyone else on the standing list becomes a collaborator.
CREATE OR REPLACE FUNCTION public.tg_tax_return_default_collaborators()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tax_return_assignees (tax_return_id, user_id, role, assigned_by)
  SELECT NEW.id, a.user_id, 'Assigned obligation', a.assigned_by
    FROM public.client_obligation_assignees a
    WHERE a.client_id = NEW.client_id
      AND a.tax_type = NEW.return_type
      AND a.user_id IS DISTINCT FROM NEW.assigned_to
  ON CONFLICT (tax_return_id, user_id) DO NOTHING;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_tax_return_default_collaborators ON public.tax_returns;
CREATE TRIGGER trg_tax_return_default_collaborators
AFTER INSERT ON public.tax_returns
FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_default_collaborators();
