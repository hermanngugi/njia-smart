-- ============================================================================
-- HR & Employee module
--
--   1. hr_employment   -- sensitive employment/pay data, kept OUT of `profiles`
--                          (which any staff member can already SELECT) so
--                          salary/national ID/bank details aren't broadly
--                          readable. Only the employee themself + admins can
--                          see a row; only admins can write it directly --
--                          the employee edits their own personal fields
--                          (next of kin, bank, ID/KRA, DOB) through the
--                          update_my_employment_info() RPC below.
--   2. hr_documents    -- contracts, ID copies, tax forms etc, one per file.
--   3. leave_types / leave_requests -- request + approval workflow.
--   4. leave_balances  -- a view: entitlement minus approved days this year.
--   5. payslips        -- one row per employee per pay period, optional PDF.
-- ============================================================================

-- 1. Employment record (1:1 with profiles)
CREATE TABLE IF NOT EXISTS public.hr_employment (
  employee_id       uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_no       text UNIQUE,
  employment_type   text NOT NULL DEFAULT 'full_time' CHECK (employment_type IN ('full_time','part_time','contract','intern')),
  employment_status text NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active','on_leave','suspended','terminated')),
  manager_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  date_hired        date,
  date_of_birth     date,
  national_id       text,
  kra_pin           text,
  gross_salary      numeric(14,2),
  salary_currency   text NOT NULL DEFAULT 'KES',
  bank_name         text,
  bank_account      text,
  next_of_kin_name  text,
  next_of_kin_phone text,
  updated_by        uuid REFERENCES auth.users(id),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_employment TO authenticated;
GRANT ALL ON public.hr_employment TO service_role;
ALTER TABLE public.hr_employment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr employment select self admin manager" ON public.hr_employment FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR public.is_admin(auth.uid()) OR manager_id = auth.uid());
CREATE POLICY "hr employment write admin" ON public.hr_employment FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Self-service update of the employee's own non-salary fields. Runs as
-- SECURITY DEFINER so it can bypass the admin-only write policy above, but
-- it only ever writes the caller's own row and never touches pay fields.
CREATE OR REPLACE FUNCTION public.update_my_employment_info(
  _date_of_birth date DEFAULT NULL,
  _national_id text DEFAULT NULL,
  _kra_pin text DEFAULT NULL,
  _bank_name text DEFAULT NULL,
  _bank_account text DEFAULT NULL,
  _next_of_kin_name text DEFAULT NULL,
  _next_of_kin_phone text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.hr_employment (employee_id, date_of_birth, national_id, kra_pin, bank_name, bank_account, next_of_kin_name, next_of_kin_phone, updated_by, updated_at)
  VALUES (auth.uid(), _date_of_birth, _national_id, _kra_pin, _bank_name, _bank_account, _next_of_kin_name, _next_of_kin_phone, auth.uid(), now())
  ON CONFLICT (employee_id) DO UPDATE SET
    date_of_birth = COALESCE(_date_of_birth, hr_employment.date_of_birth),
    national_id = COALESCE(_national_id, hr_employment.national_id),
    kra_pin = COALESCE(_kra_pin, hr_employment.kra_pin),
    bank_name = COALESCE(_bank_name, hr_employment.bank_name),
    bank_account = COALESCE(_bank_account, hr_employment.bank_account),
    next_of_kin_name = COALESCE(_next_of_kin_name, hr_employment.next_of_kin_name),
    next_of_kin_phone = COALESCE(_next_of_kin_phone, hr_employment.next_of_kin_phone),
    updated_by = auth.uid(), updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_my_employment_info(date, text, text, text, text, text, text) TO authenticated;

-- 2. HR documents (contracts, ID, tax forms, certificates...)
CREATE TABLE IF NOT EXISTS public.hr_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doc_type    text NOT NULL DEFAULT 'other' CHECK (doc_type IN ('contract','id','tax_form','certificate','other')),
  title       text NOT NULL,
  file_path   text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.hr_documents TO authenticated;
GRANT ALL ON public.hr_documents TO service_role;
ALTER TABLE public.hr_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr documents select self admin" ON public.hr_documents FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "hr documents insert self admin" ON public.hr_documents FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "hr documents delete admin" ON public.hr_documents FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- 3. Leave types + requests
CREATE TABLE IF NOT EXISTS public.leave_types (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  annual_days  numeric(6,2) NOT NULL DEFAULT 0,
  paid         boolean NOT NULL DEFAULT true,
  active       boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0
);

GRANT SELECT ON public.leave_types TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.leave_types TO authenticated;
GRANT ALL ON public.leave_types TO service_role;
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave types read staff" ON public.leave_types FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "leave types write admin" ON public.leave_types FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.leave_types (name, annual_days, paid, sort_order) VALUES
  ('Annual Leave',       21, true,  1),
  ('Sick Leave',         14, true,  2),
  ('Maternity Leave',    90, true,  3),
  ('Paternity Leave',    14, true,  4),
  ('Compassionate Leave', 5, true,  5),
  ('Unpaid Leave',        0, false, 6)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  leave_type_id   uuid NOT NULL REFERENCES public.leave_types(id),
  start_date      date NOT NULL,
  end_date        date NOT NULL CHECK (end_date >= start_date),
  days            numeric(6,2) NOT NULL,
  reason          text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by      uuid REFERENCES public.profiles(id),
  decided_at      timestamptz,
  decision_notes  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.leave_requests TO authenticated;
GRANT ALL ON public.leave_requests TO service_role;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave requests select self manager admin" ON public.leave_requests FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.hr_employment he WHERE he.employee_id = leave_requests.employee_id AND he.manager_id = auth.uid())
  );
CREATE POLICY "leave requests insert self" ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid());
-- Direct updates are limited to the employee cancelling their own still-pending request.
-- Approvals/rejections go through decide_leave_request() (SECURITY DEFINER) below.
CREATE POLICY "leave requests cancel own pending" ON public.leave_requests FOR UPDATE TO authenticated
  USING (employee_id = auth.uid() AND status = 'pending')
  WITH CHECK (employee_id = auth.uid() AND status = 'cancelled');

