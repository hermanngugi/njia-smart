-- Fix "not a member of this chat" when clearing the shared Team Chat.
-- Team chat is readable by staff without requiring a membership row, but the
-- original clear_chat_for_me() function only updated an existing membership.
-- Create the caller's personal state row for Team Chat; private chats still
-- require an existing membership and cannot be joined through this function.

create or replace function public.clear_chat_for_me(_channel_id uuid)
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

  select c.kind into _kind
  from public.chat_channels c
  where c.id = _channel_id;

  if _kind is null then
    raise exception 'chat not found';
  end if;

  if _kind = 'team' then
    if not public.is_staff(_me) then
      raise exception 'not permitted';
    end if;

    insert into public.chat_channel_members (channel_id, user_id, cleared_at)
    values (_channel_id, _me, now())
    on conflict (channel_id, user_id)
    do update set cleared_at = excluded.cleared_at;
  else
    -- For private chats, clearing must never grant membership.
    update public.chat_channel_members
       set cleared_at = now()
     where channel_id = _channel_id
       and user_id = _me;

    if not found then
      raise exception 'not a member of this chat';
    end if;
  end if;
end;
$$;

grant execute on function public.clear_chat_for_me(uuid) to authenticated;
