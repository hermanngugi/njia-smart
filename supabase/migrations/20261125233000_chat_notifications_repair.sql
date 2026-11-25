-- Njia Smart repair 06: chat membership, personal hiding, mentions and notification attribution.
ALTER TABLE public.chat_channel_members ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS mentioned_user_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notifications_unread_by_type_idx ON public.notifications(user_id,type) WHERE read_at IS NULL;

DROP POLICY IF EXISTS "notifications delete own" ON public.notifications;
CREATE POLICY "notifications delete own" ON public.notifications FOR DELETE TO authenticated USING(user_id=auth.uid());

CREATE OR REPLACE FUNCTION public.clear_chat_for_me(_channel_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_me uuid:=auth.uid(); v_kind text;
BEGIN
 IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 SELECT kind INTO v_kind FROM public.chat_channels WHERE id=_channel_id;
 IF v_kind IS NULL THEN RAISE EXCEPTION 'Chat not found'; END IF;
 IF v_kind='team' THEN
  IF NOT public.is_staff(v_me) THEN RAISE EXCEPTION 'Not permitted'; END IF;
  INSERT INTO public.chat_channel_members(channel_id,user_id,cleared_at,hidden_at)
  VALUES(_channel_id,v_me,now(),NULL)
  ON CONFLICT(channel_id,user_id) DO UPDATE SET cleared_at=excluded.cleared_at;
 ELSE
  UPDATE public.chat_channel_members SET cleared_at=now() WHERE channel_id=_channel_id AND user_id=v_me;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not a member of this chat'; END IF;
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_chat_for_me(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.clear_chat_for_me(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_chat_for_me(_channel_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_me uuid:=auth.uid(); v_kind text;
BEGIN
 IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 SELECT kind INTO v_kind FROM public.chat_channels WHERE id=_channel_id;
 IF v_kind IS NULL THEN RAISE EXCEPTION 'Chat not found'; END IF;
 IF v_kind='team' THEN RAISE EXCEPTION 'Team Chat cannot be deleted'; END IF;
 UPDATE public.chat_channel_members SET hidden_at=now(),cleared_at=now()
 WHERE channel_id=_channel_id AND user_id=v_me;
 IF NOT FOUND THEN RAISE EXCEPTION 'Not a member of this chat'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_chat_for_me(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_chat_for_me(uuid) TO authenticated;

-- A message only restores the sender's own hidden DM; it never unhides it for
-- the other participant. Opening/starting the DM restores only the caller's copy.
CREATE OR REPLACE FUNCTION public.tg_chat_message_unhide()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.chat_channel_members SET hidden_at=NULL
 WHERE channel_id=NEW.channel_id AND user_id=NEW.sender_id AND hidden_at IS NOT NULL;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_chat_message_unhide ON public.chat_messages;
CREATE TRIGGER trg_chat_message_unhide AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.tg_chat_message_unhide();

CREATE OR REPLACE FUNCTION public.get_or_create_dm(_other_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_me uuid:=auth.uid(); v_channel uuid;
BEGIN
 IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 IF v_me=_other_user_id THEN RAISE EXCEPTION 'Cannot start a DM with yourself'; END IF;
 IF NOT public.is_staff(v_me) OR NOT public.is_staff(_other_user_id) THEN RAISE EXCEPTION 'Only staff can start direct messages'; END IF;
 SELECT c.id INTO v_channel FROM public.chat_channels c
 WHERE c.kind='dm'
 AND EXISTS(SELECT 1 FROM public.chat_channel_members a WHERE a.channel_id=c.id AND a.user_id=v_me)
 AND EXISTS(SELECT 1 FROM public.chat_channel_members b WHERE b.channel_id=c.id AND b.user_id=_other_user_id)
 AND (SELECT count(*) FROM public.chat_channel_members m WHERE m.channel_id=c.id)=2
 ORDER BY c.created_at LIMIT 1;
 IF v_channel IS NULL THEN
  INSERT INTO public.chat_channels(kind,created_by) VALUES('dm',v_me) RETURNING id INTO v_channel;
  INSERT INTO public.chat_channel_members(channel_id,user_id) VALUES(v_channel,v_me),(v_channel,_other_user_id);
 ELSE
  UPDATE public.chat_channel_members SET hidden_at=NULL WHERE channel_id=v_channel AND user_id=v_me;
 END IF;
 RETURN v_channel;
END;
$$;
REVOKE ALL ON FUNCTION public.get_or_create_dm(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid) TO authenticated;

INSERT INTO public.chat_channel_members(channel_id,user_id)
SELECT c.id,r.user_id FROM public.chat_channels c CROSS JOIN (SELECT DISTINCT user_id FROM public.user_roles) r
WHERE c.kind='team' AND public.is_staff(r.user_id)
ON CONFLICT(channel_id,user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.tg_team_chat_add_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.is_staff(NEW.user_id) THEN
  INSERT INTO public.chat_channel_members(channel_id,user_id)
  SELECT id,NEW.user_id FROM public.chat_channels WHERE kind='team'
  ON CONFLICT(channel_id,user_id) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_team_chat_add_member ON public.user_roles;
CREATE TRIGGER trg_team_chat_add_member AFTER INSERT ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.tg_team_chat_add_member();

CREATE OR REPLACE FUNCTION public.tg_chat_message_mentions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sender text; v_kind text; v_recipient uuid;
BEGIN
 IF NEW.mentioned_user_ids IS NULL OR cardinality(NEW.mentioned_user_ids)=0 THEN RETURN NEW; END IF;
 SELECT kind INTO v_kind FROM public.chat_channels WHERE id=NEW.channel_id;
 SELECT full_name INTO v_sender FROM public.profiles WHERE id=NEW.sender_id;
 FOR v_recipient IN
  SELECT DISTINCT x FROM unnest(NEW.mentioned_user_ids) x
  WHERE x IS NOT NULL AND x<>NEW.sender_id
 LOOP
  IF (v_kind='team' AND public.is_staff(v_recipient))
   OR EXISTS(SELECT 1 FROM public.chat_channel_members m WHERE m.channel_id=NEW.channel_id AND m.user_id=v_recipient) THEN
   INSERT INTO public.notifications(user_id,type,title,body,link,actor_id)
   VALUES(v_recipient,'chat_mention','You were mentioned in chat',
    COALESCE(v_sender,'A colleague')||' mentioned you: '||left(COALESCE(NULLIF(trim(NEW.body),''),'an attachment'),140),
    '/chat?channel='||NEW.channel_id,NEW.sender_id);
  END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_chat_message_mentions() FROM PUBLIC,anon;
DROP TRIGGER IF EXISTS trg_chat_message_mentions ON public.chat_messages;
CREATE TRIGGER trg_chat_message_mentions AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.tg_chat_message_mentions();

NOTIFY pgrst,'reload schema';