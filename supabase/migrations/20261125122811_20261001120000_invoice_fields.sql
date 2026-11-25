-- ============================================================================
-- Extra invoice fields
--
--   invoices:       location, memo
--   invoice_items:  item_name, tax_code, tax_amount, service_date
--
-- Item name is the product/service heading (e.g. "Tax Advisory: Tax Advisory
-- and Consultancy"); the existing description / quantity / unit_price (the
-- "rate") / amount columns are unchanged.
--
-- Tax: each line carries a tax code. "Standard" lines are charged the invoice's
-- VAT rate exactly as before; "Exempt" and "Zero-rated" lines carry no VAT.
-- Existing lines all default to "Standard", so existing totals do not change.
-- ============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS memo     text;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS item_name    text,
  ADD COLUMN IF NOT EXISTS tax_code     text NOT NULL DEFAULT 'Standard'
    CHECK (tax_code IN ('Standard', 'Exempt', 'Zero-rated')),
  ADD COLUMN IF NOT EXISTS tax_amount   numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_date date;

-- Line tax amount is derived by the database so it can't drift from the rate.
CREATE OR REPLACE FUNCTION public.tg_invoice_item_tax()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rate numeric;
BEGIN
  IF COALESCE(NEW.tax_code, 'Standard') = 'Standard' THEN
    SELECT COALESCE(vat_rate, 0) INTO v_rate FROM public.invoices WHERE id = NEW.invoice_id;
    NEW.tax_amount := ROUND(COALESCE(NEW.amount, 0) * COALESCE(v_rate, 0) / 100, 2);
  ELSE
    NEW.tax_amount := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_item_tax ON public.invoice_items;
CREATE TRIGGER trg_invoice_item_tax
BEFORE INSERT OR UPDATE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_item_tax();

-- Same as before, except VAT is charged only on "Standard" lines.
CREATE OR REPLACE FUNCTION public.recompute_invoice(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub numeric(14,2);
  v_taxable numeric(14,2);
  v_rate numeric(5,2);
  v_vat numeric(14,2);
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_due date;
  v_status text;
BEGIN
  SELECT COALESCE(SUM(amount),0),
         COALESCE(SUM(amount) FILTER (WHERE COALESCE(tax_code,'Standard') = 'Standard'),0)
    INTO v_sub, v_taxable
    FROM public.invoice_items WHERE invoice_id = _invoice_id;
  SELECT vat_rate, due_date, status INTO v_rate, v_due, v_status FROM public.invoices WHERE id = _invoice_id;
  v_vat := ROUND(v_taxable * COALESCE(v_rate,0) / 100, 2);
  v_total := v_sub + v_vat;
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.payments WHERE invoice_id = _invoice_id;

  IF v_status = 'draft' THEN
    -- keep draft
    NULL;
  ELSIF v_paid >= v_total AND v_total > 0 THEN
    v_status := 'paid';
  ELSIF v_paid > 0 AND v_paid < v_total THEN
    v_status := 'partial';
  ELSIF v_due < CURRENT_DATE AND v_paid < v_total THEN
    v_status := 'overdue';
  ELSE
    v_status := COALESCE(NULLIF(v_status,'paid'),'sent');
    IF v_status = 'paid' THEN v_status := 'sent'; END IF;
  END IF;

  UPDATE public.invoices
    SET subtotal = v_sub, vat_amount = v_vat, total = v_total, amount_paid = v_paid, status = v_status, updated_at = now()
    WHERE id = _invoice_id;
END; $$;

-- Backfill line tax amounts for existing invoices. User triggers are switched
-- off for this one statement so it does not re-run totals/status or flood the
-- audit trail; the tax trigger's logic is applied directly instead.
ALTER TABLE public.invoice_items DISABLE TRIGGER USER;
UPDATE public.invoice_items ii
   SET tax_amount = ROUND(COALESCE(ii.amount, 0) * COALESCE(i.vat_rate, 0) / 100, 2)
  FROM public.invoices i
 WHERE i.id = ii.invoice_id AND ii.tax_code = 'Standard';
ALTER TABLE public.invoice_items ENABLE TRIGGER USER;
