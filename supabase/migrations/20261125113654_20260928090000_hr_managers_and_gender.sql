-- ============================================================================
-- HR managers + gender-based leave eligibility
--
--   1. is_hr_manager(): director, admin and accountant can manage employee
--      records (personal details, documents, payslips). Previously only
--      director/admin could (is_admin).
--   2. hr_employment.gender ('male' | 'female') and
--      leave_types.eligible_gender: a leave type with an eligible_gender is
--      only offered to / accepted from employees whose recorded gender
--      matches. Maternity Leave -> female, Paternity Leave -> male.
--      An employee with no gender recorded is not eligible for a
--      gender-restricted type until HR records it.
-- ============================================================================

-- 1. HR manager check ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_hr_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('director', 'admin', 'accountant')
  )
$$;
GRANT EXECUTE ON FUNCTION public.is_hr_manager(uuid) TO authenticated;

-- 2. Gender + eligibility columns ---------------------------------------------
ALTER TABLE public.hr_employment
  ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('male', 'female'));

ALTER TABLE public.leave_types
  ADD COLUMN IF NOT EXISTS eligible_gender text CHECK (eligible_gender IN ('male', 'female'));

UPDATE public.leave_types SET eligible_gender = 'female' WHERE name = 'Maternity Leave';
UPDATE public.leave_types SET eligible_gender = 'male'   WHERE name = 'Paternity Leave';

-- 3. Employment record: HR managers can read + write every row ----------------
DROP POLICY IF EXISTS "hr employment select self admin manager" ON public.hr_employment;
DROP POLICY IF EXISTS "hr employment write admin" ON public.hr_employment;

CREATE POLICY "hr employment select self hr manager" ON public.hr_employment FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR public.is_hr_manager(auth.uid()) OR manager_id = auth.uid());
CREATE POLICY "hr employment write hr managers" ON public.hr_employment FOR ALL TO authenticated
  USING (public.is_hr_manager(auth.uid())) WITH CHECK (public.is_hr_manager(auth.uid()));

-- 4. HR documents ---------------------------------------------------------------
--    Delete follows the repo's ownership rule: admin/director always, other HR
--    managers only for files they uploaded themselves.
DROP POLICY IF EXISTS "hr documents select self admin" ON public.hr_documents;
DROP POLICY IF EXISTS "hr documents insert self admin" ON public.hr_documents;
DROP POLICY IF EXISTS "hr documents delete admin" ON public.hr_documents;

CREATE POLICY "hr documents select self hr manager" ON public.hr_documents FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR public.is_hr_manager(auth.uid()));
CREATE POLICY "hr documents insert self hr manager" ON public.hr_documents FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid() OR public.is_hr_manager(auth.uid()));
CREATE POLICY "hr documents delete admin or uploader" ON public.hr_documents FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR (public.is_hr_manager(auth.uid()) AND uploaded_by = auth.uid()));

-- 5. Payslips -------------------------------------------------------------------
DROP POLICY IF EXISTS "payslips select self admin" ON public.payslips;
DROP POLICY IF EXISTS "payslips write admin" ON public.payslips;

CREATE POLICY "payslips select self hr manager" ON public.payslips FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR public.is_hr_manager(auth.uid()));
CREATE POLICY "payslips write hr managers" ON public.payslips FOR ALL TO authenticated
  USING (public.is_hr_manager(auth.uid())) WITH CHECK (public.is_hr_manager(auth.uid()));

-- 6. Storage buckets (path convention: `${employee_id}/filename`) -----------------
DROP POLICY IF EXISTS "hr docs read own or admin" ON storage.objects;
DROP POLICY IF EXISTS "hr docs write own or admin" ON storage.objects;
DROP POLICY IF EXISTS "hr docs delete admin" ON storage.objects;
DROP POLICY IF EXISTS "payslips read own or admin" ON storage.objects;
DROP POLICY IF EXISTS "payslips write admin" ON storage.objects;
DROP POLICY IF EXISTS "payslips delete admin" ON storage.objects;

