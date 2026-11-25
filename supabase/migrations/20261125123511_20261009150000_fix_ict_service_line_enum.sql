-- Fix ICT completion invoicing to use the lowercase enum key for service_line.
-- The UI label is "ICT", but public.service_module_type stores "ict".
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
             WHEN 'ict'                           THEN 'ict'
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
