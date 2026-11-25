-- Njia Smart repair 07: tax filing periods, invoice batching and filed-period controls.
-- This is the final merged version of the unapplied tax filing/invoice drafts.

CREATE OR REPLACE FUNCTION public.tax_return_open_date(_type text,_due date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN _due IS NULL THEN NULL WHEN public.tax_return_cadence(_type)='annual'
 THEN date_trunc('year',_due)::date ELSE date_trunc('month',_due)::date END;
$$;
REVOKE ALL ON FUNCTION public.tax_return_open_date(text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tax_return_open_date(text,date) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.tg_tax_return_no_duplicate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id
 AND NEW.return_type IS NOT DISTINCT FROM OLD.return_type
 AND NEW.due_date IS NOT DISTINCT FROM OLD.due_date
 AND NEW.period_end IS NOT DISTINCT FROM OLD.period_end THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.client_id::text||':'||NEW.return_type::text,0));
 IF EXISTS(SELECT 1 FROM public.tax_returns t WHERE t.client_id=NEW.client_id AND t.return_type=NEW.return_type
   AND t.id IS DISTINCT FROM NEW.id AND (t.due_date=NEW.due_date OR (NEW.period_end IS NOT NULL AND t.period_end=NEW.period_end))) THEN
  RAISE EXCEPTION 'A filing for this client and period already exists; open the existing record' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tax_return_no_duplicate ON public.tax_returns;
CREATE TRIGGER trg_tax_return_no_duplicate BEFORE INSERT OR UPDATE ON public.tax_returns FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_no_duplicate();

CREATE OR REPLACE FUNCTION public.tg_tax_return_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR TG_OP<>'UPDATE' THEN RETURN NEW; END IF;
 IF OLD.status::text='filed' THEN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.return_type IS DISTINCT FROM OLD.return_type
   OR NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.period_start IS DISTINCT FROM OLD.period_start
   OR NEW.period_end IS DISTINCT FROM OLD.period_end THEN
   RAISE EXCEPTION 'Filed period identity and dates are immutable';
  END IF;
  IF NEW.status::text<>'filed' THEN
   IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only Director/Admin can reopen a filed period'; END IF;
   IF EXISTS(SELECT 1 FROM public.tax_returns t WHERE t.client_id=OLD.client_id AND t.return_type=OLD.return_type
      AND t.id<>OLD.id AND t.due_date>OLD.due_date AND t.status::text<>'filed') THEN
    RAISE EXCEPTION 'Cannot reopen this period while a later period remains open';
   END IF;
  END IF;
 ELSIF NEW.status::text='filed'
  AND (now() AT TIME ZONE 'Africa/Nairobi')::date < public.tax_return_open_date(NEW.return_type::text,NEW.due_date) THEN
  RAISE EXCEPTION 'This filing period opens on %',to_char(public.tax_return_open_date(NEW.return_type::text,NEW.due_date),'DD Mon YYYY');
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tax_return_lock ON public.tax_returns;
CREATE TRIGGER trg_tax_return_lock BEFORE UPDATE ON public.tax_returns FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_lock();

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
DROP TRIGGER IF EXISTS trg_tax_return_filed ON public.tax_returns;
CREATE TRIGGER trg_tax_return_filed BEFORE INSERT OR UPDATE OF status ON public.tax_returns FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_filed();

