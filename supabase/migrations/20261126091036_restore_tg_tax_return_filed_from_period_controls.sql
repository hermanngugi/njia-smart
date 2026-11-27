-- Restores the definition from 20261125234500_tax_filing_invoice_period_controls,
-- which a re-run of the older 20260928100000 migration had overwritten.
CREATE OR REPLACE FUNCTION public.tg_tax_return_filed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_old text:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status::text END;
 v_next_due date; v_next_start date; v_next_end date; v_span integer; v_next_id uuid; v_active boolean;
BEGIN
 IF v_old='filed' AND NEW.status::text<>'filed' THEN NEW.filed_at:=NULL; NEW.filed_by:=NULL; END IF;
 IF NEW.status::text='filed' AND v_old IS DISTINCT FROM 'filed' THEN
  NEW.filed_at:=COALESCE(NEW.filed_at,now()); NEW.filed_by:=COALESCE(NEW.filed_by,auth.uid());
  IF TG_OP='UPDATE' AND NEW.renewed_to_id IS NULL THEN
   SELECT active INTO v_active FROM public.client_tax_obligations WHERE client_id=NEW.client_id AND tax_type=NEW.return_type;
   IF COALESCE(v_active,true) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.client_id::text||':'||NEW.return_type::text,0));
    v_next_due:=public.next_tax_due_date(NEW.return_type::text,NEW.due_date);
    IF NEW.period_start IS NOT NULL AND NEW.period_end IS NOT NULL THEN
     v_span:=NEW.period_end-NEW.period_start; v_next_start:=NEW.period_end+1; v_next_end:=v_next_start+v_span;
    ELSE v_next_start:=NULL; v_next_end:=NULL; END IF;
    SELECT id INTO v_next_id FROM public.tax_returns WHERE client_id=NEW.client_id AND return_type=NEW.return_type
     AND id<>NEW.id AND (due_date=v_next_due OR (v_next_end IS NOT NULL AND period_end=v_next_end)) LIMIT 1;
    IF v_next_id IS NULL THEN
     INSERT INTO public.tax_returns(client_id,return_type,period_start,period_end,due_date,status,assigned_to)
     VALUES(NEW.client_id,NEW.return_type,v_next_start,v_next_end,v_next_due,'pending',NEW.assigned_to) RETURNING id INTO v_next_id;
    END IF;
    NEW.renewed_to_id:=v_next_id;
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
