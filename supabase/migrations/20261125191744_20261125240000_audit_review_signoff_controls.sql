-- Njia Smart repair 09: audit risk links, reviewer assignment and sign-off controls.
CREATE TABLE IF NOT EXISTS public.audit_risk_procedure_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 risk_id uuid NOT NULL REFERENCES public.audit_risks(id) ON DELETE CASCADE,
 engagement_procedure_id uuid NOT NULL REFERENCES public.audit_engagement_procedures(id) ON DELETE CASCADE,
 linked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
 linked_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(risk_id,engagement_procedure_id)
);
CREATE INDEX IF NOT EXISTS audit_risk_procedure_links_procedure_idx ON public.audit_risk_procedure_links(engagement_procedure_id);
ALTER TABLE public.audit_risk_procedure_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit risk procedure links financial staff" ON public.audit_risk_procedure_links;
CREATE POLICY "audit risk procedure links financial staff" ON public.audit_risk_procedure_links FOR ALL TO authenticated
USING(public.can_access_financials(auth.uid()))
WITH CHECK(public.can_access_financials(auth.uid()) AND (linked_by IS NULL OR linked_by=auth.uid()));

CREATE OR REPLACE FUNCTION public.audit_validate_risk_procedure_engagement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_risk uuid; v_proc uuid;
BEGIN
 SELECT engagement_id INTO v_risk FROM public.audit_risks WHERE id=NEW.risk_id;
 SELECT engagement_id INTO v_proc FROM public.audit_engagement_procedures WHERE id=NEW.engagement_procedure_id;
 IF v_risk IS NULL OR v_proc IS NULL OR v_risk<>v_proc THEN RAISE EXCEPTION 'Risk and procedure must belong to the same engagement'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_validate_risk_procedure_engagement ON public.audit_risk_procedure_links;
CREATE TRIGGER audit_validate_risk_procedure_engagement BEFORE INSERT OR UPDATE ON public.audit_risk_procedure_links
FOR EACH ROW EXECUTE FUNCTION public.audit_validate_risk_procedure_engagement();

ALTER TABLE public.audit_engagement_procedures
 ADD COLUMN IF NOT EXISTS assigned_reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.audit_signoffs
 ADD COLUMN IF NOT EXISTS result_id uuid REFERENCES public.audit_procedure_results(id) ON DELETE RESTRICT;
ALTER TABLE public.audit_review_notes
 ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
 ADD COLUMN IF NOT EXISTS resolution_note text;
CREATE INDEX IF NOT EXISTS audit_engagement_procedures_reviewer_idx ON public.audit_engagement_procedures(engagement_id,assigned_reviewer_id,status);
CREATE INDEX IF NOT EXISTS audit_signoffs_latest_idx ON public.audit_signoffs(engagement_procedure_id,signed_at DESC);

CREATE OR REPLACE FUNCTION public.audit_set_review_note_resolution_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NEW.resolved IS TRUE AND COALESCE(OLD.resolved,false) IS FALSE THEN
  NEW.resolved_by:=auth.uid(); NEW.resolved_at:=now();
 ELSIF NEW.resolved IS FALSE THEN
  NEW.resolved_by:=NULL; NEW.resolved_at:=NULL; NEW.resolution_note:=NULL;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_review_note_resolution_metadata ON public.audit_review_notes;
CREATE TRIGGER audit_review_note_resolution_metadata BEFORE UPDATE OF resolved ON public.audit_review_notes
FOR EACH ROW EXECUTE FUNCTION public.audit_set_review_note_resolution_metadata();

CREATE OR REPLACE FUNCTION public.audit_guard_procedure_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_result uuid; v_prepared_at timestamptz; v_work text; v_conclusion text;
 v_decision text; v_signed_at timestamptz; v_signed_result uuid;
BEGIN
 IF NEW.status=OLD.status THEN RETURN NEW; END IF;
 IF OLD.status='completed' AND NEW.status<>'completed' THEN RAISE EXCEPTION 'Completed audit procedures require controlled amendment'; END IF;
 IF NEW.status IN ('prepared','under_review','completed') THEN
  SELECT r.id,r.prepared_at,r.work_performed,r.conclusion INTO v_result,v_prepared_at,v_work,v_conclusion
  FROM public.audit_procedure_results r WHERE r.engagement_procedure_id=NEW.id ORDER BY r.prepared_at DESC,r.created_at DESC LIMIT 1;
  IF v_prepared_at IS NULL OR NULLIF(btrim(v_work),'') IS NULL OR NULLIF(btrim(v_conclusion),'') IS NULL THEN
   RAISE EXCEPTION 'Record work performed and a conclusion before review';
  END IF;
 END IF;
 IF NEW.status='under_review' AND NEW.assigned_reviewer_id IS NULL THEN RAISE EXCEPTION 'Assign a reviewer before submitting'; END IF;
 IF NEW.status='completed' THEN
  IF NEW.assigned_reviewer_id IS NULL THEN RAISE EXCEPTION 'Assign a reviewer before completing'; END IF;
  SELECT s.decision,s.signed_at,s.result_id INTO v_decision,v_signed_at,v_signed_result
  FROM public.audit_signoffs s WHERE s.engagement_procedure_id=NEW.id AND s.reviewer_id=NEW.assigned_reviewer_id
  ORDER BY s.signed_at DESC LIMIT 1;
  IF v_decision IS DISTINCT FROM 'approved' OR v_signed_at IS NULL OR v_signed_at<v_prepared_at OR v_signed_result IS DISTINCT FROM v_result THEN
   RAISE EXCEPTION 'Assigned reviewer must approve the latest prepared result';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_guard_procedure_status ON public.audit_engagement_procedures;