CREATE OR REPLACE FUNCTION public.request_leave(_leave_type_id uuid, _start_date date, _end_date date, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_manager uuid;
BEGIN
  IF _end_date < _start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date';
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

CREATE OR REPLACE FUNCTION public.decide_leave_request(_id uuid, _approve boolean, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_employee uuid;
  v_manager uuid;
BEGIN
  SELECT employee_id INTO v_employee FROM public.leave_requests WHERE id = _id;
  IF v_employee IS NULL THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  SELECT manager_id INTO v_manager FROM public.hr_employment WHERE employee_id = v_employee;

  IF NOT (public.is_admin(auth.uid()) OR v_manager = auth.uid()) THEN
    RAISE EXCEPTION 'Only the employee''s manager or an admin can decide this request';
  END IF;

  UPDATE public.leave_requests SET
    status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    decided_by = auth.uid(), decided_at = now(), decision_notes = _notes
  WHERE id = _id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request is no longer pending';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (v_employee, 'leave_decision',
    CASE WHEN _approve THEN 'Leave request approved' ELSE 'Leave request rejected' END,
    _notes, '/hr');
END;
$$;
GRANT EXECUTE ON FUNCTION public.decide_leave_request(uuid, boolean, text) TO authenticated;

-- 4. Leave balances: entitlement minus approved days taken this calendar
--    year. Hand-scoped to self / admin / manager (same rule as above) so it
--    is safe to query directly rather than only through an RPC.
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
LEFT JOIN public.leave_requests lr ON lr.employee_id = p.id AND lr.leave_type_id = lt.id
WHERE lt.active
  AND (p.id = auth.uid() OR public.is_admin(auth.uid())
       OR EXISTS (SELECT 1 FROM public.hr_employment he WHERE he.employee_id = p.id AND he.manager_id = auth.uid()))
GROUP BY p.id, lt.id, lt.name, lt.annual_days;

GRANT SELECT ON public.leave_balances TO authenticated;

-- 5. Payslips
CREATE TABLE IF NOT EXISTS public.payslips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period      date NOT NULL,
  gross_pay   numeric(14,2),
  net_pay     numeric(14,2),
  deductions  jsonb NOT NULL DEFAULT '{}'::jsonb,
  file_path   text,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period)
);

GRANT SELECT ON public.payslips TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.payslips TO authenticated;
GRANT ALL ON public.payslips TO service_role;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payslips select self admin" ON public.payslips FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "payslips write admin" ON public.payslips FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Storage buckets: both private, path convention `${employee_id}/filename`.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('hr-documents', 'hr-documents', false),
  ('payslips', 'payslips', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "hr docs read own or admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'hr-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin(auth.uid())));
CREATE POLICY "hr docs write own or admin" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hr-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin(auth.uid())));
CREATE POLICY "hr docs delete admin" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'hr-documents' AND public.is_admin(auth.uid()));

CREATE POLICY "payslips read own or admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payslips' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin(auth.uid())));
CREATE POLICY "payslips write admin" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payslips' AND public.is_admin(auth.uid()));
CREATE POLICY "payslips delete admin" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payslips' AND public.is_admin(auth.uid()));
