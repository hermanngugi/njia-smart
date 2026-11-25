-- ============================================================================
-- Tasks: "Waiting on client" details.
--   waiting_since  - when the task went into this status (stamped by the database)
--   waiting_reason - what we are waiting for (e.g. "bank statements for June")
--   follow_up_on   - the date to chase the client
-- They are filled in when a task is set to waiting_on_client and cleared
-- automatically when it leaves that status, so they never go stale.
-- The activity timeline already records the status change itself.
-- Run 20261113090000_task_status_waiting_enum.sql first.
-- ============================================================================
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS waiting_since  timestamptz,
  ADD COLUMN IF NOT EXISTS waiting_reason text,
  ADD COLUMN IF NOT EXISTS follow_up_on   date;

CREATE OR REPLACE FUNCTION public.tg_task_waiting_on_client()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status::text = 'waiting_on_client' THEN
    IF TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'waiting_on_client' THEN
      NEW.waiting_since := COALESCE(NEW.waiting_since, now());
    END IF;
  ELSE
    NEW.waiting_since  := NULL;
    NEW.waiting_reason := NULL;
    NEW.follow_up_on   := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_waiting_on_client ON public.tasks;
CREATE TRIGGER trg_task_waiting_on_client
  BEFORE INSERT OR UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_task_waiting_on_client();
