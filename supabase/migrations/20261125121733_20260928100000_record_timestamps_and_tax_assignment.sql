-- ============================================================================
-- Record timestamps + tax assignment fix
--
-- 1. FIX: <TaxAssignees> inserts `assigned_by` into tax_return_assignees, but
--    that column never existed, so every "add collaborator" failed. Add it.
-- 2. Tax filings now record WHO filed and WHEN they were assigned, in
--    addition to the existing filed_at. Reopening a filing clears the filed
--    stamp so a reopened row never shows a stale "filed on" time (the change
--    history is still preserved by the log_activity trigger on tax_returns).
-- 3. Other records that had a status but no "when" now get one, stamped by
--    the database (not the browser) so it can't be forgotten or faked:
--      tasks.completed_at / completed_by   (status -> 'done')
--      invoices.paid_at                    (status -> 'paid')
-- ============================================================================

-- 1. Missing column that broke collaborator assignment ----------------------
ALTER TABLE public.tax_return_assignees
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Tax filings: who filed, when/by whom assigned ---------------------------
ALTER TABLE public.tax_returns
  ADD COLUMN IF NOT EXISTS filed_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Same body as before (auto-renew, obligation check) + filed_by stamp and
-- stamp-clearing on reopen.
CREATE OR REPLACE FUNCTION public.tg_tax_return_filed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next_due date;
  v_next_start date;
  v_next_end date;
  v_span int;
  v_new_id uuid;
  v_obligation_active boolean;
BEGIN
  -- Reopened: drop the filed stamp so it never shows a stale time.
  IF OLD.status = 'filed' AND NEW.status IS DISTINCT FROM 'filed' THEN
    NEW.filed_at := NULL;
    NEW.filed_by := NULL;
  END IF;

  IF NEW.status = 'filed' AND (OLD.status IS DISTINCT FROM 'filed') THEN
    NEW.filed_at := now();
    NEW.filed_by := auth.uid();

    IF NEW.renewed_to_id IS NULL THEN
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

-- Stamp assigned_at / assigned_by whenever the primary assignee changes.
CREATE OR REPLACE FUNCTION public.tg_tax_return_assigned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NOT NULL THEN
      NEW.assigned_at := COALESCE(NEW.assigned_at, now());
      NEW.assigned_by := COALESCE(NEW.assigned_by, auth.uid());
    END IF;
  ELSIF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    IF NEW.assigned_to IS NULL THEN
      NEW.assigned_at := NULL;
      NEW.assigned_by := NULL;
    ELSE
      NEW.assigned_at := now();
      NEW.assigned_by := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tax_return_assigned ON public.tax_returns;
CREATE TRIGGER trg_tax_return_assigned
BEFORE INSERT OR UPDATE ON public.tax_returns
FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_assigned();

-- 3a. Tasks: when was it completed, and by whom ------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tg_task_completed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'done' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at := now();
    NEW.completed_by := auth.uid();
  ELSIF NEW.status IS DISTINCT FROM 'done' THEN
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_completed ON public.tasks;
CREATE TRIGGER trg_task_completed
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tg_task_completed();

-- 3b. Invoices: when did it become fully paid --------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE OR REPLACE FUNCTION public.tg_invoice_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    NEW.paid_at := now();
  ELSIF NEW.status IS DISTINCT FROM 'paid' THEN
    NEW.paid_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_paid ON public.invoices;
CREATE TRIGGER trg_invoice_paid
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_paid();
