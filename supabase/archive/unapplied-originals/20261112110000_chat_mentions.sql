-- ============================================================================
-- Chat @mentions
--
-- 1. chat_messages.mentioned_user_ids: who the sender @-mentioned, set by the
--    client when it sends the message (the body also carries the literal
--    "@Full Name" text so the mention still reads correctly for anyone whose
--    client doesn't highlight it).
-- 2. On insert, notify every mentioned user with a dedicated 'chat_mention'
--    notification — distinct from the general 'chat_message' unread badge —
--    so being @-mentioned stands out from an ordinary new message.
--    Only ids that are actually members of the channel (or, for Team Chat,
--    any staff member) are notified: the column is set by the client, so the
--    trigger re-checks membership itself rather than trusting the array.
--    The sender mentioning themselves is a no-op (no self-notification).
-- ============================================================================

alter table public.chat_messages
  add column if not exists mentioned_user_ids uuid[] not null default '{}';

create or replace function public.tg_chat_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text;
  v_channel_kind text;
  v_recipient uuid;
begin
  if new.mentioned_user_ids is null or array_length(new.mentioned_user_ids, 1) is null then
    return new;
  end if;

  select kind into v_channel_kind from public.chat_channels where id = new.channel_id;
  select full_name into v_sender_name from public.profiles where id = new.sender_id;

  foreach v_recipient in array new.mentioned_user_ids loop
    if v_recipient is null or v_recipient = new.sender_id then
      continue;
    end if;
    if not (
      (v_channel_kind = 'team' and public.is_staff(v_recipient))
      or exists (
        select 1 from public.chat_channel_members m
        where m.channel_id = new.channel_id and m.user_id = v_recipient
      )
    ) then
      continue;
    end if;

    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_recipient,
      'chat_mention',
      'You were mentioned in chat',
      coalesce(v_sender_name, 'Someone') || ' mentioned you: ' ||
        left(coalesce(nullif(trim(new.body), ''), 'an attachment'), 140),
      '/chat?channel=' || new.channel_id
    );
  end loop;

  return new;
end;
$$;

revoke all on function public.tg_chat_message_mentions() from anon, public;

drop trigger if exists trg_chat_message_mentions on public.chat_messages;
create trigger trg_chat_message_mentions
  after insert on public.chat_messages
  for each row execute function public.tg_chat_message_mentions();
