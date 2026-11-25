-- Permanent fix for the recurring "new row violates row-level security
-- policy for table chat_channels" error on DM creation.
--
-- Root cause: the client did `.insert(...).select().single()` on
-- chat_channels, then a *separate* insert into chat_channel_members.
-- Postgres enforces that a row returned from INSERT...RETURNING must also
-- satisfy the table's SELECT policy — and the SELECT policy for a dm/group
-- channel depends on a chat_channel_members row existing, which at that
-- point it didn't yet (it's created in the next request). No tweak to the
-- policy's USING/WITH CHECK text fixes this reliably, because the ordering
-- problem is structural, not a logic bug in the policy.
--
-- Fix: do the whole "find or create this DM, and its membership rows" as
-- one atomic operation inside a SECURITY DEFINER function. Definer
-- functions run as the table owner, which bypasses RLS entirely for the
-- statements *inside* the function (Postgres only enforces RLS for the
-- owner if FORCE ROW LEVEL SECURITY is set, which we don't set) — so there
-- is no INSERT/SELECT policy interaction to fight. The function still
-- checks auth.uid() and is_staff() itself, so it isn't a privilege hole.

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

  -- Look for an existing 1:1 DM between exactly these two people.
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
  end if;

  return _channel_id;
end;
$$;

grant execute on function public.get_or_create_dm(uuid) to authenticated;
