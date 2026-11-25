-- Fix explicit trigger return semantics for staff membership synchronization.
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
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_sync_chat_staff_membership() FROM PUBLIC,anon,authenticated;