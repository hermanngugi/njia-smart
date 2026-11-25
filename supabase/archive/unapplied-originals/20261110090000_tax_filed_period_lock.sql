-- ============================================================================
-- Tax: once a client's obligation is FILED (or invoiced) for a filing period,
-- that period is closed. No second record for the same client + tax type +
-- filing window can be filed or invoiced, so an obligation can never be
-- billed twice. Other, still-unfiled obligations are not affected.
--
-- The filing window follows the existing rule in tax_return_open_date():
-- monthly returns = the due-date month, annual returns = the due-date year.
-- The next period opens on its own date, as before.
--
-- Runs inside the database, so no screen or import can bypass it. Existing
-- rows are NOT changed. Run the CHECK query at the bottom to list any legacy
-- duplicates (same client + type + window already filed/invoiced twice).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_tax_return_one_filed_per_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window date;
BEGIN
  -- System maintenance without a signed-in user is not restricted here.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only matters when the row is filed or carries an invoice.
  IF NOT (NEW.status::text = 'filed' OR NEW.invoice_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  -- Updates that change nothing about filing/invoicing/period are fine.
  IF TG_OP = 'UPDATE'
     AND NEW.status::text = OLD.status::text
     AND NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id
     AND NEW.due_date IS NOT DISTINCT FROM OLD.due_date THEN
    RETURN NEW;
  END IF;

  -- Serialise per client + tax type so two people cannot file the same
  -- obligation at the same moment.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.client_id::text || ':' || NEW.return_type::text, 0)
  );

  v_window := public.tax_return_open_date(NEW.return_type::text, NEW.due_date);

  IF v_window IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.tax_returns t
     WHERE t.client_id = NEW.client_id
       AND t.return_type = NEW.return_type
       AND t.id <> NEW.id
       AND public.tax_return_open_date(t.return_type::text, t.due_date) = v_window
       AND (t.status::text = 'filed' OR t.invoice_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'This client''s % obligation is already filed or invoiced for this period. It stays closed until the next filing period opens.',
      NEW.return_type::text;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tax_return_one_filed_per_window ON public.tax_returns;
CREATE TRIGGER trg_tax_return_one_filed_per_window
BEFORE INSERT OR UPDATE OF status, invoice_id, due_date ON public.tax_returns
FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_one_filed_per_window();

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- CHECK 1: the trigger exists (should return one row).
-- ---------------------------------------------------------------------------
SELECT tgname FROM pg_trigger
 WHERE tgname = 'trg_tax_return_one_filed_per_window' AND NOT tgisinternal;

-- ---------------------------------------------------------------------------
-- CHECK 2: legacy duplicates already in your data (same client + tax type +
-- filing window filed/invoiced more than once). Empty result = none.
-- ---------------------------------------------------------------------------
SELECT client_id,
       return_type,
       public.tax_return_open_date(return_type::text, due_date) AS filing_window,
       count(*) AS filed_or_invoiced_records
  FROM public.tax_returns
 WHERE status::text = 'filed' OR invoice_id IS NOT NULL
 GROUP BY 1, 2, 3
HAVING count(*) > 1;
