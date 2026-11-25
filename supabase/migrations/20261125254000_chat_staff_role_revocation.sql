-- Njia Smart repair 18: remove chat access when a user's final staff role is revoked.
CREATE OR REPLACE FUNCTION public.can_access_chat_channel(_channel_id uuid,_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.chat_channels c
  WHERE c.id=_channel_id AND public.is_staff(_user_id)
   AND (
    c.kind='team'
    OR (c.kind='client' AND c.client_id IS NOT NULL AND public.can_access_financials(_user_id))
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
    OR (c.kind='client' AND (
      public.can_view_module_all(_user_id,'clients')
      OR (public.is_module_assigned_only(_user_id,'clients') AND EXISTS(
        SELECT 1 FROM public.client_assignments ca WHERE ca.client_id=c.client_id AND ca.user_id=_user_id))
    ))
   )
 );
$$;

CREATE OR REPLACE FUNCTION public.tg_sync_chat_staff_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old_user uuid; v_new_user uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN v_old_user:=OLD.user_id; END IF;
 IF TG_OP<>'DELETE' THEN v_new_user:=NEW.user_id; END IF;
 IF v_old_user IS NOT NULL AND NOT public.is_staff(v_old_user) THEN
  DELETE FROM public.chat_channel_members WHERE user_id=v_old_user;
 END IF;
 IF v_new_user IS NOT NULL AND public.is_staff(v_new_user) THEN
  INSERT INTO public.chat_channel_members(channel_id,user_id)
  SELECT id,v_new_user FROM public.chat_channels WHERE kind='team'
  ON CONFLICT(channel_id,user_id) DO NOTHING;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_sync_chat_staff_membership() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_team_chat_add_member ON public.user_roles;
DROP TRIGGER IF EXISTS trg_sync_chat_staff_membership ON public.user_roles;
CREATE TRIGGER trg_sync_chat_staff_membership
AFTER INSERT OR UPDATE OF user_id,role OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_chat_staff_membership();

-- Remove any stale memberships left by users who no longer have a staff role.
DELETE FROM public.chat_channel_members m
WHERE NOT public.is_staff(m.user_id);
NOTIFY pgrst,'reload schema';