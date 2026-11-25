-- Njia Smart repair 21: restrict internal SECURITY DEFINER helpers and portal password administration.
REVOKE EXECUTE ON FUNCTION public.next_invoice_number() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_invoice(uuid) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_ict_ticket_controls(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.push_deadline_notification(uuid,text,uuid,text,date,text,date) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.send_deadline_reminders() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_invoice(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.seed_ict_ticket_controls(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_deadline_notification(uuid,text,uuid,text,date,text,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.send_deadline_reminders() TO service_role;

CREATE OR REPLACE FUNCTION public.set_client_portal_password(_client_id uuid,_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT (
  public.is_admin(auth.uid())
  OR public.has_full_module(auth.uid(),'clients')
  OR (public.is_module_assigned_only(auth.uid(),'clients') AND EXISTS(
    SELECT 1 FROM public.client_assignments ca WHERE ca.client_id=_client_id AND ca.user_id=auth.uid()
  ))
 ) THEN RAISE EXCEPTION 'Not authorised to manage this client portal password'; END IF;
 IF NOT public.can_access_client(_client_id) THEN RAISE EXCEPTION 'Client is paused or inaccessible'; END IF;
 UPDATE public.clients
 SET portal_password_hash=CASE WHEN _password IS NULL OR length(_password)=0 THEN NULL
   ELSE extensions.crypt(_password,extensions.gen_salt('bf')) END,
   portal_password_updated_at=now(),portal_password_updated_by=auth.uid()
 WHERE id=_client_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_client_portal_password(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_client_portal_password(uuid,text) TO authenticated;