CREATE OR REPLACE FUNCTION public.set_client_tax_obligation(_client_id uuid,_tax_type text,_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_exists boolean; v_due date; v_guard integer:=0;
BEGIN
 IF auth.uid() IS NULL OR NOT (
  public.has_full_module(auth.uid(),'tax') OR
  (public.is_module_assigned_only(auth.uid(),'tax') AND EXISTS(
   SELECT 1 FROM public.client_assignments ca WHERE ca.client_id=_client_id AND ca.user_id=auth.uid()))
 ) THEN RAISE EXCEPTION 'Not authorised to manage this client tax obligation'; END IF;
 IF NOT public.can_access_client(_client_id) THEN RAISE EXCEPTION 'Client is paused or inaccessible'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_client_id::text||':'||_tax_type,0));
 INSERT INTO public.client_tax_obligations(client_id,tax_type,active)
 VALUES(_client_id,_tax_type,_active)
 ON CONFLICT(client_id,tax_type) DO UPDATE SET active=EXCLUDED.active,updated_at=now();
 IF _active THEN
  SELECT EXISTS(SELECT 1 FROM public.tax_returns WHERE client_id=_client_id AND return_type=_tax_type AND status::text<>'filed') INTO v_exists;
  IF NOT v_exists THEN
   v_due:=make_date(EXTRACT(YEAR FROM (now() AT TIME ZONE 'Africa/Nairobi'))::int,
    EXTRACT(MONTH FROM (now() AT TIME ZONE 'Africa/Nairobi'))::int,
    public.tax_return_due_day(_tax_type));
   IF v_due<(now() AT TIME ZONE 'Africa/Nairobi')::date THEN v_due:=public.next_tax_due_date(_tax_type,v_due); END IF;
   WHILE v_guard<36 AND EXISTS(SELECT 1 FROM public.tax_returns WHERE client_id=_client_id AND return_type=_tax_type AND due_date=v_due) LOOP
    v_due:=public.next_tax_due_date(_tax_type,v_due); v_guard:=v_guard+1;
   END LOOP;
   INSERT INTO public.tax_returns(client_id,return_type,due_date,status) VALUES(_client_id,_tax_type,v_due,'pending');
  END IF;
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_client_tax_obligation(uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_client_tax_obligation(uuid,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_current_tax_filing_periods()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o record; m date; first_m date; cur_m date:=(date_trunc('month',now() AT TIME ZONE 'Africa/Nairobi'))::date;
 due date; due_day integer; pstart date; pend date; assigned uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_admin(auth.uid()) OR public.has_full_module(auth.uid(),'tax')) THEN
  RAISE EXCEPTION 'Only Director/Admin or full Tax access can prepare filing periods';
 END IF;
 FOR o IN SELECT ob.client_id,ob.tax_type FROM public.client_tax_obligations ob
  JOIN public.tax_policies tp ON tp.tax_type::text=ob.tax_type::text WHERE ob.active AND tp.active
 LOOP
  IF public.tax_return_cadence(o.tax_type::text)<>'monthly' THEN CONTINUE; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(o.client_id::text||':'||o.tax_type::text,0));
  SELECT date_trunc('month',min(due_date))::date INTO first_m FROM public.tax_returns WHERE client_id=o.client_id AND return_type::text=o.tax_type::text;
  first_m:=COALESCE(first_m,cur_m); IF first_m>cur_m THEN CONTINUE; END IF;
  SELECT assigned_to INTO assigned FROM public.tax_returns WHERE client_id=o.client_id AND return_type::text=o.tax_type::text ORDER BY due_date DESC LIMIT 1;
  due_day:=public.tax_return_due_day(o.tax_type::text); m:=first_m;
  WHILE m<=cur_m LOOP
   due:=LEAST(m+(due_day-1),(m+interval '1 month - 1 day')::date);
   pstart:=(m-interval '1 month')::date; pend:=m-1;
   IF NOT EXISTS(SELECT 1 FROM public.tax_returns t WHERE t.client_id=o.client_id AND t.return_type::text=o.tax_type::text AND t.due_date=due) THEN
    INSERT INTO public.tax_returns(client_id,return_type,period_start,period_end,due_date,status,assigned_to)
    VALUES(o.client_id,o.tax_type,pstart,pend,due,'pending',assigned);
   END IF;
   m:=(m+interval '1 month')::date;
  END LOOP;
 END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_current_tax_filing_periods() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ensure_current_tax_filing_periods() TO authenticated;

