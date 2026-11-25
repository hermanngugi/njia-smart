-- Njia Smart repair 20: enforce module assignment and paused-client rules in completion invoicing.
CREATE OR REPLACE FUNCTION public.create_completion_invoice(
 _source text,_source_id uuid,_description text,_amount numeric,_vat_rate numeric DEFAULT 16
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_client uuid; v_existing uuid; v_line text; v_module text; v_assignee uuid;
 v_found boolean:=false; v_allowed boolean:=false; v_inv uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _amount IS NULL OR _amount<=0 THEN RAISE EXCEPTION 'Enter an invoice amount greater than zero'; END IF;

 IF _source='tax_returns' THEN
  SELECT client_id,invoice_id,'Tax','tax',assigned_to INTO v_client,v_existing,v_line,v_module,v_assignee
  FROM public.tax_returns WHERE id=_source_id FOR UPDATE;
  v_found:=FOUND;
 ELSIF _source='engagements' THEN
  SELECT client_id,invoice_id,initcap(type::text),type::text,assigned_to INTO v_client,v_existing,v_line,v_module,v_assignee
  FROM public.engagements WHERE id=_source_id FOR UPDATE;
  v_found:=FOUND;
 ELSIF _source='advisory_projects' THEN
  SELECT client_id,invoice_id,'Advisory','advisory',created_by INTO v_client,v_existing,v_line,v_module,v_assignee
  FROM public.advisory_projects WHERE id=_source_id FOR UPDATE;
  v_found:=FOUND;
 ELSIF _source='service_projects' THEN
  SELECT client_id,invoice_id,public.normalize_service_line(module::text),module::text,created_by
  INTO v_client,v_existing,v_line,v_module,v_assignee
  FROM public.service_projects WHERE id=_source_id FOR UPDATE;
  v_found:=FOUND;
 ELSE
  RAISE EXCEPTION 'Unknown invoice source %',_source;
 END IF;
 IF NOT v_found THEN RAISE EXCEPTION 'Record not found'; END IF;
 IF NOT public.can_access_client(v_client) THEN RAISE EXCEPTION 'Client is paused or inaccessible'; END IF;

 IF public.has_full_module(auth.uid(),v_module) THEN
  v_allowed:=true;
 ELSIF public.is_module_assigned_only(auth.uid(),v_module) AND (
  v_assignee=auth.uid() OR EXISTS(
   SELECT 1 FROM public.client_assignments ca WHERE ca.client_id=v_client AND ca.user_id=auth.uid()
  )
 ) THEN
  v_allowed:=true;
 END IF;
 IF NOT v_allowed THEN RAISE EXCEPTION 'You are not authorised to invoice this record'; END IF;

 IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
 INSERT INTO public.invoices(invoice_number,client_id,issue_date,due_date,service_line,vat_rate,created_by)
 VALUES(public.next_invoice_number(),v_client,CURRENT_DATE,CURRENT_DATE+7,v_line,COALESCE(_vat_rate,16),auth.uid())
 RETURNING id INTO v_inv;
 INSERT INTO public.invoice_items(invoice_id,description,quantity,unit_price,amount,sort_order)
 VALUES(v_inv,COALESCE(NULLIF(trim(_description),''),v_line||' services'),1,_amount,_amount,0);
 IF _source='tax_returns' THEN
  UPDATE public.tax_returns SET invoice_id=v_inv WHERE id=_source_id;
 ELSIF _source='engagements' THEN
  UPDATE public.engagements SET invoice_id=v_inv WHERE id=_source_id;
 ELSIF _source='advisory_projects' THEN
  UPDATE public.advisory_projects SET invoice_id=v_inv WHERE id=_source_id;
 ELSE
  UPDATE public.service_projects SET invoice_id=v_inv WHERE id=_source_id;
 END IF;
 RETURN v_inv;
END;
$$;
REVOKE ALL ON FUNCTION public.create_completion_invoice(text,uuid,text,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_completion_invoice(text,uuid,text,numeric,numeric) TO authenticated;
