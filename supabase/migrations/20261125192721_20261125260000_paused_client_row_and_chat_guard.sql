-- Njia Smart repair 22: enforce paused-client restrictions on client rows and client chat.
DROP POLICY IF EXISTS clients_paused_access_guard ON public.clients;
CREATE POLICY clients_paused_access_guard ON public.clients AS RESTRICTIVE
FOR ALL TO authenticated
USING(NOT COALESCE(is_paused,false) OR public.is_admin(auth.uid()))
WITH CHECK(NOT COALESCE(is_paused,false) OR public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.can_access_chat_channel(_channel_id uuid,_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.chat_channels c
  WHERE c.id=_channel_id AND public.is_staff(_user_id)
   AND (
    c.kind='team'
    OR (c.kind='client' AND c.client_id IS NOT NULL
      AND (public.is_admin(_user_id) OR EXISTS(SELECT 1 FROM public.clients cl WHERE cl.id=c.client_id AND NOT COALESCE(cl.is_paused,false)))
      AND public.can_access_financials(_user_id))
    OR (c.kind IN ('dm','group') AND EXISTS(
      SELECT 1 FROM public.chat_channel_members m WHERE m.channel_id=c.id AND m.user_id=_user_id))
   )
 );
$$;
CREATE OR REPLACE FUNCTION public.can_read_chat_channel(_channel_id uuid,_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.chat_channels c
  WHERE c.id=_channel_id AND public.is_staff(_user_id)
   AND (
    c.kind='team'
    OR EXISTS(SELECT 1 FROM public.chat_channel_members m WHERE m.channel_id=c.id AND m.user_id=_user_id)
    OR (c.kind='client' AND
      (public.is_admin(_user_id) OR EXISTS(SELECT 1 FROM public.clients cl WHERE cl.id=c.client_id AND NOT COALESCE(cl.is_paused,false)))
      AND (
       public.can_view_module_all(_user_id,'clients')
       OR (public.is_module_assigned_only(_user_id,'clients') AND EXISTS(
        SELECT 1 FROM public.client_assignments ca WHERE ca.client_id=c.client_id AND ca.user_id=_user_id))
      )
    )
   )
 );
$$;
NOTIFY pgrst,'reload schema';