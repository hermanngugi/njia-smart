-- Two-stage leave approval with client-work handover to the designated reliever.
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS reliever_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reliever_decided_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reliever_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS reliever_decision_notes text;

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_status_check
  CHECK (status IN ('pending', 'reliever_approved', 'approved', 'rejected', 'cancelled'));

DROP POLICY IF EXISTS "leave requests select self manager admin" ON public.leave_requests;
CREATE POLICY "leave requests select leave workflow" ON public.leave_requests FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR reliever_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'director')
    OR EXISTS (SELECT 1 FROM public.hr_employment he WHERE he.employee_id = leave_requests.employee_id AND he.manager_id = auth.uid())
  );

DROP FUNCTION IF EXISTS public.request_leave(uuid, date, date, text);
CREATE OR REPLACE FUNCTION public.request_leave(
  _leave_type_id uuid, _start_date date, _end_date date, _reason text DEFAULT NULL, _reliever_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_required text;
  v_type_name text;
  v_gender text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'You must be signed in to request leave'; END IF;
  IF _end_date < _start_date THEN RAISE EXCEPTION 'End date cannot be before start date'; END IF;
  IF _reliever_id IS NULL OR _reliever_id = auth.uid() THEN
    RAISE EXCEPTION 'Select another employee as your reliever';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _reliever_id) THEN
    RAISE EXCEPTION 'Selected reliever was not found';
  END IF;

  SELECT eligible_gender, name INTO v_required, v_type_name FROM public.leave_types WHERE id = _leave_type_id AND active;
  IF v_type_name IS NULL THEN RAISE EXCEPTION 'Select an active leave type'; END IF;
  IF v_required IS NOT NULL THEN
    SELECT gender INTO v_gender FROM public.hr_employment WHERE employee_id = auth.uid();
    IF v_gender IS DISTINCT FROM v_required THEN
      RAISE EXCEPTION '% is not available for your record. Ask HR to confirm your gender details.', v_type_name;
    END IF;
  END IF;

  INSERT INTO public.leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, reliever_id)
  VALUES (auth.uid(), _leave_type_id, _start_date, _end_date, (_end_date - _start_date + 1), _reason, _reliever_id)
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_reliever_id, 'leave_request', 'Leave request needs your review',
    (SELECT full_name FROM public.profiles WHERE id = auth.uid()) || ' has nominated you as reliever and requested leave', '/hr');
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_leave(uuid, date, date, text, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.decide_leave_request(uuid, boolean, text);
CREATE OR REPLACE FUNCTION public.decide_leave_request(_id uuid, _approve boolean, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.leave_requests%ROWTYPE;
  v_is_director boolean;
BEGIN
  SELECT * INTO v_request FROM public.leave_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave request not found'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'director') INTO v_is_director;

  IF v_request.status = 'pending' THEN
    IF v_request.reliever_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only the designated reliever can review this leave request';
    END IF;
    IF NOT _approve THEN
      UPDATE public.leave_requests SET status = 'rejected', reliever_decided_by = auth.uid(), reliever_decided_at = now(), reliever_decision_notes = _notes,
        decided_by = auth.uid(), decided_at = now(), decision_notes = _notes WHERE id = _id;
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (v_request.employee_id, 'leave_decision', 'Leave request rejected by reliever', _notes, '/hr');
      RETURN;
    END IF;

    -- Handover only client-linked work, and only work that is still outstanding.
    UPDATE public.tasks SET assigned_to = v_request.reliever_id
      WHERE assigned_to = v_request.employee_id AND client_id IS NOT NULL
        AND status::text NOT IN ('done', 'completed', 'cancelled', 'closed', 'filed');
    UPDATE public.tax_returns SET assigned_to = v_request.reliever_id, assigned_by = auth.uid(), assigned_at = now()
      WHERE assigned_to = v_request.employee_id AND status::text NOT IN ('filed', 'completed', 'cancelled');
    UPDATE public.service_milestones sm SET assigned_to = v_request.reliever_id
      FROM public.service_projects sp
      WHERE sm.project_id = sp.id AND sp.client_id IS NOT NULL
        AND sm.assigned_to = v_request.employee_id AND NOT sm.done;

    UPDATE public.leave_requests SET status = 'reliever_approved', reliever_decided_by = auth.uid(), reliever_decided_at = now(), reliever_decision_notes = _notes WHERE id = _id;
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
