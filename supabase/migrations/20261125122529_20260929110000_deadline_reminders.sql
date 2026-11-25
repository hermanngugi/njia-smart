-- ============================================================================
-- Automatic deadline reminders + realtime coverage
--
-- 1. Anyone assigned to something that is due within the next 3 days gets a
--    row in public.notifications (the bell + toast pick it up live).
--      Covered: tasks, tax returns (primary assignee AND collaborators),
--               advisory milestones, calendar events of type 'deadline'.
--    Two ways a reminder is created, so nothing waits on a timer:
--      a) Row triggers - fire the moment a due date / assignee is saved.
--      b) A daily pg_cron scan (07:00 Nairobi) - catches items as they
--         roll into the 3-day window.
--    A dedupe key (record + due date) makes each reminder fire once per
--    person per due date. Changing the due date re-arms it.
-- 2. Adds the deadline-bearing tables to the supabase_realtime publication
--    so every page can update live (see use-live-refresh.ts).
--
-- NOTE: pg_cron must be enabled (Supabase: Database > Extensions > pg_cron).
-- If it is not, this migration still succeeds (triggers keep working) and
-- prints a NOTICE - enable the extension and re-run the last block.
-- ============================================================================

-- 1. Dedupe support -----------------------------------------------------------
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedupe_uidx
  ON public.notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 2. One place that writes a reminder ------------------------------------------
