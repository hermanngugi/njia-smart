-- ============================================================================
-- Tax: one filing per client + tax type + period, and a filed period is CLOSED.
--
-- Problems fixed
--   1. Two people could create / schedule a filing for the same client, type
--      and period (manual insert, or two sessions calling
--      set_client_tax_obligation at the same moment).
--   2. A filed return could be reopened by anyone, leaving the old period and
--      the auto-created next period both open.
--   3. The next period (created automatically on filing) could be filed the
--      same day, before its month had started.
--
-- Rules enforced here (in the database, so no screen can bypass them):
--   * No two tax_returns rows for the same client + return_type + period
--     (same due_date, or same period_end when one is set).
--   * Once filed, the period's client / type / dates are frozen, and only
--     Director/Admin may reopen it - and only if no other period is open.
--   * A return cannot be marked filed before its filing window opens
--     (1st of the due-date month; annual: 1 Jan of the due-date year).
--     After filing, the next period waits for that date.
--
-- Non-destructive: existing rows are NOT deleted or altered. Any legacy
-- duplicates are only reported (see the NOTICE at the bottom).
-- ============================================================================

-- 1. Filing window ------------------------------------------------------------
-- Keep in sync with src/lib/tax-period.ts.
CREATE OR REPLACE FUNCTION public.tax_return_open_date(_type text, _due date)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _due IS NULL THEN NULL
    WHEN public.tax_return_cadence(_type) = 'annual' THEN date_trunc('year', _due)::date
    ELSE date_trunc('month', _due)::date
  END;
$$;
GRANT EXECUTE ON FUNCTION public.tax_return_open_date(text, date) TO authenticated;

-- 2. Duplicate guard (serialised per client + type so two simultaneous
--    inserts cannot both pass the check) --------------------------------------
CREATE OR REPLACE FUNCTION public.tg_tax_return_no_duplicate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Updates that don't touch the period identity can't create a duplicate.
  IF TG_OP = 'UPDATE'
     AND NEW.client_id   IS NOT DISTINCT FROM OLD.client_id
     AND NEW.return_type IS NOT DISTINCT FROM OLD.return_type
     AND NEW.due_date    IS NOT DISTINCT FROM OLD.due_date
     AND NEW.period_end  IS NOT DISTINCT FROM OLD.period_end THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.client_id::text || ':' || NEW.return_type::text, 0));

  IF EXISTS (
    SELECT 1 FROM public.tax_returns t
    WHERE t.client_id = NEW.client_id
      AND t.return_type = NEW.return_type
      AND t.id <> NEW.id
      AND (t.due_date = NEW.due_date
           OR (NEW.period_end IS NOT NULL AND t.period_end = NEW.period_end))
  ) THEN
    RAISE EXCEPTION 'A % filing for this client already exists for the period due % - open the existing one instead of creating a duplicate.',
      NEW.return_type, to_char(NEW.due_date, 'DD Mon YYYY')
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tax_return_no_duplicate ON public.tax_returns;
CREATE TRIGGER trg_tax_return_no_duplicate
BEFORE INSERT OR UPDATE ON public.tax_returns
FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_no_duplicate();

-- 3. Lock a filed period + enforce the filing window --------------------------
-- auth.uid() IS NULL (SQL editor / service role / migrations) is not restricted.
CREATE OR REPLACE FUNCTION public.tg_tax_return_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Filed => closed.
  IF OLD.status = 'filed' THEN
    IF NEW.client_id   IS DISTINCT FROM OLD.client_id
       OR NEW.return_type  IS DISTINCT FROM OLD.return_type
       OR NEW.due_date     IS DISTINCT FROM OLD.due_date
       OR NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end   IS DISTINCT FROM OLD.period_end THEN
      RAISE EXCEPTION 'This period is already filed and closed - its client, type and dates can no longer be changed.';
    END IF;

    IF NEW.status IS DISTINCT FROM 'filed' THEN
      IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'This period is already filed and closed. Only a Director or Admin can reopen it.';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.tax_returns t
        WHERE t.client_id = OLD.client_id
          AND t.return_type = OLD.return_type
          AND t.id <> OLD.id
          AND t.status <> 'filed'
      ) THEN
        RAISE EXCEPTION 'Cannot reopen: the next period for this client is already open. Remove or file that one first.';
      END IF;
    END IF;

  -- Not filed yet -> filed: only once the period's window has opened.
  ELSIF NEW.status = 'filed'
        AND (now() AT TIME ZONE 'Africa/Nairobi')::date < public.tax_return_open_date(NEW.return_type::text, NEW.due_date) THEN
    RAISE EXCEPTION 'This period is not open for filing yet - it opens on %. The previous period is closed and the next one waits for its month.',
      to_char(public.tax_return_open_date(NEW.return_type::text, NEW.due_date), 'DD Mon YYYY');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tax_return_lock ON public.tax_returns;
