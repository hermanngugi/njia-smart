-- Njia Smart repair 14: close tax INSERT filing-window gap and exclude paused clients from batch scheduling.
CREATE OR REPLACE FUNCTION public.tg_tax_return_one_filed_per_window()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_window date;
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF NEW.status::text='filed'
  AND (now() AT TIME ZONE 'Africa/Nairobi')::date < public.tax_return_open_date(NEW.return_type::text,NEW.due_date) THEN
  RAISE EXCEPTION 'This filing period has not opened yet';
 END IF;
 IF NOT(NEW.status::text='filed' OR NEW.invoice_id IS NOT NULL) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.status::text=OLD.status::text
  AND NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id
  AND NEW.due_date IS NOT DISTINCT FROM OLD.due_date THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.client_id::text||':'||NEW.return_type::text,0));
 v_window:=public.tax_return_open_date(NEW.return_type::text,NEW.due_date);
 IF v_window IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.tax_returns t WHERE t.client_id=NEW.client_id AND t.return_type=NEW.return_type
   AND t.id<>NEW.id AND public.tax_return_open_date(t.return_type::text,t.due_date)=v_window
   AND (t.status::text='filed' OR t.invoice_id IS NOT NULL)
 ) THEN RAISE EXCEPTION 'This obligation is already filed or invoiced for this filing window'; END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_current_tax_filing_periods()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o record; m date; first_m date; cur_m date:=(date_trunc('month',now() AT TIME ZONE 'Africa/Nairobi'))::date;
 due date; due_day integer; pstart date; pend date; assigned uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_admin(auth.uid()) OR public.has_full_module(auth.uid(),'tax')) THEN
  RAISE EXCEPTION 'Only Director/Admin or full Tax access can prepare filing periods';
 END IF;
 FOR o IN
  SELECT ob.client_id,ob.tax_type
  FROM public.client_tax_obligations ob
  JOIN public.tax_policies tp ON tp.tax_type::text=ob.tax_type::text
  JOIN public.clients c ON c.id=ob.client_id
  WHERE ob.active AND tp.active AND (NOT COALESCE(c.is_paused,false) OR public.is_admin(auth.uid()))
 LOOP
  IF public.tax_return_cadence(o.tax_type::text)<>'monthly' THEN CONTINUE; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(o.client_id::text||':'||o.tax_type::text,0));
  SELECT date_trunc('month',min(due_date))::date INTO first_m
  FROM public.tax_returns WHERE client_id=o.client_id AND return_type::text=o.tax_type::text;
  first_m:=COALESCE(first_m,cur_m); IF first_m>cur_m THEN CONTINUE; END IF;
  SELECT assigned_to INTO assigned FROM public.tax_returns
  WHERE client_id=o.client_id AND return_type::text=o.tax_type::text ORDER BY due_date DESC LIMIT 1;
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
NOTIFY pgrst,'reload schema';