CREATE OR REPLACE FUNCTION public.push_deadline_notification(
  _user uuid, _kind text, _record uuid, _title text,
  _due date, _link text, _today date
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _days int;
  _when text;
BEGIN
  IF _user IS NULL OR _due IS NULL THEN RETURN; END IF;
  _days := _due - _today;
  IF _days < 0 OR _days > 3 THEN RETURN; END IF;   -- only the 3-day window

  _when := CASE _days WHEN 0 THEN 'today' WHEN 1 THEN 'tomorrow'
                      ELSE 'in ' || _days || ' days' END;

  INSERT INTO public.notifications (user_id, type, title, body, link, dedupe_key)
  VALUES (_user, 'deadline_reminder',
          'Deadline due ' || _when,
          _title || ' - due ' || to_char(_due, 'DD Mon YYYY'),
          _link,
          _kind || ':' || _record || ':' || _due)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;

-- 3. Full scan (used by cron, and once at the bottom of this file) ---------------
CREATE OR REPLACE FUNCTION public.send_deadline_reminders()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  r record;
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

  -- Tax returns: primary assignee + collaborators
  FOR r IN
    SELECT tr.id, tr.return_type::text AS rtype, tr.due_date, c.company_name, u.uid
    FROM public.tax_returns tr
    JOIN public.clients c ON c.id = tr.client_id
    CROSS JOIN LATERAL (
      SELECT tr.assigned_to AS uid WHERE tr.assigned_to IS NOT NULL
      UNION
      SELECT a.user_id FROM public.tax_return_assignees a WHERE a.tax_return_id = tr.id
    ) u
    WHERE tr.status <> 'filed'
      AND COALESCE(c.is_paused, false) = false
      AND tr.due_date BETWEEN _today AND _today + 3
  LOOP
    PERFORM public.push_deadline_notification(
      r.uid, 'tax', r.id,
      'Tax filing: ' || replace(r.rtype, '_', ' ') || ' - ' || r.company_name,
      r.due_date, '/tax', _today);
  END LOOP;

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
$$;

-- 4. Row triggers: notify the instant a due date / assignee is saved -----------
-- Wrapped in an exception block: a reminder failure must never block a save.
CREATE OR REPLACE FUNCTION public.tg_notify_deadline_row()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  _client text;
  _rtype text;
  _due date;
  _status text;
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'tasks' THEN
      IF NEW.status <> 'done' THEN
        PERFORM public.push_deadline_notification(
          NEW.assigned_to, 'task', NEW.id, 'Task: ' || NEW.title,
          NEW.due_date, '/tasks', _today);
      END IF;

    ELSIF TG_TABLE_NAME = 'tax_returns' THEN
      IF NEW.status <> 'filed' THEN
        SELECT company_name INTO _client FROM public.clients WHERE id = NEW.client_id;
        PERFORM public.push_deadline_notification(
          NEW.assigned_to, 'tax', NEW.id,
          'Tax filing: ' || replace(NEW.return_type::text, '_', ' ') || ' - ' || COALESCE(_client, ''),
          NEW.due_date, '/tax', _today);
      END IF;

    ELSIF TG_TABLE_NAME = 'tax_return_assignees' THEN
      SELECT tr.due_date, tr.status::text, tr.return_type::text, c.company_name
        INTO _due, _status, _rtype, _client
        FROM public.tax_returns tr
        JOIN public.clients c ON c.id = tr.client_id
        WHERE tr.id = NEW.tax_return_id;
      IF _status IS DISTINCT FROM 'filed' THEN
        PERFORM public.push_deadline_notification(
          NEW.user_id, 'tax', NEW.tax_return_id,
          'Tax filing: ' || replace(COALESCE(_rtype, ''), '_', ' ') || ' - ' || COALESCE(_client, ''),
          _due, '/tax', _today);
      END IF;

    ELSIF TG_TABLE_NAME = 'advisory_milestones' THEN
      IF NEW.done = false THEN
        PERFORM public.push_deadline_notification(
          NEW.assigned_to, 'milestone', NEW.id, 'Advisory milestone: ' || NEW.title,
          NEW.due_date, '/advisory', _today);
      END IF;

    ELSIF TG_TABLE_NAME = 'calendar_events' THEN
      IF NEW.type = 'deadline' THEN
        PERFORM public.push_deadline_notification(
          NEW.assigned_to, 'event', NEW.id, 'Deadline: ' || NEW.title,
          NEW.event_date, '/calendar', _today);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'deadline reminder skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deadline_notify_tasks ON public.tasks;
CREATE TRIGGER trg_deadline_notify_tasks
  AFTER INSERT OR UPDATE OF due_date, assigned_to, status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_deadline_row();

DROP TRIGGER IF EXISTS trg_deadline_notify_tax_returns ON public.tax_returns;
CREATE TRIGGER trg_deadline_notify_tax_returns
  AFTER INSERT OR UPDATE OF due_date, assigned_to, status ON public.tax_returns
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_deadline_row();

DROP TRIGGER IF EXISTS trg_deadline_notify_tax_assignees ON public.tax_return_assignees;
CREATE TRIGGER trg_deadline_notify_tax_assignees
  AFTER INSERT ON public.tax_return_assignees
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_deadline_row();

DROP TRIGGER IF EXISTS trg_deadline_notify_milestones ON public.advisory_milestones;
CREATE TRIGGER trg_deadline_notify_milestones
  AFTER INSERT OR UPDATE OF due_date, assigned_to, done ON public.advisory_milestones
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_deadline_row();

DROP TRIGGER IF EXISTS trg_deadline_notify_events ON public.calendar_events;
CREATE TRIGGER trg_deadline_notify_events
  AFTER INSERT OR UPDATE OF event_date, assigned_to, type ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_deadline_row();

-- Not callable from the browser (would let any user spam notifications).
REVOKE ALL ON FUNCTION public.push_deadline_notification(uuid, text, uuid, text, date, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_deadline_reminders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_notify_deadline_row() FROM PUBLIC, anon, authenticated;

-- 5. Realtime coverage ------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'notifications', 'tasks', 'tax_returns', 'tax_return_assignees',
    'client_tax_obligations', 'advisory_projects', 'advisory_milestones',
    'calendar_events', 'clients', 'invoices', 'leave_requests'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN OTHERS THEN NULL;  -- already a member, or table not present
    END;
  END LOOP;
END $$;

-- 6. Daily scan at 07:00 Nairobi (04:00 UTC) + catch-up run now -------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deadline-reminders') THEN
    PERFORM cron.unschedule('deadline-reminders');
  END IF;
  PERFORM cron.schedule('deadline-reminders', '0 4 * * *', 'select public.send_deadline_reminders()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available (%). Enable it, then re-run this block to schedule the daily scan.', SQLERRM;
END $$;

SELECT public.send_deadline_reminders();
