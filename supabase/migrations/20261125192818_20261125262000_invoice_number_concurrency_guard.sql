-- Njia Smart repair 24: serialize invoice number allocation to avoid concurrent duplicates.
CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_year text:=to_char((now() AT TIME ZONE 'Africa/Nairobi')::date,'YYYY'); v_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('invoice-number:'||v_year,0));
 SELECT count(*)+1 INTO v_count FROM public.invoices WHERE invoice_number LIKE 'INV-'||v_year||'-%';
 RETURN 'INV-'||v_year||'-'||lpad(v_count::text,4,'0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_invoice_number() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO service_role;