-- ============================================================================
-- Tax: ONE invoice per client for the obligations filed together.
--
-- create_tax_filing_invoice() takes the client's selected tax returns (with an
-- amount per obligation), creates a single draft invoice with one line per
-- obligation, and links that same invoice to every selected return. The
-- caller then marks the returns filed; the existing "invoice required before
-- filing" guard (tg_require_completion_invoice) is satisfied by the link.
--
-- Everything is checked in the database:
--   * every return must belong to the SAME client
--   * none may already be filed or already invoiced
--   * the caller must be allowed to update each return (same rule as the
--     tax_returns update policy: full Tax access, or assigned-only staff on
--     their own / their client's returns)
--   * total must be greater than zero (a single obligation may be 0 if it is
--     billed within the bundle)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_tax_filing_invoice(
  _items    jsonb,          -- [{"return_id": "...", "description": "...", "amount": 1500}, ...]
  _vat_rate numeric DEFAULT 16
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids       uuid[];
  v_cnt       int;
  v_total     numeric;
  v_neg       int;
  v_found     int;
  v_clients   int;
  v_client    uuid;
  v_invoiced  int;
  v_filed     int;
  v_denied    int;
  v_inv       uuid;
  v_item      jsonb;
  v_i         int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Select at least one obligation to invoice.';
  END IF;

  SELECT array_agg((e->>'return_id')::uuid),
         count(*),
         COALESCE(sum(COALESCE((e->>'amount')::numeric, 0)), 0),
         count(*) FILTER (WHERE COALESCE((e->>'amount')::numeric, 0) < 0)
    INTO v_ids, v_cnt, v_total, v_neg
    FROM jsonb_array_elements(_items) e;

  IF v_neg > 0 THEN
    RAISE EXCEPTION 'Amounts cannot be negative.';
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Enter an invoice amount greater than zero.';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> v_cnt THEN
    RAISE EXCEPTION 'The same obligation was listed twice.';
  END IF;

  -- Lock the rows so two people can't invoice the same filings at once.
  PERFORM 1 FROM public.tax_returns WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  SELECT count(*),
         count(DISTINCT client_id),
         (array_agg(client_id))[1],
         count(*) FILTER (WHERE invoice_id IS NOT NULL),
         count(*) FILTER (WHERE status::text = 'filed'),
         count(*) FILTER (WHERE NOT (
              public.has_full_module(auth.uid(), 'tax')
              OR (public.is_module_assigned_only(auth.uid(), 'tax')
                  AND (assigned_to = auth.uid()
                       OR EXISTS (SELECT 1 FROM public.client_assignments ca
                                  WHERE ca.client_id = tax_returns.client_id AND ca.user_id = auth.uid())))))
    INTO v_found, v_clients, v_client, v_invoiced, v_filed, v_denied
    FROM public.tax_returns WHERE id = ANY(v_ids);

  IF v_found <> v_cnt THEN
    RAISE EXCEPTION 'One or more selected filings no longer exist.';
  END IF;
  IF v_clients <> 1 THEN
    RAISE EXCEPTION 'One invoice covers one client - select obligations for a single client.';
  END IF;
  IF v_filed > 0 THEN
    RAISE EXCEPTION 'One or more selected filings are already filed and closed.';
  END IF;
  IF v_invoiced > 0 THEN
    RAISE EXCEPTION 'One or more selected filings already have an invoice.';
  END IF;
  IF v_denied > 0 THEN
    RAISE EXCEPTION 'You are not allowed to file one or more of the selected returns.';
  END IF;

  INSERT INTO public.invoices (invoice_number, client_id, issue_date, due_date, service_line, vat_rate, created_by)
  VALUES (public.next_invoice_number(), v_client, CURRENT_DATE, CURRENT_DATE + 7, 'Tax', COALESCE(_vat_rate, 16), auth.uid())
  RETURNING id INTO v_inv;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order)
    VALUES (
      v_inv,
      COALESCE(NULLIF(trim(v_item->>'description'), ''), 'Tax filing'),
      1,
      COALESCE((v_item->>'amount')::numeric, 0),
      COALESCE((v_item->>'amount')::numeric, 0),
      v_i
    );
    v_i := v_i + 1;
  END LOOP;

  UPDATE public.tax_returns SET invoice_id = v_inv WHERE id = ANY(v_ids);

  RETURN v_inv;
END;
$$;

REVOKE ALL ON FUNCTION public.create_tax_filing_invoice(jsonb, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_tax_filing_invoice(jsonb, numeric) TO authenticated;
