-- ============================================================================
-- Let an Admin/Director reset an employee's used leave days.
--
-- leave_balances is a view: entitlement minus the approved days taken this
-- calendar year. To "reset" days without destroying the leave history, an
-- approved request can be stamped as reset - it stays on record (who, when,
-- why) but stops counting against the balance. Wrongly recorded requests can
-- still be removed outright with delete_leave_record() (Leave Records tab).
-- ============================================================================

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS balance_reset_at     timestamptz,
  ADD COLUMN IF NOT EXISTS balance_reset_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS balance_reset_reason text;

-- Same view as before, but reset requests no longer count as used days.
CREATE OR REPLACE VIEW public.leave_balances AS
SELECT
  p.id AS employee_id,
  lt.id AS leave_type_id,
  lt.name AS leave_type_name,
  lt.annual_days AS entitled_days,
  COALESCE(SUM(lr.days) FILTER (
    WHERE lr.status = 'approved' AND lr.balance_reset_at IS NULL
      AND EXTRACT(YEAR FROM lr.start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
  ), 0) AS used_days,
  lt.annual_days - COALESCE(SUM(lr.days) FILTER (
    WHERE lr.status = 'approved' AND lr.balance_reset_at IS NULL
      AND EXTRACT(YEAR FROM lr.start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
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

-- Reset an employee's used days for the current year (one leave type, or all
-- when _leave_type_id is NULL). Returns how many requests were reset.
CREATE OR REPLACE FUNCTION public.reset_leave_balance(
  _employee_id uuid,
  _leave_type_id uuid DEFAULT NULL,
  _reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'You must be signed in'; END IF;
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin or director can reset leave days';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to reset leave days';
  END IF;

  UPDATE public.leave_requests
  SET balance_reset_at = now(),
      balance_reset_by = auth.uid(),
      balance_reset_reason = btrim(_reason)
  WHERE employee_id = _employee_id
    AND status = 'approved'
    AND balance_reset_at IS NULL
    AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
    AND (_leave_type_id IS NULL OR leave_type_id = _leave_type_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_employee_id, 'leave_decision', 'Your leave days were reset',
      'An admin reset your used leave days for this year. Reason: ' || btrim(_reason), '/hr');
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_leave_balance(uuid, uuid, text) TO authenticated;
