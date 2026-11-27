-- ============================================================================
-- Tax module simplification
--
-- A filing (one row in public.tax_returns) now moves through a 4-step
-- checklist, each step stamped with WHO did it and WHEN (by the database, so
-- it cannot be forged from the browser):
--
--   1. Documents received   docs_received_at / docs_received_by
--   2. Return prepared      prepared_at      / prepared_by
--   3. Filed - receipt uploaded   (a documents row with tax_return_id, or ack_file_path)
--   4. Invoiced             invoice_id  (already enforced: tg_require_completion_invoice)
--
-- Closing the filing (status -> 'filed') now requires steps 2, 3 and 4.
-- Steps 1 and 2 must be done in order.
--
-- One accountable owner per filing = tax_returns.assigned_to. The owner is
-- carried to the next period when a filing closes (tg_tax_return_filed). The
-- extra "collaborators" copy trigger is retired; the tax_return_assignees
-- table is left in place (nothing is deleted) but the tax screens no longer
-- use it.
--
-- Reminders: send_deadline_reminders() (already scheduled daily by pg_cron at
-- 07:00 Nairobi) now sends the filing owner a reminder 7, 3, 1 and 0 days
-- before the due date, an overdue alert on days 1, 3, 7 and then weekly, and
-- sends every director/admin ONE daily digest of overdue filings.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- 1. Checklist columns ------------------------------------------------------
ALTER TABLE public.tax_returns
  ADD COLUMN IF NOT EXISTS docs_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS docs_received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prepared_at      timestamptz,
  ADD COLUMN IF NOT EXISTS prepared_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tax_returns_docs_received_by_idx ON public.tax_returns (docs_received_by);
CREATE INDEX IF NOT EXISTS tax_returns_prepared_by_idx      ON public.tax_returns (prepared_by);
CREATE INDEX IF NOT EXISTS tax_returns_open_due_idx         ON public.tax_returns (due_date) WHERE status <> 'filed';

-- Filings that were already closed before this change count as having
-- completed the earlier steps (keeps their original filed_at / filed_by).
UPDATE public.tax_returns
   SET docs_received_at = COALESCE(docs_received_at, filed_at),
       docs_received_by = COALESCE(docs_received_by, filed_by),
       prepared_at      = COALESCE(prepared_at, filed_at),
       prepared_by      = COALESCE(prepared_by, filed_by)
 WHERE status::text = 'filed'
   AND (docs_received_at IS NULL OR prepared_at IS NULL);

-- 2. Stamping + ordering + closing rules ------------------------------------
CREATE OR REPLACE FUNCTION public.tg_tax_return_checklist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_has_receipt boolean;
BEGIN
  -- Who/when come from the database for signed-in users. Background jobs
  -- (no signed-in user) keep whatever they were given.
  IF auth.uid() IS NOT NULL THEN
    IF NEW.docs_received_at IS DISTINCT FROM OLD.docs_received_at THEN
      IF NEW.docs_received_at IS NULL THEN
        NEW.docs_received_by := NULL;
      ELSE
        NEW.docs_received_at := now();
        NEW.docs_received_by := auth.uid();
      END IF;
    ELSE
      NEW.docs_received_by := OLD.docs_received_by;
    END IF;

    IF NEW.prepared_at IS DISTINCT FROM OLD.prepared_at THEN
      IF NEW.prepared_at IS NULL THEN
        NEW.prepared_by := NULL;
      ELSE
        NEW.prepared_at := now();
        NEW.prepared_by := auth.uid();
      END IF;
    ELSE
      NEW.prepared_by := OLD.prepared_by;
    END IF;

    -- Steps 1 and 2 are in order.
    IF NEW.prepared_at IS NOT NULL AND NEW.docs_received_at IS NULL THEN
      RAISE EXCEPTION 'Tick "Documents received" first - the return cannot be prepared before the documents are in.';
    END IF;

    -- Closing the filing.
    IF NEW.status::text = 'filed' AND OLD.status::text <> 'filed' THEN
      IF NEW.prepared_at IS NULL THEN
        RAISE EXCEPTION 'Mark the return as prepared before closing this filing.';
      END IF;
      SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.tax_return_id = NEW.id)
             OR NEW.ack_file_path IS NOT NULL
        INTO v_has_receipt;
      IF NOT v_has_receipt THEN
        RAISE EXCEPTION 'Upload the filing receipt before closing this filing.';
      END IF;
      -- Invoice requirement is enforced by tg_require_completion_invoice.
    END IF;
  END IF;

  -- Keep the coarse status honest: documents in = work has started.
  IF NEW.status::text = 'pending' AND NEW.docs_received_at IS NOT NULL THEN
    NEW.status := 'in_progress';
  ELSIF NEW.status::text = 'in_progress' AND NEW.docs_received_at IS NULL AND OLD.docs_received_at IS NOT NULL THEN
    NEW.status := 'pending';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_tax_return_checklist() FROM PUBLIC, anon, authenticated;

-- Named so it fires before the other BEFORE UPDATE triggers: the checklist errors (prepared, receipt) show first, then the invoice requirement.
DROP TRIGGER IF EXISTS trg_tax_return_00_checklist ON public.tax_returns;
CREATE TRIGGER trg_tax_return_00_checklist
  BEFORE UPDATE ON public.tax_returns
  FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_checklist();

-- 3. One owner per filing ---------------------------------------------------
DROP TRIGGER IF EXISTS trg_tax_return_default_collaborators ON public.tax_returns;

