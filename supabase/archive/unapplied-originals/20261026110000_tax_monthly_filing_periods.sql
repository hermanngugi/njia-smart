-- ============================================================================
-- Tax: create an independent monthly filing record for each active monthly
-- obligation through the current month, even when earlier months are unfiled.
-- The current month remains available from the first day of its due month;
-- the due date is used for deadline/overdue display, not as a filing gate.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_tax_return_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'filed' THEN
    IF NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.return_type IS DISTINCT FROM OLD.return_type
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end IS DISTINCT FROM OLD.period_end THEN
      RAISE EXCEPTION 'This period is already filed and closed - its client, type and dates can no longer be changed.';
    END IF;

    IF NEW.status IS DISTINCT FROM 'filed' AND NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'This period is already filed and closed. Only a Director or Admin can reopen it.';
    END IF;
  ELSIF NEW.status = 'filed'
        AND (now() AT TIME ZONE 'Africa/Nairobi')::date < public.tax_return_open_date(NEW.return_type::text, NEW.due_date) THEN
    RAISE EXCEPTION 'This period is not open for filing yet - it opens on %. The current filing period opens at the start of its due-date month.',
      to_char(public.tax_return_open_date(NEW.return_type::text, NEW.due_date), 'DD Mon YYYY');
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_current_tax_filing_periods()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obligation record;
  v_current_month date := date_trunc('month', (now() AT TIME ZONE 'Africa/Nairobi'))::date;
  v_first_month date;
  v_month date;
  v_due date;
  v_due_day integer;
  v_period_start date;
  v_period_end date;
  v_assigned_to uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access_financials(auth.uid()) THEN
    RAISE EXCEPTION 'You are not authorised to prepare tax filing periods.';
  END IF;

  FOR v_obligation IN
    SELECT o.client_id, o.tax_type
    FROM public.client_tax_obligations o
    JOIN public.tax_policies p ON p.tax_type::text = o.tax_type::text
    WHERE o.active = true AND p.active = true
  LOOP
    -- Annual returns retain their existing annual scheduling behaviour.
    IF public.tax_return_cadence(v_obligation.tax_type::text) <> 'monthly' THEN
      CONTINUE;
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_obligation.client_id::text || ':' || v_obligation.tax_type::text, 0)
    );

    SELECT date_trunc('month', min(t.due_date))::date
      INTO v_first_month
    FROM public.tax_returns t
    WHERE t.client_id = v_obligation.client_id
      AND t.return_type::text = v_obligation.tax_type::text;

    IF v_first_month IS NULL THEN
      v_first_month := v_current_month;
    END IF;

    IF v_first_month > v_current_month THEN
      CONTINUE;
    END IF;

    SELECT t.assigned_to
      INTO v_assigned_to
    FROM public.tax_returns t
    WHERE t.client_id = v_obligation.client_id
      AND t.return_type::text = v_obligation.tax_type::text
    ORDER BY t.due_date DESC
    LIMIT 1;

    v_due_day := public.tax_return_due_day(v_obligation.tax_type::text);
    v_month := v_first_month;

    WHILE v_month <= v_current_month LOOP
      v_due := LEAST(
        v_month + (v_due_day - 1),
        (v_month + INTERVAL '1 month - 1 day')::date
      );
      v_period_start := (v_month - INTERVAL '1 month')::date;
      v_period_end := v_month - 1;

      IF NOT EXISTS (
        SELECT 1
        FROM public.tax_returns t
        WHERE t.client_id = v_obligation.client_id
          AND t.return_type::text = v_obligation.tax_type::text
          AND t.due_date = v_due
      ) THEN
        INSERT INTO public.tax_returns
          (client_id, return_type, period_start, period_end, due_date, status, assigned_to)
        VALUES
          (v_obligation.client_id, v_obligation.tax_type, v_period_start, v_period_end, v_due, 'pending', v_assigned_to);
      END IF;

      v_month := (v_month + INTERVAL '1 month')::date;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_current_tax_filing_periods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_current_tax_filing_periods() TO authenticated;