CREATE POLICY "hr docs read own or hr manager" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'hr-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_hr_manager(auth.uid())));
CREATE POLICY "hr docs write own or hr manager" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hr-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_hr_manager(auth.uid())));
CREATE POLICY "hr docs delete admin or uploader" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'hr-documents' AND (public.is_admin(auth.uid()) OR (public.is_hr_manager(auth.uid()) AND owner = auth.uid())));

CREATE POLICY "payslips read own or hr manager" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payslips' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_hr_manager(auth.uid())));
CREATE POLICY "payslips write hr managers" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payslips' AND public.is_hr_manager(auth.uid()));
CREATE POLICY "payslips delete hr managers" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payslips' AND public.is_hr_manager(auth.uid()));

-- 7. Leave balances only list leave types the employee is eligible for -----------
CREATE OR REPLACE VIEW public.leave_balances AS
SELECT
  p.id AS employee_id,
  lt.id AS leave_type_id,
  lt.name AS leave_type_name,
  lt.annual_days AS entitled_days,
  COALESCE(SUM(lr.days) FILTER (
    WHERE lr.status = 'approved' AND EXTRACT(YEAR FROM lr.start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
  ), 0) AS used_days,
  lt.annual_days - COALESCE(SUM(lr.days) FILTER (
    WHERE lr.status = 'approved' AND EXTRACT(YEAR FROM lr.start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
  ), 0) AS remaining_days
FROM public.profiles p
CROSS JOIN public.leave_types lt
LEFT JOIN public.hr_employment hg ON hg.employee_id = p.id
LEFT JOIN public.leave_requests lr ON lr.employee_id = p.id AND lr.leave_type_id = lt.id
WHERE lt.active
  AND (lt.eligible_gender IS NULL OR lt.eligible_gender = hg.gender)
  AND (p.id = auth.uid() OR public.is_admin(auth.uid())
       OR EXISTS (SELECT 1 FROM public.hr_employment he WHERE he.employee_id = p.id AND he.manager_id = auth.uid()))
GROUP BY p.id, lt.id, lt.name, lt.annual_days;

GRANT SELECT ON public.leave_balances TO authenticated;

-- 8. request_leave: reject gender-restricted types the employee isn't eligible for
CREATE OR REPLACE FUNCTION public.request_leave(_leave_type_id uuid, _start_date date, _end_date date, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_manager uuid;
  v_required text;
  v_type_name text;
  v_gender text;
BEGIN
  IF _end_date < _start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date';
  END IF;

  SELECT eligible_gender, name INTO v_required, v_type_name FROM public.leave_types WHERE id = _leave_type_id;
  IF v_required IS NOT NULL THEN
    SELECT gender INTO v_gender FROM public.hr_employment WHERE employee_id = auth.uid();
    IF v_gender IS DISTINCT FROM v_required THEN
      RAISE EXCEPTION '% is not available for your record. Ask HR to confirm your gender details.', v_type_name;
    END IF;
  END IF;

  INSERT INTO public.leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason)
  VALUES (auth.uid(), _leave_type_id, _start_date, _end_date, (_end_date - _start_date + 1), _reason)
  RETURNING id INTO v_id;

  SELECT manager_id INTO v_manager FROM public.hr_employment WHERE employee_id = auth.uid();

  IF v_manager IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_manager, 'leave_request', 'New leave request',
      (SELECT full_name FROM public.profiles WHERE id = auth.uid()) || ' requested leave', '/hr');
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT ur.user_id, 'leave_request', 'New leave request',
      (SELECT full_name FROM public.profiles WHERE id = auth.uid()) || ' requested leave', '/hr'
    FROM public.user_roles ur WHERE ur.role IN ('director','admin');
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_leave(uuid, date, date, text) TO authenticated;
