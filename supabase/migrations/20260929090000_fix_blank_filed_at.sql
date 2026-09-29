-- ============================================================================
-- Fix: "Filed on" blank in the Tax > Filing Record tab.
--
-- tg_tax_return_filed() (which stamps filed_at/filed_by) has only ever been
-- attached as a BEFORE UPDATE trigger. Any tax_returns row that was ever
-- INSERTed already carrying status = 'filed' — a CSV import, a manual
-- Supabase Studio edit, a seed script, or an obligation synced in with
-- historical filings — never passed through an UPDATE, so the trigger never
-- ran and filed_at was left NULL despite status = 'filed'. That's the blank
-- date you're seeing.
--
-- This re-attaches the trigger to fire on INSERT too (matching how tasks/
-- invoices already do it — see 20260928100000), and backfills every
-- currently-filed row that's missing filed_at, using the best timestamp we
-- actually have on the row (assigned_at, then updated_at) rather than
-- inventing "now" for filings that happened in the past.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_tax_return_filed ON public.tax_returns;
CREATE TRIGGER trg_tax_return_filed
BEFORE INSERT OR UPDATE ON public.tax_returns
FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_filed();

-- tg_tax_return_filed() reads OLD.status, which doesn't exist on INSERT.
-- Make it INSERT-safe: treat a brand-new row as having no prior status.
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
  -- Reopened: drop the filed stamp so it never shows a stale time.
  IF v_old_status = 'filed' AND NEW.status IS DISTINCT FROM 'filed' THEN
    NEW.filed_at := NULL;
    NEW.filed_by := NULL;
  END IF;

  IF NEW.status = 'filed' AND (v_old_status IS DISTINCT FROM 'filed') AND NEW.filed_at IS NULL THEN
    NEW.filed_at := now();
    NEW.filed_by := COALESCE(NEW.filed_by, auth.uid());

    -- Auto-renew only applies to updates on an existing filing, not an
    -- already-filed row being inserted directly (e.g. a historical import) —
    -- there's no prior period here to roll forward from.
    IF TG_OP = 'UPDATE' AND NEW.renewed_to_id IS NULL THEN
      SELECT active INTO v_obligation_active
        FROM public.client_tax_obligations
        WHERE client_id = NEW.client_id AND tax_type = NEW.return_type;

      IF COALESCE(v_obligation_active, true) THEN
        v_next_due := public.next_tax_due_date(NEW.return_type, NEW.due_date);

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
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill: any row already marked filed but missing the timestamp. We don't
-- know the real filing moment for these, so use the closest thing on record
-- (when it was last assigned/touched) rather than "now", which would make
-- old filings look like they just happened.
UPDATE public.tax_returns
SET filed_at = COALESCE(assigned_at, updated_at, now())
WHERE status = 'filed' AND filed_at IS NULL;