CREATE TRIGGER trg_tax_return_lock
BEFORE UPDATE ON public.tax_returns
FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_lock();

-- 4. Auto-renew: reuse the next period if it already exists instead of
--    inserting a duplicate (which the guard above would now reject).
--    Identical to the latest version (20260929090000) except the lookup.
CREATE OR REPLACE FUNCTION public.tg_tax_return_filed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_status text := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
  v_next_due date;
  v_next_start date;
  v_next_end date;
  v_span int;
  v_new_id uuid;
  v_obligation_active boolean;
BEGIN
  IF v_old_status = 'filed' AND NEW.status IS DISTINCT FROM 'filed' THEN
    NEW.filed_at := NULL;
    NEW.filed_by := NULL;
  END IF;

  IF NEW.status = 'filed' AND (v_old_status IS DISTINCT FROM 'filed') AND NEW.filed_at IS NULL THEN
    NEW.filed_at := now();
    NEW.filed_by := COALESCE(NEW.filed_by, auth.uid());

    IF TG_OP = 'UPDATE' AND NEW.renewed_to_id IS NULL THEN
      SELECT active INTO v_obligation_active
        FROM public.client_tax_obligations
        WHERE client_id = NEW.client_id AND tax_type = NEW.return_type;

      IF COALESCE(v_obligation_active, true) THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(NEW.client_id::text || ':' || NEW.return_type::text, 0));

        v_next_due := public.next_tax_due_date(NEW.return_type::text, NEW.due_date);

        IF NEW.period_start IS NOT NULL AND NEW.period_end IS NOT NULL THEN
          v_span := (NEW.period_end - NEW.period_start);
          v_next_start := NEW.period_end + 1;
          v_next_end := v_next_start + v_span;
        ELSE
          v_next_start := NULL;
          v_next_end := NULL;
        END IF;

        SELECT id INTO v_new_id FROM public.tax_returns
          WHERE client_id = NEW.client_id
            AND return_type = NEW.return_type
            AND id <> NEW.id
            AND (due_date = v_next_due OR (v_next_end IS NOT NULL AND period_end = v_next_end))
          LIMIT 1;

        IF v_new_id IS NULL THEN
          INSERT INTO public.tax_returns
            (client_id, return_type, period_start, period_end, due_date, status, assigned_to)
          VALUES
            (NEW.client_id, NEW.return_type, v_next_start, v_next_end, v_next_due, 'pending', NEW.assigned_to)
          RETURNING id INTO v_new_id;
        END IF;

        NEW.renewed_to_id := v_new_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Scheduling RPC: take the same lock, and never re-create a period that
--    already exists (e.g. this month's is filed -> schedule NEXT month's).
CREATE OR REPLACE FUNCTION public.set_client_tax_obligation(_client_id uuid, _tax_type text, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_exists boolean;
  v_due date;
  v_guard int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_client_id::text || ':' || _tax_type, 0));

  INSERT INTO public.client_tax_obligations (client_id, tax_type, active)
  VALUES (_client_id, _tax_type, _active)
  ON CONFLICT (client_id, tax_type) DO UPDATE SET active = _active, updated_at = now();

  IF _active THEN
    SELECT EXISTS(
      SELECT 1 FROM public.tax_returns
      WHERE client_id = _client_id AND return_type = _tax_type AND status != 'filed'
    ) INTO v_exists;

    IF NOT v_exists THEN
      v_due := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM CURRENT_DATE)::int, public.tax_return_due_day(_tax_type));
      IF v_due < CURRENT_DATE THEN
        v_due := public.next_tax_due_date(_tax_type, v_due);
      END IF;

      -- Skip any period that already has a (filed) record.
      WHILE v_guard < 24 AND EXISTS (
        SELECT 1 FROM public.tax_returns
        WHERE client_id = _client_id AND return_type = _tax_type AND due_date = v_due
      ) LOOP
        v_due := public.next_tax_due_date(_tax_type, v_due);
        v_guard := v_guard + 1;
      END LOOP;

      INSERT INTO public.tax_returns (client_id, return_type, due_date, status)
      VALUES (_client_id, _tax_type, v_due, 'pending');
    END IF;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_client_tax_obligation(uuid, text, boolean) TO authenticated;

-- 6. Report (don't touch) any duplicates that already exist ------------------
DO $$
DECLARE v_groups int;
BEGIN
  SELECT count(*) INTO v_groups FROM (
    SELECT 1 FROM public.tax_returns
    GROUP BY client_id, return_type, due_date HAVING count(*) > 1
  ) d;
  IF v_groups > 0 THEN
    RAISE NOTICE '% client/type/due-date group(s) already have duplicate tax_returns rows. They were left untouched - review and remove the extras manually.', v_groups;
  END IF;
END $$;
