-- ============================================================================
-- Permanent fix: invalid input value for enum service_module_type
--
-- Root cause: invoices.service_line is a general billing label (Audit, Tax,
-- Advisory, Outsourced Accounting, ICT, ...). Your live database had it typed
-- as the enum service_module_type (schema drift, never in the migrations),
-- which only allows the four module keys (ict, outsourced_accounting,
-- payroll_management, financial_business_management). Any invoice written
-- with a display label ("Outsourced Accounting") was rejected.
--
-- This migration supersedes 20261009150000 and 20261009160000 and is safe to
-- run whether or not they were applied:
--   1. Makes the column plain TEXT (idempotent).
--   2. Adds normalize_service_line(): every spelling (ict / ICT /
--      outsourced_accounting / "Outsourced Accounting") maps to ONE canonical
--      display label.
--   3. A trigger normalizes on every insert/update, so no code path (UI, RPC,
--      import, MCP tool) can ever store a different spelling again.
--   4. Rebuilds create_completion_invoice() to use the canonical labels.
-- ============================================================================

-- 1. Column -> text ----------------------------------------------------------
DO $$
DECLARE v_type text;
BEGIN
  SELECT data_type INTO v_type
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'service_line';

  IF v_type IS DISTINCT FROM 'text' THEN
    ALTER TABLE public.invoices ALTER COLUMN service_line DROP DEFAULT;
    ALTER TABLE public.invoices ALTER COLUMN service_line TYPE text USING service_line::text;
  END IF;
END $$;

-- 2. One canonical spelling ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_service_line(_v text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(regexp_replace(btrim(coalesce(_v, '')), '[\s_\-]+', ' ', 'g'))
    WHEN ''                               THEN NULL
    WHEN 'ict'                            THEN 'ICT'
    WHEN 'outsourced accounting'          THEN 'Outsourced Accounting'
    WHEN 'payroll management'             THEN 'Payroll Management'
    WHEN 'financial business management'  THEN 'Financial Business Management'
    ELSE btrim(_v)
  END
$$;

-- 3. Enforce it on every write -----------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_invoices_normalize_service_line()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.service_line := public.normalize_service_line(NEW.service_line);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoices_normalize_service_line ON public.invoices;
CREATE TRIGGER trg_invoices_normalize_service_line
BEFORE INSERT OR UPDATE OF service_line ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_normalize_service_line();

-- Clean up existing rows (e.g. 'ict' / 'outsourced_accounting' from the enum days).
-- Trigger-only change: other user triggers are not needed for this backfill.
UPDATE public.invoices
   SET service_line = public.normalize_service_line(service_line)
 WHERE service_line IS DISTINCT FROM public.normalize_service_line(service_line);

-- 4. Completion invoice generator ------------------------------------------
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
    SELECT client_id, invoice_id, public.normalize_service_line(module::text)
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
