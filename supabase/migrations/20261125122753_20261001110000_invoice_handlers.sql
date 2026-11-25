-- ============================================================================
-- Invoice handlers
--
-- Records who was handling the client's account (staff assigned to the client)
-- at the moment each invoice was raised, so Accounts can show a person's
-- portfolio and export it. Deliberately a SEPARATE table: nothing here is part
-- of the invoice itself, so it never appears on the invoice document, and
-- later changes to the client's team don't rewrite past invoices.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.invoice_handlers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_handlers_user ON public.invoice_handlers(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_handlers TO authenticated;
GRANT ALL ON public.invoice_handlers TO service_role;
ALTER TABLE public.invoice_handlers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice handlers select" ON public.invoice_handlers;
CREATE POLICY "invoice handlers select" ON public.invoice_handlers
  FOR SELECT TO authenticated USING (public.can_view_module_all(auth.uid(), 'accounts'));

DROP POLICY IF EXISTS "invoice handlers write full only" ON public.invoice_handlers;
CREATE POLICY "invoice handlers write full only" ON public.invoice_handlers
  FOR ALL TO authenticated
  USING (public.has_full_module(auth.uid(), 'accounts'))
  WITH CHECK (public.has_full_module(auth.uid(), 'accounts'));

-- Every new invoice (manual, or generated on task completion) snapshots the
-- client's currently assigned staff.
CREATE OR REPLACE FUNCTION public.tg_invoice_snapshot_handlers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.invoice_handlers (invoice_id, user_id)
  SELECT NEW.id, ca.user_id
    FROM public.client_assignments ca
    WHERE ca.client_id = NEW.client_id
  ON CONFLICT (invoice_id, user_id) DO NOTHING;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_snapshot_handlers ON public.invoices;
CREATE TRIGGER trg_invoice_snapshot_handlers
AFTER INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_snapshot_handlers();

-- Backfill existing invoices from the client's current team (best available
-- record for invoices raised before this existed).
INSERT INTO public.invoice_handlers (invoice_id, user_id)
SELECT i.id, ca.user_id
  FROM public.invoices i
  JOIN public.client_assignments ca ON ca.client_id = i.client_id
ON CONFLICT (invoice_id, user_id) DO NOTHING;