CREATE TRIGGER audit_guard_procedure_status BEFORE UPDATE OF status ON public.audit_engagement_procedures
FOR EACH ROW EXECUTE FUNCTION public.audit_guard_procedure_status();

CREATE OR REPLACE FUNCTION public.audit_record_procedure_signoff(p_engagement_procedure_id uuid,p_decision text,p_comments text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_proc public.audit_engagement_procedures%ROWTYPE; v_preparer uuid; v_result uuid;
 v_prepared_at timestamptz; v_work text; v_conclusion text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_access_financials(auth.uid()) THEN RAISE EXCEPTION 'Not authorised to review audit procedures'; END IF;
 IF p_decision NOT IN ('approved','changes_requested','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
 IF p_decision<>'approved' AND NULLIF(btrim(p_comments),'') IS NULL THEN RAISE EXCEPTION 'Comments are required for changes or rejection'; END IF;
 SELECT * INTO v_proc FROM public.audit_engagement_procedures WHERE id=p_engagement_procedure_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Audit procedure not found'; END IF;
 IF v_proc.assigned_reviewer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only the assigned reviewer can sign off'; END IF;
 IF v_proc.status NOT IN ('prepared','under_review','review_notes') THEN RAISE EXCEPTION 'Procedure is not ready for review'; END IF;
 SELECT r.prepared_by,r.id,r.prepared_at,r.work_performed,r.conclusion INTO v_preparer,v_result,v_prepared_at,v_work,v_conclusion
 FROM public.audit_procedure_results r WHERE r.engagement_procedure_id=v_proc.id
 ORDER BY r.prepared_at DESC,r.created_at DESC LIMIT 1;
 IF v_prepared_at IS NULL OR NULLIF(btrim(v_work),'') IS NULL OR NULLIF(btrim(v_conclusion),'') IS NULL THEN RAISE EXCEPTION 'Latest result needs work performed and conclusion'; END IF;
 IF v_preparer IS NULL OR v_preparer=auth.uid() THEN RAISE EXCEPTION 'Preparer cannot approve own work'; END IF;
 INSERT INTO public.audit_signoffs(engagement_procedure_id,reviewer_id,decision,comments,result_id)
 VALUES(v_proc.id,auth.uid(),p_decision,NULLIF(btrim(p_comments),''),v_result);
 IF p_decision='approved' THEN
  UPDATE public.audit_engagement_procedures SET status='completed',updated_at=now() WHERE id=v_proc.id;
 ELSE
  UPDATE public.audit_engagement_procedures SET status='review_notes',updated_at=now() WHERE id=v_proc.id;
 END IF;
 INSERT INTO public.audit_change_history(engagement_id,entity_type,entity_id,action,after_data,reason,actor_id)
 VALUES(v_proc.engagement_id,'audit_procedure_signoff',v_proc.id::text,'signed_off',
  jsonb_build_object('decision',p_decision,'comments',NULLIF(btrim(p_comments),'')),'Reviewer decision recorded',auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.audit_record_procedure_signoff(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.audit_record_procedure_signoff(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_guard_engagement_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NEW.status::text<>'completed' OR OLD.status::text='completed' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_engagement_procedures p WHERE p.engagement_id=NEW.id) THEN
  RAISE EXCEPTION 'Initialise audit procedures before completing engagement';
 END IF;
 IF EXISTS(
  SELECT 1 FROM (SELECT DISTINCT pack_id,pack_version FROM public.audit_engagement_procedures WHERE engagement_id=NEW.id) packs
  JOIN public.audit_procedure_definitions d ON d.pack_id=packs.pack_id AND d.pack_version=packs.pack_version
  WHERE d.enabled AND d.required AND NOT EXISTS(SELECT 1 FROM public.audit_engagement_procedures p
   WHERE p.engagement_id=NEW.id AND p.pack_id=d.pack_id AND p.pack_version=d.pack_version AND p.procedure_id=d.procedure_id)
 ) THEN RAISE EXCEPTION 'Required audit procedures have not been initialised'; END IF;
 IF EXISTS(SELECT 1 FROM public.audit_engagement_procedures p JOIN public.audit_procedure_definitions d
  ON d.pack_id=p.pack_id AND d.pack_version=p.pack_version AND d.procedure_id=p.procedure_id
  WHERE p.engagement_id=NEW.id AND d.enabled AND d.required AND p.status NOT IN ('completed','not_applicable')) THEN
  RAISE EXCEPTION 'Complete or mark not applicable all required audit procedures'; END IF;
 IF EXISTS(SELECT 1 FROM public.audit_review_notes n WHERE n.engagement_id=NEW.id AND n.resolved=false) THEN
  RAISE EXCEPTION 'Resolve all audit review notes before completing engagement'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_guard_engagement_completion ON public.engagements;
CREATE TRIGGER audit_guard_engagement_completion BEFORE UPDATE OF status ON public.engagements
FOR EACH ROW EXECUTE FUNCTION public.audit_guard_engagement_completion();

-- Sign-offs are append-only through the verified RPC; read remains available to audit staff.
DROP POLICY IF EXISTS "audit signoffs financial staff" ON public.audit_signoffs;
DROP POLICY IF EXISTS "audit signoffs read financial staff" ON public.audit_signoffs;
CREATE POLICY "audit signoffs read financial staff" ON public.audit_signoffs FOR SELECT TO authenticated
USING(public.can_access_financials(auth.uid()));
REVOKE INSERT,UPDATE,DELETE ON public.audit_signoffs FROM authenticated;
NOTIFY pgrst,'reload schema';