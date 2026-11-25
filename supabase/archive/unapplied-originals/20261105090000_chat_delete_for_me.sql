-- ============================================================================
-- Chat: "Delete chat" for me (private chats).
--
-- The chat page (src/routes/_authed/chat.tsx) already:
--   * reads chat_channel_members.hidden_at to hide deleted chats from the list
--   * calls public.delete_chat_for_me(_channel_id) from the "Delete chat" button
-- but no migration in this repo created either, so on a database built from
-- these migrations the button fails and the chat list query errors.
--
-- Everything here is idempotent (IF NOT EXISTS / OR REPLACE), so it is safe to
-- run on a database that already has some or all of it.
--
-- Behaviour: deleting a private chat only hides it for the person who deleted
-- it (and hides its older messages). The other person keeps their copy. The
-- chat comes back in the list when anyone writes in it again, or when the
-- person starts the DM again.
-- ============================================================================

alter table public.chat_channel_members
  add column if not exists hidden_at timestamptz;

-- 1. The button's function ---------------------------------------------------
create or replace function public.delete_chat_for_me(_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _me uuid := auth.uid();
  _kind text;
begin
  if _me is null then
    raise exception 'not authenticated';
  end if;

  select c.kind into _kind from public.chat_channels c where c.id = _channel_id;
  if _kind is null then
    raise exception 'chat not found';
  end if;
  if _kind = 'team' then
    raise exception 'the team chat cannot be deleted';
  end if;

  -- Hide the chat and its history for me only. Never creates a membership.
  update public.chat_channel_members
     set hidden_at = now(),
         cleared_at = now()
   where channel_id = _channel_id
     and user_id = _me;

  if not found then
    raise exception 'not a member of this chat';
  end if;
end;
$$;

revoke all on function public.delete_chat_for_me(uuid) from public, anon;
grant execute on function public.delete_chat_for_me(uuid) to authenticated;

-- 2. A new message brings the chat back for everyone who had deleted it ------
create or replace function public.tg_chat_message_unhide()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_channel_members
     set hidden_at = null
   where channel_id = new.channel_id
     and hidden_at is not null;
  return new;
end;
$$;

drop trigger if exists trg_chat_message_unhide on public.chat_messages;
create trigger trg_chat_message_unhide
  after insert on public.chat_messages
  for each row execute function public.tg_chat_message_unhide();

-- 3. Starting the DM again brings it back for me -----------------------------
-- Same function as 20260925210000_chat_dm_rpc.sql plus one UPDATE at the end.
create or replace function public.get_or_create_dm(_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _me uuid := auth.uid();
  _channel_id uuid;
begin
  if _me is null then
    raise exception 'not authenticated';
  end if;
  if _me = _other_user_id then
    raise exception 'cannot start a DM with yourself';
  end if;
  if not public.is_staff(_me) then
    raise exception 'not permitted';
  end if;
  if not public.is_staff(_other_user_id) then
    raise exception 'that user is not staff';
  end if;

  select c.id into _channel_id
  from public.chat_channels c
  where c.kind = 'dm'
    and exists (select 1 from public.chat_channel_members m1 where m1.channel_id = c.id and m1.user_id = _me)
    and exists (select 1 from public.chat_channel_members m2 where m2.channel_id = c.id and m2.user_id = _other_user_id)
    and (select count(*) from public.chat_channel_members m3 where m3.channel_id = c.id) = 2
  limit 1;

  if _channel_id is null then
    insert into public.chat_channels (kind, created_by) values ('dm', _me) returning id into _channel_id;
    insert into public.chat_channel_members (channel_id, user_id) values (_channel_id, _me), (_channel_id, _other_user_id);
  else
    update public.chat_channel_members
       set hidden_at = null
     where channel_id = _channel_id and user_id = _me and hidden_at is not null;
  end if;

  return _channel_id;
end;
$$;

grant execute on function public.get_or_create_dm(uuid) to authenticated;
