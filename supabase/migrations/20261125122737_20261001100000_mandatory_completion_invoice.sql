-- ============================================================================
-- Mandatory invoice on completion
--
-- Work that is billable (tax filings, audit engagements, advisory projects and
-- the service modules: ICT, Outsourced Accounting, Payroll Management,
-- Financial Business Management) can no longer be marked complete unless an
-- invoice has been generated for it under that client. The invoice is the
-- proof the task is done, the same way "Filed" is for tax.
--
-- 1. invoice_id link on the tables that did not have one (tax_returns has it).
-- 2. create_completion_invoice(): one call that creates the invoice + line
--    item under the client and links it to the record. SECURITY DEFINER so the
--    person handling the account can always generate it, even when their
--    Accounts role cannot insert invoices directly.
-- 3. A BEFORE UPDATE guard that rejects the completing transition (not edits
--    to records that are already complete) when no invoice is linked.
--    Records that were completed before this migration are left alone.
-- ============================================================================

-- 1. Links ----------------------------------------------------------------
ALTER TABLE public.engagements       ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
ALTER TABLE public.advisory_projects ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
ALTER TABLE public.service_projects  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_engagements_invoice       ON public.engagements(invoice_id);
CREATE INDEX IF NOT EXISTS idx_advisory_projects_invoice ON public.advisory_projects(invoice_id);
CREATE INDEX IF NOT EXISTS idx_service_projects_invoice  ON public.service_projects(invoice_id);

-- 2. Generate + link the invoice -------------------------------------------
CREATE OR REPLACE FUNCTION public.create_completion_invoice(
  _source      text,
  _source_id   uuid,
  _description text,
  _amount      numeric,
  _vat_rate    numeric DEFAULT 16
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client   uuid;
  v_existing uuid;
  v_line     text;
  v_found    boolean := false;
  v_inv      uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Enter an invoice amount greater than zero.';
  END IF;

  IF _source = 'tax_returns' THEN
    SELECT client_id, invoice_id, 'Tax' INTO v_client, v_existing, v_line
      FROM public.tax_returns WHERE id = _source_id FOR UPDATE;
    v_found := FOUND;
  ELSIF _source = 'engagements' THEN
    SELECT client_id, invoice_id, initcap(type::text) INTO v_client, v_existing, v_line
      FROM public.engagements WHERE id = _source_id FOR UPDATE;
    v_found := FOUND;
  ELSIF _source = 'advisory_projects' THEN
    SELECT client_id, invoice_id, 'Advisory' INTO v_client, v_existing, v_line
      FROM public.advisory_projects WHERE id = _source_id FOR UPDATE;
    v_found := FOUND;
  ELSIF _source = 'service_projects' THEN
    SELECT client_id, invoice_id,
           CASE module
             WHEN 'ict'                           THEN 'ICT'
             WHEN 'outsourced_accounting'         THEN 'Outsourced Accounting'
             WHEN 'payroll_management'            THEN 'Payroll Management'
             WHEN 'financial_business_management' THEN 'Financial Business Management'
             ELSE module
           END
      INTO v_client, v_existing, v_line
      FROM public.service_projects WHERE id = _source_id FOR UPDATE;
    v_found := FOUND;
  ELSE
    RAISE EXCEPTION 'Unknown source %', _source;
  END IF;

  IF NOT v_found THEN
    RAISE EXCEPTION 'Record not found';
  END IF;

  -- Already invoiced: hand back the existing one instead of double-billing.
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.invoices (invoice_number, client_id, issue_date, due_date, service_line, vat_rate, created_by)
  VALUES (public.next_invoice_number(), v_client, CURRENT_DATE, CURRENT_DATE + 7, v_line, COALESCE(_vat_rate, 16), auth.uid())
  RETURNING id INTO v_inv;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order)
  VALUES (v_inv, COALESCE(NULLIF(trim(_description), ''), v_line || ' services'), 1, _amount, _amount, 0);

  IF _source = 'tax_returns' THEN
    UPDATE public.tax_returns       SET invoice_id = v_inv WHERE id = _source_id;
  ELSIF _source = 'engagements' THEN
    UPDATE public.engagements       SET invoice_id = v_inv WHERE id = _source_id;
  ELSIF _source = 'advisory_projects' THEN
    UPDATE public.advisory_projects SET invoice_id = v_inv WHERE id = _source_id;
  ELSE
    UPDATE public.service_projects  SET invoice_id = v_inv WHERE id = _source_id;
  END IF;

  RETURN v_inv;
END;
$$;

REVOKE ALL ON FUNCTION public.create_completion_invoice(text, uuid, text, numeric, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_completion_invoice(text, uuid, text, numeric, numeric) TO authenticated;

-- 3. Guard -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_require_completion_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new boolean;
  v_old boolean;
BEGIN
  IF TG_TABLE_NAME = 'tax_returns' THEN
    v_new := NEW.status::text = 'filed';
    v_old := OLD.status::text = 'filed';
  ELSIF TG_TABLE_NAME = 'engagements' THEN
    v_new := NEW.status::text = 'completed';
    v_old := OLD.status::text = 'completed';
  ELSE  -- advisory_projects, service_projects
    v_new := NEW.status::text = 'completed' OR NEW.stage = 'closed';
    v_old := OLD.status::text = 'completed' OR OLD.stage = 'closed';
  END IF;

  IF v_new AND NOT v_old AND NEW.invoice_id IS NULL THEN
    RAISE EXCEPTION 'Generate an invoice for this client before marking this complete.'
      USING HINT = 'Use the "Generate invoice" step when completing the task.';
  END IF;
  RETURN NEW;
END;
$$;

-- "00_" so it runs ahead of the other BEFORE UPDATE triggers (e.g. the tax
-- auto-renew), which must never fire for a completion that gets rejected.
DROP TRIGGER IF EXISTS trg_tax_return_00_require_invoice ON public.tax_returns;
CREATE TRIGGER trg_tax_return_00_require_invoice
BEFORE UPDATE ON public.tax_returns
FOR EACH ROW EXECUTE FUNCTION public.tg_require_completion_invoice();

DROP TRIGGER IF EXISTS trg_engagement_00_require_invoice ON public.engagements;
CREATE TRIGGER trg_engagement_00_require_invoice
BEFORE UPDATE ON public.engagements
FOR EACH ROW EXECUTE FUNCTION public.tg_require_completion_invoice();

DROP TRIGGER IF EXISTS trg_advisory_00_require_invoice ON public.advisory_projects;
CREATE TRIGGER trg_advisory_00_require_invoice
BEFORE UPDATE ON public.advisory_projects
FOR EACH ROW EXECUTE FUNCTION public.tg_require_completion_invoice();

DROP TRIGGER IF EXISTS trg_service_project_00_require_invoice ON public.service_projects;
CREATE TRIGGER trg_service_project_00_require_invoice
BEFORE UPDATE ON public.service_projects
FOR EACH ROW EXECUTE FUNCTION public.tg_require_completion_invoice();
