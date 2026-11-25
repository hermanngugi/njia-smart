-- Tax filing workflow: obligation checklist -> file -> auto-renew for next period
-- -> keep filed period as history (with its documents) -> billing.

-- 1. Link documents to a specific filing period, and a filing to its invoice.
ALTER TABLE public.tax_returns
  ADD COLUMN IF NOT EXISTS filed_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS renewed_to_id uuid REFERENCES public.tax_returns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tax_returns_invoice ON public.tax_returns(invoice_id);
CREATE INDEX IF NOT EXISTS idx_tax_returns_renewed_to ON public.tax_returns(renewed_to_id);

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS tax_return_id uuid REFERENCES public.tax_returns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_tax_return ON public.documents(tax_return_id);

-- 2. Cadence/due-day rules per return type (mirrors RETURN_TYPES in src/routes/_authed/tax.tsx).
CREATE OR REPLACE FUNCTION public.tax_return_due_day(_type text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _type
    WHEN 'paye' THEN 9
    WHEN 'nssf' THEN 9
    WHEN 'sha' THEN 9
    WHEN 'nita' THEN 9
    WHEN 'corp_tax' THEN 30
    WHEN 'nil' THEN 30
    WHEN 'income_tax' THEN 30
    ELSE 20
  END;
$$;

CREATE OR REPLACE FUNCTION public.tax_return_cadence(_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _type
    WHEN 'corp_tax' THEN 'annual'
    WHEN 'income_tax' THEN 'annual'
    ELSE 'monthly'
  END;
$$;

-- Given the due date just filed, work out the due date of the next filing period.
CREATE OR REPLACE FUNCTION public.next_tax_due_date(_type text, _cur_due date)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_cadence text := public.tax_return_cadence(_type);
  v_day int := public.tax_return_due_day(_type);
  v_base date := COALESCE(_cur_due, CURRENT_DATE);
  v_year int;
  v_month int;
BEGIN
  IF v_cadence = 'annual' THEN
    v_year := EXTRACT(YEAR FROM v_base)::int + 1;
    v_month := EXTRACT(MONTH FROM v_base)::int;
  ELSE
    v_year := EXTRACT(YEAR FROM v_base)::int;
    v_month := EXTRACT(MONTH FROM v_base)::int + 1;
    IF v_month > 12 THEN
      v_month := 1;
      v_year := v_year + 1;
    END IF;
  END IF;

  RETURN make_date(v_year, v_month, v_day);
EXCEPTION WHEN others THEN
  -- day doesn't exist in that month (e.g. day 30 in Feb) -> clamp to month end
  RETURN (make_date(v_year, v_month, 1) + INTERVAL '1 month - 1 day')::date;
END;
$$;

-- 3. When a return flips to 'filed', stamp filed_at and create the next period's
--    checklist item automatically (the filed row itself stays behind as history).
CREATE OR REPLACE FUNCTION public.tg_tax_return_filed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next_due date;
  v_next_start date;
  v_next_end date;
  v_span int;
  v_new_id uuid;
BEGIN
  IF NEW.status = 'filed' AND (OLD.status IS DISTINCT FROM 'filed') THEN
    NEW.filed_at := now();

    IF NEW.renewed_to_id IS NULL THEN
      v_next_due := public.next_tax_due_date(NEW.return_type::text, NEW.due_date);

      IF NEW.period_start IS NOT NULL AND NEW.period_end IS NOT NULL THEN
        v_span := (NEW.period_end - NEW.period_start);
        v_next_start := NEW.period_end + 1;
        v_next_end := v_next_start + v_span;
      ELSE
        v_next_start := NULL;
        v_next_end := NULL;
      END IF;

      INSERT INTO public.tax_returns
        (client_id, return_type, period_start, period_end, due_date, status, assigned_to)
      VALUES
        (NEW.client_id, NEW.return_type, v_next_start, v_next_end, v_next_due, 'pending', NEW.assigned_to)
      RETURNING id INTO v_new_id;

      NEW.renewed_to_id := v_new_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tax_return_filed ON public.tax_returns;
CREATE TRIGGER trg_tax_return_filed
BEFORE UPDATE ON public.tax_returns
FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_filed();

GRANT EXECUTE ON FUNCTION public.tax_return_due_day(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_return_cadence(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_tax_due_date(text, date) TO authenticated;
