-- Njia Smart repair 04: controlled leave workflow, handover and retention.
-- Supersedes unapplied 20261021160000/170000/180000 and 20261111090000/
-- 20261112090000 HR drafts. Preserves completed leave history.

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS reliever_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reliever_decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reliever_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS reliever_decision_notes text,
  ADD COLUMN IF NOT EXISTS transferred_tasks_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transferred_tax_returns_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transferred_milestones_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_reset_at timestamptz,
  ADD COLUMN IF NOT EXISTS balance_reset_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS balance_reset_reason text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text,
  ADD COLUMN IF NOT EXISTS employee_name_snapshot text;

UPDATE public.leave_requests lr
SET employee_name_snapshot = COALESCE(NULLIF(trim(p.full_name),''), 'Former staff member')
FROM public.profiles p
WHERE p.id=lr.employee_id AND lr.employee_name_snapshot IS NULL;

-- Preserve leave rows if a staff profile is removed. The name snapshot remains.
ALTER TABLE public.leave_requests ALTER COLUMN employee_id DROP NOT NULL;
ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_employee_id_fkey;
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_employee_id_fkey
FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_status_check
CHECK (status IN ('pending','reliever_approved','approved','rejected','cancelled'));

DROP POLICY IF EXISTS "leave requests select self manager admin" ON public.leave_requests;
DROP POLICY IF EXISTS "leave requests select leave workflow" ON public.leave_requests;
CREATE POLICY "leave requests select leave workflow" ON public.leave_requests
FOR SELECT TO authenticated USING (
  employee_id=auth.uid()
  OR reliever_id=auth.uid()
  OR public.is_admin(auth.uid())
  OR EXISTS(SELECT 1 FROM public.hr_employment he WHERE he.employee_id=leave_requests.employee_id AND he.manager_id=auth.uid())
);
-- All new requests must pass the SECURITY DEFINER validation RPC.
DROP POLICY IF EXISTS "leave requests insert self" ON public.leave_requests;

