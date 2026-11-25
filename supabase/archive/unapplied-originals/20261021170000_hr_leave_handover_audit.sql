-- Keep auditable totals of client-work items transferred when a reliever approves leave.
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS transferred_tasks_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transferred_tax_returns_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transferred_milestones_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.decide_leave_request(_id uuid, _approve boolean, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.leave_requests%ROWTYPE;
  v_is_director boolean;
  v_count integer;
BEGIN
  SELECT * INTO v_request FROM public.leave_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave request not found'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'You must be signed in'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'director') INTO v_is_director;

  IF v_request.status = 'pending' THEN
    IF v_request.reliever_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only the designated reliever can review this leave request';
    END IF;
    IF NOT _approve THEN
      UPDATE public.leave_requests SET status = 'rejected', reliever_decided_by = auth.uid(), reliever_decided_at = now(),
        reliever_decision_notes = _notes, decided_by = auth.uid(), decided_at = now(), decision_notes = _notes WHERE id = _id;
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (v_request.employee_id, 'leave_decision', 'Leave request rejected by reliever', _notes, '/hr');
      RETURN;
    END IF;

    UPDATE public.tasks SET assigned_to = v_request.reliever_id
      WHERE assigned_to = v_request.employee_id AND client_id IS NOT NULL
        AND status::text NOT IN ('done', 'completed', 'cancelled', 'closed', 'filed');
    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.leave_requests SET transferred_tasks_count = v_count WHERE id = _id;

    UPDATE public.tax_returns SET assigned_to = v_request.reliever_id, assigned_by = auth.uid(), assigned_at = now()
      WHERE assigned_to = v_request.employee_id AND status::text NOT IN ('filed', 'completed', 'cancelled');
    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.leave_requests SET transferred_tax_returns_count = v_count WHERE id = _id;

    UPDATE public.service_milestones sm SET assigned_to = v_request.reliever_id
      FROM public.service_projects sp
      WHERE sm.project_id = sp.id AND sp.client_id IS NOT NULL
        AND sm.assigned_to = v_request.employee_id AND NOT sm.done;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.leave_requests SET transferred_milestones_count = v_count WHERE id = _id;

    UPDATE public.leave_requests SET status = 'reliever_approved', reliever_decided_by = auth.uid(),
      reliever_decided_at = now(), reliever_decision_notes = _notes WHERE id = _id;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT ur.user_id, 'leave_request', 'Leave request awaiting director approval',
      (SELECT full_name FROM public.profiles WHERE id = v_request.employee_id) || ' has reliever approval; client work has been handed over', '/hr'
      FROM public.user_roles ur WHERE ur.role = 'director';
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_request.employee_id, 'leave_decision', 'Reliever approved leave request',
      'Client-related outstanding tasks and deadlines have been reassigned to your reliever. The request is awaiting director approval.', '/hr');
    RETURN;
  END IF;

  IF v_request.status = 'reliever_approved' THEN
    IF NOT (v_is_director OR public.is_admin(auth.uid())) THEN
      RAISE EXCEPTION 'Only the director or an admin can give final leave approval';
    END IF;
    UPDATE public.leave_requests SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      decided_by = auth.uid(), decided_at = now(), decision_notes = _notes WHERE id = _id;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_request.employee_id, 'leave_decision',
      CASE WHEN _approve THEN 'Leave request finally approved' ELSE 'Leave request rejected by director' END, _notes, '/hr');
    RETURN;
  END IF;

  RAISE EXCEPTION 'Request is no longer awaiting a decision';
END;
$$;
GRANT EXECUTE ON FUNCTION public.decide_leave_request(uuid, boolean, text) TO authenticated;