-- 4. Reminders and overdue alerts -------------------------------------------
CREATE OR REPLACE FUNCTION public.send_deadline_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  r record;
  v_overdue int;
  v_unassigned int;
BEGIN
  -- Tasks
  FOR r IN
    SELECT t.id, t.title, t.assigned_to, t.due_date, c.company_name
    FROM public.tasks t
    LEFT JOIN public.clients c ON c.id = t.client_id
    WHERE t.assigned_to IS NOT NULL
      AND t.status <> 'done'
      AND t.due_date BETWEEN _today AND _today + 3
  LOOP
    PERFORM public.push_deadline_notification(
      r.assigned_to, 'task', r.id,
      'Task: ' || r.title || COALESCE(' (' || r.company_name || ')', ''),
      r.due_date, '/tasks', _today);
  END LOOP;

  -- Tax filings: reminder to the owner 7, 3, 1 and 0 days before the due date
  FOR r IN
    SELECT tr.id, tr.return_type::text AS rtype, tr.due_date, c.company_name,
           tr.assigned_to AS uid, (tr.due_date - _today) AS d
    FROM public.tax_returns tr
    JOIN public.clients c ON c.id = tr.client_id
    WHERE tr.status::text <> 'filed'
      AND tr.assigned_to IS NOT NULL
      AND COALESCE(c.is_paused, false) = false
      AND (tr.due_date - _today) IN (7, 3, 1, 0)
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link, dedupe_key)
    VALUES (r.uid, 'deadline_reminder',
            'Tax filing due ' || CASE r.d WHEN 0 THEN 'today' WHEN 1 THEN 'tomorrow' ELSE 'in ' || r.d || ' days' END,
            replace(r.rtype, '_', ' ') || ' - ' || r.company_name || ' - due ' || to_char(r.due_date, 'DD Mon YYYY'),
            '/tax?filing=' || r.id,
            'tax:' || r.id || ':' || r.due_date || ':d' || r.d)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  -- Tax filings: overdue alert to the owner on day 1, 3, 7, then every 7 days
  FOR r IN
    SELECT tr.id, tr.return_type::text AS rtype, tr.due_date, c.company_name,
           tr.assigned_to AS uid, (_today - tr.due_date) AS late
    FROM public.tax_returns tr
    JOIN public.clients c ON c.id = tr.client_id
    WHERE tr.status::text <> 'filed'
      AND tr.assigned_to IS NOT NULL
      AND COALESCE(c.is_paused, false) = false
      AND tr.due_date < _today
      AND ((_today - tr.due_date) IN (1, 3, 7)
           OR ((_today - tr.due_date) >= 14 AND (_today - tr.due_date) % 7 = 0))
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link, dedupe_key)
    VALUES (r.uid, 'deadline_reminder',
            'Tax filing OVERDUE',
            replace(r.rtype, '_', ' ') || ' - ' || r.company_name || ' - ' || r.late
              || CASE WHEN r.late = 1 THEN ' day' ELSE ' days' END || ' overdue (was due '
              || to_char(r.due_date, 'DD Mon YYYY') || ')',
            '/tax?filing=' || r.id,
            'taxod:' || r.id || ':' || _today)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  -- Tax filings: one daily digest of everything overdue for directors/admins
  SELECT count(*), count(*) FILTER (WHERE tr.assigned_to IS NULL)
    INTO v_overdue, v_unassigned
    FROM public.tax_returns tr
    JOIN public.clients c ON c.id = tr.client_id
   WHERE tr.status::text <> 'filed'
     AND COALESCE(c.is_paused, false) = false
     AND tr.due_date < _today;

  IF v_overdue > 0 THEN
    FOR r IN SELECT DISTINCT ur.user_id AS uid FROM public.user_roles ur WHERE ur.role::text IN ('director', 'admin')
    LOOP
      INSERT INTO public.notifications (user_id, type, title, body, link, dedupe_key)
      VALUES (r.uid, 'deadline_reminder',
              'Overdue tax filings',
              v_overdue || ' filing' || CASE WHEN v_overdue = 1 THEN '' ELSE 's' END || ' overdue'
                || CASE WHEN v_unassigned > 0 THEN ' (' || v_unassigned || ' with no owner)' ELSE '' END,
              '/tax?status=overdue',
              'taxdigest:' || _today)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END LOOP;
  END IF;

  -- Advisory milestones
  FOR r IN
    SELECT m.id, m.title, m.assigned_to, m.due_date, c.company_name
    FROM public.advisory_milestones m
    JOIN public.advisory_projects p ON p.id = m.project_id
    JOIN public.clients c ON c.id = p.client_id
    WHERE m.assigned_to IS NOT NULL
      AND m.done = false
      AND m.due_date BETWEEN _today AND _today + 3
  LOOP
    PERFORM public.push_deadline_notification(
      r.assigned_to, 'milestone', r.id,
      'Advisory milestone: ' || r.title || ' (' || r.company_name || ')',
      r.due_date, '/advisory', _today);
  END LOOP;

  -- Calendar events marked as deadlines
  FOR r IN
    SELECT e.id, e.title, e.assigned_to, e.event_date
    FROM public.calendar_events e
    WHERE e.assigned_to IS NOT NULL
      AND e.type = 'deadline'
      AND e.event_date BETWEEN _today AND _today + 3
  LOOP
    PERFORM public.push_deadline_notification(
      r.assigned_to, 'event', r.id, 'Deadline: ' || r.title,
      r.event_date, '/calendar', _today);
  END LOOP;
END;
$function$;
