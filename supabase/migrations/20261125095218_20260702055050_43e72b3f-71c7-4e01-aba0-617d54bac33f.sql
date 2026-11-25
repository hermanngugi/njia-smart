
-- Invoices
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  service_line TEXT,
  currency TEXT NOT NULL DEFAULT 'KES',
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 16,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices staff all" ON public.invoices FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Invoice line items
CREATE TABLE public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(14,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_items staff all" ON public.invoice_items FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Payments
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  amount NUMERIC(14,2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  method TEXT NOT NULL DEFAULT 'mpesa',
  reference TEXT,
  notes TEXT,
  recorded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments staff all" ON public.payments FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Trigger to recompute invoice totals + amount_paid + status
CREATE OR REPLACE FUNCTION public.recompute_invoice(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub numeric(14,2);
  v_rate numeric(5,2);
  v_vat numeric(14,2);
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_due date;
  v_status text;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO v_sub FROM public.invoice_items WHERE invoice_id = _invoice_id;
  SELECT vat_rate, due_date, status INTO v_rate, v_due, v_status FROM public.invoices WHERE id = _invoice_id;
  v_vat := ROUND(v_sub * COALESCE(v_rate,0) / 100, 2);
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

CREATE OR REPLACE FUNCTION public.tg_recompute_invoice_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_invoice(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER trg_invoice_items_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_invoice_items();

CREATE OR REPLACE FUNCTION public.tg_recompute_invoice_payments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_invoice(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER trg_payments_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_invoice_payments();

-- Invoice number generator (INV-YYYY-0001)
CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year text := to_char(CURRENT_DATE,'YYYY');
  v_count int;
BEGIN
  SELECT COUNT(*)+1 INTO v_count FROM public.invoices WHERE invoice_number LIKE 'INV-'||v_year||'-%';
  RETURN 'INV-'||v_year||'-'||lpad(v_count::text,4,'0');
END; $$;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO authenticated;

-- Activity log triggers
CREATE TRIGGER log_invoices AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();
CREATE TRIGGER log_payments AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

-- updated_at trigger for invoices
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
