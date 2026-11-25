-- Njia Smart repair 12: close exposed SECURITY DEFINER RPCs and mutable search paths.
-- Existing authenticated application helpers remain callable; anonymous access is removed.
DROP FUNCTION IF EXISTS public.request_leave(uuid,date,date,text);

DO $$
DECLARE r record;
BEGIN
 FOR r IN
  SELECT p.oid::regprocedure AS signature,p.prorettype::regtype::text AS result_type
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
 LOOP
  EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon',r.signature);
  IF r.result_type<>'event_trigger' THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',r.signature);
  END IF;
 END LOOP;
END $$;

ALTER FUNCTION public.chat_attachment_channel(text) SET search_path=public;
ALTER FUNCTION public.next_tax_due_date(text,date) SET search_path=public;
ALTER FUNCTION public.normalize_service_line(text) SET search_path=public;
ALTER FUNCTION public.set_record_audit() SET search_path=public;
ALTER FUNCTION public.tax_return_cadence(text) SET search_path=public;
ALTER FUNCTION public.tax_return_due_day(text) SET search_path=public;
ALTER FUNCTION public.tg_ict_ticket_number() SET search_path=public;
ALTER FUNCTION public.tg_invoices_normalize_service_line() SET search_path=public;
NOTIFY pgrst,'reload schema';