CREATE OR REPLACE FUNCTION public.list_leave_relievers()
RETURNS TABLE(id uuid,full_name text,job_title text,roles text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT p.id,COALESCE(NULLIF(trim(p.full_name),''),p.id::text),p.job_title,
        COALESCE(array_agg(DISTINCT ur.role::text) FILTER(WHERE ur.role IS NOT NULL),ARRAY[]::text[])
 FROM public.profiles p JOIN public.user_roles ur ON ur.user_id=p.id
 LEFT JOIN public.hr_employment he ON he.employee_id=p.id
 WHERE auth.uid() IS NOT NULL AND public.is_staff(auth.uid()) AND p.id<>auth.uid()
   AND public.is_staff(p.id)
   AND COALESCE(lower(he.employment_status),'active') NOT IN ('inactive','terminated','suspended')
 GROUP BY p.id,p.full_name,p.job_title ORDER BY 2;
$$;
REVOKE ALL ON FUNCTION public.list_leave_relievers() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_leave_relievers() TO authenticated;

CREATE OR REPLACE FUNCTION public.request_leave(
 _leave_type_id uuid,_start_date date,_end_date date,_reason text DEFAULT NULL,_reliever_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_required text; v_type_name text; v_gender text; v_name text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Only active staff can request leave'; END IF;
 IF _start_date IS NULL OR _end_date IS NULL OR _end_date<_start_date THEN RAISE EXCEPTION 'Invalid leave dates'; END IF;
 IF _reliever_id IS NULL OR _reliever_id=auth.uid() OR NOT public.is_staff(_reliever_id) THEN RAISE EXCEPTION 'Select another active staff member as reliever'; END IF;
 IF EXISTS(SELECT 1 FROM public.hr_employment he WHERE he.employee_id=_reliever_id AND lower(he.employment_status) IN ('inactive','terminated','suspended')) THEN
  RAISE EXCEPTION 'The selected reliever is inactive or ineligible';
 END IF;
 SELECT eligible_gender,name INTO v_required,v_type_name FROM public.leave_types WHERE id=_leave_type_id AND active;
 IF v_type_name IS NULL THEN RAISE EXCEPTION 'Select an active leave type'; END IF;
 IF v_required IS NOT NULL THEN
  SELECT gender INTO v_gender FROM public.hr_employment WHERE employee_id=auth.uid();
  IF v_gender IS DISTINCT FROM v_required THEN RAISE EXCEPTION '% is not available for your record; ask HR to verify your details',v_type_name; END IF;
 END IF;
 SELECT COALESCE(NULLIF(trim(full_name),''),'A colleague') INTO v_name FROM public.profiles WHERE id=auth.uid();
 INSERT INTO public.leave_requests(employee_id,employee_name_snapshot,leave_type_id,start_date,end_date,days,reason,reliever_id)
 VALUES(auth.uid(),COALESCE(v_name,'A colleague'),_leave_type_id,_start_date,_end_date,(_end_date-_start_date+1),_reason,_reliever_id)
 RETURNING id INTO v_id;
 INSERT INTO public.notifications(user_id,type,title,body,link)
 VALUES(_reliever_id,'leave_request','Leave request needs your review',COALESCE(v_name,'A colleague')||' nominated you as reliever and requested leave','/hr');
 RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_leave(uuid,date,date,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_leave(uuid,date,date,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_leave_request(_id uuid,_approve boolean,_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.leave_requests%ROWTYPE; v_count integer:=0; v_name text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
 SELECT * INTO v FROM public.leave_requests WHERE id=_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Leave request not found'; END IF;
 SELECT COALESCE(NULLIF(trim(p.full_name),''),v.employee_name_snapshot,'An employee')
 INTO v_name FROM public.profiles p WHERE p.id=v.employee_id;
 v_name:=COALESCE(v_name,v.employee_name_snapshot,'An employee');

 IF v.status='pending' THEN
  IF v.reliever_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only the nominated reliever can review this request'; END IF;
  UPDATE public.leave_requests SET
   status=CASE WHEN _approve THEN 'reliever_approved' ELSE 'rejected' END,
   reliever_decided_by=auth.uid(),reliever_decided_at=now(),reliever_decision_notes=_notes,
   decided_by=CASE WHEN NOT _approve THEN auth.uid() ELSE decided_by END,
   decided_at=CASE WHEN NOT _approve THEN now() ELSE decided_at END,
   decision_notes=CASE WHEN NOT _approve THEN COALESCE(_notes,'Rejected by reliever') ELSE decision_notes END
  WHERE id=_id;
  IF _approve THEN
   INSERT INTO public.notifications(user_id,type,title,body,link)
   SELECT ur.user_id,'leave_request','Leave request awaiting final approval',v_name||' has reliever approval. No work has been transferred yet.','/hr'
   FROM public.user_roles ur WHERE ur.role='director';
   INSERT INTO public.notifications(user_id,type,title,body,link)
   VALUES(v.employee_id,'leave_decision','Reliever approved your request','Your request is awaiting Director/Admin approval. No work has been transferred yet.','/hr');
  ELSE
   INSERT INTO public.notifications(user_id,type,title,body,link)
   VALUES(v.employee_id,'leave_decision','Leave request rejected by reliever',COALESCE(_notes,'Your nominated reliever declined the handover.'),'/hr');
  END IF;
  RETURN;
 END IF;

 IF v.status='reliever_approved' THEN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only Director/Admin can make the final leave decision'; END IF;
  IF _approve THEN
   UPDATE public.tasks SET assigned_to=v.reliever_id
    WHERE assigned_to=v.employee_id AND client_id IS NOT NULL
      AND status::text NOT IN ('done','completed','cancelled','closed','filed');
   GET DIAGNOSTICS v_count=ROW_COUNT;
   UPDATE public.leave_requests SET transferred_tasks_count=v_count WHERE id=_id;

   UPDATE public.tax_returns SET assigned_to=v.reliever_id,assigned_by=auth.uid(),assigned_at=now()
    WHERE assigned_to=v.employee_id AND status::text NOT IN ('filed','completed','cancelled');
   GET DIAGNOSTICS v_count=ROW_COUNT;
   UPDATE public.leave_requests SET transferred_tax_returns_count=v_count WHERE id=_id;

   UPDATE public.service_milestones sm SET assigned_to=v.reliever_id
    FROM public.service_projects sp
    WHERE sm.project_id=sp.id AND sp.client_id IS NOT NULL
      AND sm.assigned_to=v.employee_id AND NOT sm.done;
   GET DIAGNOSTICS v_count=ROW_COUNT;
   UPDATE public.leave_requests SET transferred_milestones_count=v_count WHERE id=_id;
  END IF;
  UPDATE public.leave_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
   decided_by=auth.uid(),decided_at=now(),
   decision_notes=COALESCE(_notes,CASE WHEN _approve THEN 'Approved; outstanding client work handed over.' ELSE 'Rejected; no work transferred.' END)
  WHERE id=_id;
  INSERT INTO public.notifications(user_id,type,title,body,link)
  VALUES(v.employee_id,'leave_decision',CASE WHEN _approve THEN 'Leave request approved' ELSE 'Leave request rejected' END,
   CASE WHEN _approve THEN 'Your leave was approved and outstanding client-related work was transferred to your reliever.' ELSE COALESCE(_notes,'Your leave request was rejected. No work was transferred.') END,'/hr');
  IF _approve THEN
   INSERT INTO public.notifications(user_id,type,title,body,link)
   VALUES(v.reliever_id,'leave_handover','Client work handed over to you',v_name||'''s leave was approved. Outstanding client work has been assigned to you.','/hr');
  END IF;
  RETURN;
 END IF;
 RAISE EXCEPTION 'Request is no longer awaiting a decision';
END;
$$;
REVOKE ALL ON FUNCTION public.decide_leave_request(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_leave_request(uuid,boolean,text) TO authenticated;

-- Keep the legacy RPC name but make it archive rather than physically delete.
CREATE OR REPLACE FUNCTION public.delete_leave_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only Director/Admin may archive leave records'; END IF;
 UPDATE public.leave_requests SET archived_at=now(),archived_by=auth.uid(),
  archive_reason=COALESCE(NULLIF(btrim(archive_reason),''),'Archived by Director/Admin')
 WHERE id=_id AND status IN ('approved','rejected') AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Only unarchived approved/rejected leave records can be archived'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_leave_record(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_leave_record(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.leave_balances WITH (security_invoker=true) AS
SELECT p.id AS employee_id,lt.id AS leave_type_id,lt.name AS leave_type_name,lt.annual_days AS entitled_days,
 COALESCE(SUM(lr.days) FILTER(WHERE lr.status='approved' AND lr.balance_reset_at IS NULL AND lr.archived_at IS NULL AND EXTRACT(YEAR FROM lr.start_date)=EXTRACT(YEAR FROM CURRENT_DATE)),0) AS used_days,
 lt.annual_days-COALESCE(SUM(lr.days) FILTER(WHERE lr.status='approved' AND lr.balance_reset_at IS NULL AND lr.archived_at IS NULL AND EXTRACT(YEAR FROM lr.start_date)=EXTRACT(YEAR FROM CURRENT_DATE)),0) AS remaining_days
FROM public.profiles p CROSS JOIN public.leave_types lt
LEFT JOIN public.hr_employment he ON he.employee_id=p.id
LEFT JOIN public.leave_requests lr ON lr.employee_id=p.id AND lr.leave_type_id=lt.id
WHERE lt.active AND (lt.eligible_gender IS NULL OR lt.eligible_gender=he.gender)
 AND (p.id=auth.uid() OR public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.hr_employment m WHERE m.employee_id=p.id AND m.manager_id=auth.uid()))
GROUP BY p.id,lt.id,lt.name,lt.annual_days;
GRANT SELECT ON public.leave_balances TO authenticated;

CREATE OR REPLACE FUNCTION public.reset_leave_balance(_employee_id uuid,_leave_type_id uuid DEFAULT NULL,_reason text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer:=0;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only Director/Admin can reset leave balances'; END IF;
 IF NULLIF(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'A reason is required'; END IF;
 UPDATE public.leave_requests SET balance_reset_at=now(),balance_reset_by=auth.uid(),balance_reset_reason=btrim(_reason)
 WHERE employee_id=_employee_id AND status='approved' AND balance_reset_at IS NULL AND archived_at IS NULL
  AND EXTRACT(YEAR FROM start_date)=EXTRACT(YEAR FROM CURRENT_DATE)
  AND (_leave_type_id IS NULL OR leave_type_id=_leave_type_id);
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count>0 THEN
  INSERT INTO public.notifications(user_id,type,title,body,link)
  VALUES(_employee_id,'leave_decision','Your leave days were reset','An admin reset your used leave days. Reason: '||btrim(_reason),'/hr');
 END IF;
 RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_leave_balance(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reset_leave_balance(uuid,uuid,text) TO authenticated;

NOTIFY pgrst,'reload schema';