DROP FUNCTION IF EXISTS public.create_tax_filing_invoice(jsonb,numeric);
CREATE OR REPLACE FUNCTION public.create_tax_filing_invoice(_items jsonb,_vat_rate numeric DEFAULT 16)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date; ids uuid[]; cnt integer; total numeric; neg integer;
 found_cnt integer; client_cnt integer; client_id uuid; invoiced integer; filed integer; denied integer;
 inv uuid; inv_no text; created boolean:=false; item jsonb; pos integer; memo_text text; old_memo text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _items IS NULL OR jsonb_typeof(_items)<>'array' OR jsonb_array_length(_items)=0 THEN RAISE EXCEPTION 'Select at least one filing'; END IF;
 SELECT array_agg((e->>'return_id')::uuid),count(*),COALESCE(sum(COALESCE((e->>'amount')::numeric,0)),0),
  count(*) FILTER(WHERE COALESCE((e->>'amount')::numeric,0)<0)
 INTO ids,cnt,total,neg FROM jsonb_array_elements(_items) e;
 IF neg>0 OR total<=0 THEN RAISE EXCEPTION 'Invoice amounts must be non-negative and total more than zero'; END IF;
 IF (SELECT count(DISTINCT x) FROM unnest(ids) x)<>cnt THEN RAISE EXCEPTION 'Duplicate filing selected'; END IF;
 PERFORM 1 FROM public.tax_returns WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 SELECT count(*),count(DISTINCT t.client_id),(array_agg(t.client_id))[1],
  count(*) FILTER(WHERE t.invoice_id IS NOT NULL),count(*) FILTER(WHERE t.status::text='filed'),
  count(*) FILTER(WHERE NOT(public.has_full_module(auth.uid(),'tax') OR
    (public.is_module_assigned_only(auth.uid(),'tax') AND (t.assigned_to=auth.uid() OR EXISTS(
      SELECT 1 FROM public.client_assignments ca WHERE ca.client_id=t.client_id AND ca.user_id=auth.uid())))))
 INTO found_cnt,client_cnt,client_id,invoiced,filed,denied FROM public.tax_returns t WHERE t.id=ANY(ids);
 IF found_cnt<>cnt OR client_cnt<>1 OR invoiced>0 OR filed>0 OR denied>0 THEN RAISE EXCEPTION 'Selected filings are missing, already filed/invoiced, span clients, or are not assigned to you'; END IF;
 IF NOT public.can_access_client(client_id) THEN RAISE EXCEPTION 'Client is paused or inaccessible'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('tax-invoice:'||client_id::text,0));
 SELECT i.id,i.invoice_number,i.memo INTO inv,inv_no,old_memo FROM public.invoices i
 WHERE i.client_id=client_id AND i.status='draft' AND date_trunc('month',i.issue_date)=date_trunc('month',v_today)
 AND EXISTS(SELECT 1 FROM public.tax_returns tr WHERE tr.invoice_id=i.id)
 ORDER BY i.issue_date DESC,i.created_at DESC LIMIT 1;
 IF inv IS NULL THEN
  inv_no:=public.next_invoice_number();
  INSERT INTO public.invoices(invoice_number,client_id,issue_date,due_date,service_line,vat_rate,created_by)
  VALUES(inv_no,client_id,v_today,v_today+7,'Tax',COALESCE(_vat_rate,16),auth.uid()) RETURNING id INTO inv;
  created:=true; pos:=0;
 ELSE
  UPDATE public.invoices SET due_date=GREATEST(due_date,v_today+7) WHERE id=inv;
  SELECT COALESCE(max(sort_order),-1)+1 INTO pos FROM public.invoice_items WHERE invoice_id=inv;
 END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(_items) LOOP
  INSERT INTO public.invoice_items(invoice_id,description,quantity,unit_price,amount,sort_order)
  VALUES(inv,COALESCE(NULLIF(trim(item->>'description'),''),'Tax filing'),1,
   COALESCE((item->>'amount')::numeric,0),COALESCE((item->>'amount')::numeric,0),pos);
  pos:=pos+1;
 END LOOP;
 UPDATE public.tax_returns SET invoice_id=inv WHERE id=ANY(ids);
 IF old_memo IS NULL OR old_memo LIKE 'Tax filings:%' THEN
  SELECT 'Tax filings: '||string_agg(label,', ' ORDER BY ord,label)||' - '||to_char(v_today,'Mon YYYY') INTO memo_text
  FROM(SELECT DISTINCT ON(t.return_type) COALESCE(p.label,t.return_type) label,COALESCE(p.sort_order,999) ord
   FROM public.tax_returns t LEFT JOIN public.tax_policies p ON p.tax_type=t.return_type WHERE t.invoice_id=inv ORDER BY t.return_type) x;
  UPDATE public.invoices SET memo=memo_text WHERE id=inv;
 END IF;
 RETURN jsonb_build_object('invoice_id',inv,'invoice_number',inv_no,'created',created);
END;
$$;
REVOKE ALL ON FUNCTION public.create_tax_filing_invoice(jsonb,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_tax_filing_invoice(jsonb,numeric) TO authenticated;

NOTIFY pgrst,'reload schema';