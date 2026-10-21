-- Final handover is performed atomically only when the director/admin approves.
-- Reliever approval advances the request; it does not transfer any work.
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS transferred_tasks_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transferred_tax_returns_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transferred_milestones_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.decide_leave_request(_id uuid, _approve boolean, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.leave_requests%ROWTYPE;
  v_is_director boolean := false;
  v_count integer := 0;
  v_employee_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'You must be signed in'; END IF;

  SELECT * INTO v_request
  FROM public.leave_requests
  WHERE id = _id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave request not found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'director'
  ) INTO v_is_director;

  SELECT full_name INTO v_employee_name
  FROM public.profiles WHERE id = v_request.employee_id;

  -- Stage 1: only the nominated reliever can approve/reject the handover request.
  IF v_request.status = 'pending' THEN
    IF v_request.reliever_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Only the designated reliever can review this leave request';
    END IF;

    IF NOT _approve THEN
      UPDATE public.leave_requests
      SET status = 'rejected',
          reliever_decided_by = auth.uid(),
          reliever_decided_at = now(),
          reliever_decision_notes = _notes,
          decided_by = auth.uid(),
          decided_at = now(),
          decision_notes = COALESCE(_notes, 'Rejected by the designated reliever')
      WHERE id = _id;

      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (v_request.employee_id, 'leave_decision', 'Leave request rejected',
        COALESCE(_notes, 'Your leave request was rejected by the designated reliever.'), '/hr');
      RETURN;
    END IF;

    UPDATE public.leave_requests
    SET status = 'reliever_approved',
        reliever_decided_by = auth.uid(),
        reliever_decided_at = now(),
        reliever_decision_notes = _notes
    WHERE id = _id;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT ur.user_id, 'leave_request', 'Leave request awaiting director approval',
      COALESCE(v_employee_name, 'An employee') || ' has reliever approval. Review the proposed client-work handover and approve or reject the leave request.', '/hr'
    FROM public.user_roles ur
    WHERE ur.role = 'director';

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_request.employee_id, 'leave_decision', 'Reliever approved your leave request',
      'Your reliever approved the request. Client work will be transferred only if the director/admin gives final approval.', '/hr');
    RETURN;
  END IF;

  -- Stage 2: director/admin final decision. The handover and approval are one transaction.
  IF v_request.status = 'reliever_approved' THEN
    IF NOT (v_is_director OR public.is_admin(auth.uid())) THEN
      RAISE EXCEPTION 'Only the director or an admin can give final leave approval';
    END IF;

    IF _approve THEN
      UPDATE public.tasks
      SET assigned_to = v_request.reliever_id
      WHERE assigned_to = v_request.employee_id
        AND client_id IS NOT NULL
        AND status::text NOT IN ('done', 'completed', 'cancelled', 'closed', 'filed');
      GET DIAGNOSTICS v_count = ROW_COUNT;
      UPDATE public.leave_requests SET transferred_tasks_count = v_count WHERE id = _id;

      UPDATE public.tax_returns
      SET assigned_to = v_request.reliever_id,
          assigned_by = auth.uid(),
          assigned_at = now()
      WHERE assigned_to = v_request.employee_id
        AND status::text NOT IN ('filed', 'completed', 'cancelled');
      GET DIAGNOSTICS v_count = ROW_COUNT;
      UPDATE public.leave_requests SET transferred_tax_returns_count = v_count WHERE id = _id;

      UPDATE public.service_milestones sm
      SET assigned_to = v_request.reliever_id
      FROM public.service_projects sp
      WHERE sm.project_id = sp.id
        AND sp.client_id IS NOT NULL
        AND sm.assigned_to = v_request.employee_id
        AND NOT sm.done;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      UPDATE public.leave_requests SET transferred_milestones_count = v_count WHERE id = _id;
    END IF;

    UPDATE public.leave_requests
    SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
        decided_by = auth.uid(),
        decided_at = now(),
        decision_notes = COALESCE(_notes, CASE WHEN _approve THEN 'Approved by director/admin; client-work handover completed.' ELSE 'Rejected by director/admin.' END)
    WHERE id = _id;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_request.employee_id, 'leave_decision',
      CASE WHEN _approve THEN 'Leave request approved and handover completed' ELSE 'Leave request rejected by director/admin' END,
      CASE WHEN _approve THEN
        'Your leave request was approved. Outstanding client-related tasks, tax returns, and service milestones have been reassigned to your reliever.'
      ELSE COALESCE(_notes, 'Your leave request was rejected by the director/admin. No client-work handover was performed.') END,
      '/hr');

    IF _approve THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (v_request.reliever_id, 'leave_handover', 'Client work handed over to you',
        COALESCE(v_employee_name, 'An employee') || '''s leave was approved. Outstanding client-related tasks, tax returns, and service milestones have been assigned to you.', '/hr');
    END IF;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Request is no longer awaiting a decision';
END;
$$;
GRANT EXECUTE ON FUNCTION public.decide_leave_request(uuid, boolean, text) TO authenticated;

-- Allow authorized HR administrators/directors to remove finalized records from the HR record list.
-- Pending requests and requests still awaiting director approval cannot be deleted through this RPC.
CREATE OR REPLACE FUNCTION public.delete_leave_record(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_is_director boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'You must be signed in'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'director'
  ) INTO v_is_director;

  IF NOT (public.is_admin(auth.uid()) OR v_is_director OR public.is_hr_manager(auth.uid())) THEN
    RAISE EXCEPTION 'Only HR, a director, or an admin can delete leave records';
  END IF;

  SELECT status INTO v_status
  FROM public.leave_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave record not found'; END IF;
  IF v_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Only approved or rejected leave records can be deleted';
  END IF;

  DELETE FROM public.leave_requests WHERE id = _id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_leave_record(uuid) TO authenticated;
