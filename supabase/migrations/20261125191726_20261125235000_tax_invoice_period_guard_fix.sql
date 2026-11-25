-- Njia Smart repair 08: close tax period window edge cases and remove PL/pgSQL name ambiguity.
CREATE OR REPLACE FUNCTION public.tg_tax_return_one_filed_per_window()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_window date;
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
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
DROP TRIGGER IF EXISTS trg_tax_return_one_filed_per_window ON public.tax_returns;
CREATE TRIGGER trg_tax_return_one_filed_per_window
BEFORE INSERT OR UPDATE OF status,invoice_id,due_date ON public.tax_returns
FOR EACH ROW EXECUTE FUNCTION public.tg_tax_return_one_filed_per_window();

CREATE OR REPLACE FUNCTION public.create_tax_filing_invoice(_items jsonb,_vat_rate numeric DEFAULT 16)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
 v_ids uuid[]; v_cnt integer; v_total numeric; v_neg integer;
 v_found integer; v_clients integer; v_client_id uuid; v_invoiced integer; v_filed integer; v_denied integer;
 v_inv uuid; v_number text; v_created boolean:=false; v_item jsonb; v_pos integer;
 v_memo text; v_old_memo text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _items IS NULL OR jsonb_typeof(_items)<>'array' OR jsonb_array_length(_items)=0 THEN RAISE EXCEPTION 'Select at least one filing'; END IF;
 SELECT array_agg((e->>'return_id')::uuid),count(*),COALESCE(sum(COALESCE((e->>'amount')::numeric,0)),0),
  count(*) FILTER(WHERE COALESCE((e->>'amount')::numeric,0)<0)
 INTO v_ids,v_cnt,v_total,v_neg FROM jsonb_array_elements(_items) e;
 IF v_neg>0 OR v_total<=0 THEN RAISE EXCEPTION 'Invoice amounts must be non-negative and total more than zero'; END IF;
 IF (SELECT count(DISTINCT x) FROM unnest(v_ids) x)<>v_cnt THEN RAISE EXCEPTION 'Duplicate filing selected'; END IF;
 PERFORM 1 FROM public.tax_returns WHERE id=ANY(v_ids) ORDER BY id FOR UPDATE;
 SELECT count(*),count(DISTINCT t.client_id),(array_agg(t.client_id))[1],
  count(*) FILTER(WHERE t.invoice_id IS NOT NULL),count(*) FILTER(WHERE t.status::text='filed'),
  count(*) FILTER(WHERE NOT(public.has_full_module(auth.uid(),'tax') OR
   (public.is_module_assigned_only(auth.uid(),'tax') AND (t.assigned_to=auth.uid() OR EXISTS(
    SELECT 1 FROM public.client_assignments ca WHERE ca.client_id=t.client_id AND ca.user_id=auth.uid())))))
 INTO v_found,v_clients,v_client_id,v_invoiced,v_filed,v_denied FROM public.tax_returns t WHERE t.id=ANY(v_ids);
 IF v_found<>v_cnt OR v_clients<>1 OR v_invoiced>0 OR v_filed>0 OR v_denied>0 THEN
  RAISE EXCEPTION 'Selected filings are missing, already filed/invoiced, span clients, or are not assigned to you';
 END IF;
 IF NOT public.can_access_client(v_client_id) THEN RAISE EXCEPTION 'Client is paused or inaccessible'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('tax-invoice:'||v_client_id::text,0));
 SELECT i.id,i.invoice_number,i.memo INTO v_inv,v_number,v_old_memo FROM public.invoices i
 WHERE i.client_id=v_client_id AND i.status='draft'
  AND date_trunc('month',i.issue_date)=date_trunc('month',v_today)
  AND EXISTS(SELECT 1 FROM public.tax_returns tr WHERE tr.invoice_id=i.id)
 ORDER BY i.issue_date DESC,i.created_at DESC LIMIT 1;
 IF v_inv IS NULL THEN
  v_number:=public.next_invoice_number();
  INSERT INTO public.invoices(invoice_number,client_id,issue_date,due_date,service_line,vat_rate,created_by)
  VALUES(v_number,v_client_id,v_today,v_today+7,'Tax',COALESCE(_vat_rate,16),auth.uid()) RETURNING id INTO v_inv;
  v_created:=true; v_pos:=0;
 ELSE
  UPDATE public.invoices SET due_date=GREATEST(due_date,v_today+7) WHERE id=v_inv;
  SELECT COALESCE(max(sort_order),-1)+1 INTO v_pos FROM public.invoice_items WHERE invoice_id=v_inv;
 END IF;
 FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
  INSERT INTO public.invoice_items(invoice_id,description,quantity,unit_price,amount,sort_order)
  VALUES(v_inv,COALESCE(NULLIF(trim(v_item->>'description'),''),'Tax filing'),1,
   COALESCE((v_item->>'amount')::numeric,0),COALESCE((v_item->>'amount')::numeric,0),v_pos);
  v_pos:=v_pos+1;
 END LOOP;
 UPDATE public.tax_returns SET invoice_id=v_inv WHERE id=ANY(v_ids);
 IF v_old_memo IS NULL OR v_old_memo LIKE 'Tax filings:%' THEN
  SELECT 'Tax filings: '||string_agg(label,', ' ORDER BY ord,label)||' - '||to_char(v_today,'Mon YYYY') INTO v_memo
  FROM(SELECT DISTINCT ON(t.return_type) COALESCE(p.label,t.return_type) label,COALESCE(p.sort_order,999) ord
   FROM public.tax_returns t LEFT JOIN public.tax_policies p ON p.tax_type=t.return_type
   WHERE t.invoice_id=v_inv ORDER BY t.return_type) x;
  UPDATE public.invoices SET memo=v_memo WHERE id=v_inv;
 END IF;
 RETURN jsonb_build_object('invoice_id',v_inv,'invoice_number',v_number,'created',v_created);
END;
$$;
REVOKE ALL ON FUNCTION public.create_tax_filing_invoice(jsonb,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_tax_filing_invoice(jsonb,numeric) TO authenticated;
NOTIFY pgrst,'reload schema';