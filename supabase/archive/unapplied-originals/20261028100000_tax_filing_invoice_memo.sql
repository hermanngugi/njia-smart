-- ============================================================================
-- Tax: the single per-client filing invoice now carries a description listing
-- every obligation filed (invoices.memo), in addition to one line per
-- obligation with its own amount. Same signature as 20261026100000, so this
-- simply replaces the function.
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
  v_memo      text;
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

  -- Invoice description: every obligation filed, in the order entered, plus the
  -- filing month(s) - e.g. "Tax filings: PAYE, NSSF, SHA, VAT - Oct 2026".
  SELECT 'Tax filings: ' || string_agg(COALESCE(p.label, t.return_type), ', ' ORDER BY e.ord)
         || ' - ' ||
         CASE WHEN to_char(min(t.due_date), 'Mon YYYY') = to_char(max(t.due_date), 'Mon YYYY')
              THEN to_char(min(t.due_date), 'Mon YYYY')
              ELSE to_char(min(t.due_date), 'Mon YYYY') || ' to ' || to_char(max(t.due_date), 'Mon YYYY') END
    INTO v_memo
    FROM jsonb_array_elements(_items) WITH ORDINALITY AS e(item, ord)
    JOIN public.tax_returns t ON t.id = (e.item->>'return_id')::uuid
    LEFT JOIN public.tax_policies p ON p.tax_type = t.return_type;

  INSERT INTO public.invoices (invoice_number, client_id, issue_date, due_date, service_line, vat_rate, memo, created_by)
  VALUES (public.next_invoice_number(), v_client, CURRENT_DATE, CURRENT_DATE + 7, 'Tax', COALESCE(_vat_rate, 16), v_memo, auth.uid())
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
