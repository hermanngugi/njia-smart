-- ============================================================================
-- HR: any staff member can nominate any other staff member as their reliever.
--
-- The reliever list used to come straight from the profiles table (read with
-- the caller's own access) and request_leave() assumed every profile was a
-- valid, nameable person. This makes both independent of the caller's role:
--   * list_leave_relievers()  - every staff member except the caller, for any
--                               signed-in staff (SECURITY DEFINER, read-only).
--   * request_leave()         - same rules as before (not yourself, must be a
--                               real staff member), with a null-safe
--                               notification so a missing name can't fail it.
-- Same signature as 20261021160000, so this simply replaces the function.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_leave_relievers()
RETURNS TABLE (id uuid, full_name text, job_title text, roles text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         COALESCE(NULLIF(trim(p.full_name), ''), p.id::text) AS full_name,
         p.job_title,
         COALESCE(array_agg(DISTINCT ur.role::text) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::text[]) AS roles
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
   WHERE auth.uid() IS NOT NULL
     AND public.is_staff(auth.uid())
     AND p.id <> auth.uid()
   GROUP BY p.id, p.full_name, p.job_title
   ORDER BY 2;
$$;
REVOKE ALL ON FUNCTION public.list_leave_relievers() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.list_leave_relievers() TO authenticated;

CREATE OR REPLACE FUNCTION public.request_leave(
  _leave_type_id uuid, _start_date date, _end_date date, _reason text DEFAULT NULL, _reliever_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_required text;
  v_type_name text;
  v_gender text;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'You must be signed in to request leave'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Only staff can request leave'; END IF;
  IF _end_date < _start_date THEN RAISE EXCEPTION 'End date cannot be before start date'; END IF;
  IF _reliever_id IS NULL OR _reliever_id = auth.uid() THEN
    RAISE EXCEPTION 'Select another employee as your reliever';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _reliever_id)
     OR NOT public.is_staff(_reliever_id) THEN
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

  SELECT COALESCE(NULLIF(trim(full_name), ''), 'A colleague') INTO v_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_reliever_id, 'leave_request', 'Leave request needs your review',
    COALESCE(v_name, 'A colleague') || ' has nominated you as reliever and requested leave', '/hr');
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_leave(uuid, date, date, text, uuid) TO authenticated;
