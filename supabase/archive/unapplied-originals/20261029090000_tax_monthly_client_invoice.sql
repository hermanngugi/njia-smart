-- ============================================================================
-- Tax: ONE invoice per client PER MONTH that grows as obligations are filed.
--
-- First obligation filed for a client in a month -> a new draft invoice is
-- created. Every later obligation filed for that client in the same month is
-- ADDED to that same invoice (new line, totals recomputed by the existing
-- invoice_items trigger, description rebuilt). A new month -> a new invoice.
--
-- The month's invoice is reused only while it is still a DRAFT. Once it has
-- been sent / paid it is left untouched (it may already be with the client or
-- exported to QuickBooks) and the next filing starts a new invoice.
--
-- Month = the month the filing is done in (Africa/Nairobi), i.e. the invoice's
-- issue date. Replaces create_tax_filing_invoice(); it now returns jsonb
-- {invoice_id, invoice_number, created}.
-- ============================================================================
DROP FUNCTION IF EXISTS public.create_tax_filing_invoice(jsonb, numeric);

CREATE OR REPLACE FUNCTION public.create_tax_filing_invoice(
  _items    jsonb,          -- [{"return_id": "...", "description": "...", "amount": 1500}, ...]
  _vat_rate numeric DEFAULT 16
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
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
  v_number    text;
  v_created   boolean := false;
  v_item      jsonb;
  v_i         int;
  v_memo      text;
  v_old_memo  text;
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

  -- Serialise per client so two people filing at once share one invoice.
  PERFORM pg_advisory_xact_lock(hashtextextended('tax-invoice:' || v_client::text, 0));

  -- This month's invoice for the client: still a draft, and already carrying
  -- tax filings from this flow.
  SELECT i.id, i.invoice_number, i.memo INTO v_inv, v_number, v_old_memo
    FROM public.invoices i
   WHERE i.client_id = v_client
     AND i.status = 'draft'
     AND date_trunc('month', i.issue_date) = date_trunc('month', v_today)
     AND EXISTS (SELECT 1 FROM public.tax_returns t WHERE t.invoice_id = i.id)
   ORDER BY i.issue_date DESC, i.created_at DESC
   LIMIT 1;

  IF v_inv IS NULL THEN
    v_number := public.next_invoice_number();
    INSERT INTO public.invoices (invoice_number, client_id, issue_date, due_date, service_line, vat_rate, created_by)
    VALUES (v_number, v_client, v_today, v_today + 7, 'Tax', COALESCE(_vat_rate, 16), auth.uid())
    RETURNING id INTO v_inv;
    v_created := true;
    v_i := 0;
  ELSE
    -- Keep the payment date ahead of the latest activity on the invoice.
    UPDATE public.invoices SET due_date = GREATEST(due_date, v_today + 7) WHERE id = v_inv;
    SELECT COALESCE(max(sort_order), -1) + 1 INTO v_i FROM public.invoice_items WHERE invoice_id = v_inv;
  END IF;

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

  -- Invoice description: every obligation on the invoice + the month.
  -- A description someone edited by hand is left alone.
  IF v_old_memo IS NULL OR v_old_memo LIKE 'Tax filings:%' THEN
    SELECT 'Tax filings: ' || string_agg(label, ', ' ORDER BY ord, label) || ' - ' || to_char(v_today, 'Mon YYYY')
      INTO v_memo
      FROM (
        SELECT DISTINCT ON (t.return_type) COALESCE(p.label, t.return_type) AS label, COALESCE(p.sort_order, 999) AS ord
          FROM public.tax_returns t
          LEFT JOIN public.tax_policies p ON p.tax_type = t.return_type
         WHERE t.invoice_id = v_inv
         ORDER BY t.return_type
      ) l;
    UPDATE public.invoices SET memo = v_memo WHERE id = v_inv;
  END IF;

  RETURN jsonb_build_object('invoice_id', v_inv, 'invoice_number', v_number, 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.create_tax_filing_invoice(jsonb, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_tax_filing_invoice(jsonb, numeric) TO authenticated;
