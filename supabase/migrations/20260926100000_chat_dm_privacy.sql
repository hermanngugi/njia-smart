-- ============================================================================
-- Chat privacy — direct messages (and groups) visible only to their members
--
-- The original chat table policies were created outside this repo, so this
-- migration replaces only the SELECT policies on the three chat tables with
-- membership-based ones:
--   * Team chat (kind = 'team'): readable by all staff, as before.
--   * DM / group channels: readable only by users with a row in
--     chat_channel_members for that channel. No Director/Admin exception —
--     a DM is only visible to the people in it.
-- Insert/update/delete policies are left untouched.
-- ============================================================================

-- Membership check as a SECURITY DEFINER function so the policies below can
-- consult chat_channel_members without recursing into its own RLS.
create or replace function public.can_read_chat_channel(_channel_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_channels c
    where c.id = _channel_id
      and (
        (c.kind = 'team' and public.is_staff(_user_id))
        or exists (
          select 1 from public.chat_channel_members m
          where m.channel_id = c.id and m.user_id = _user_id
        )
      )
  )
$$;

grant execute on function public.can_read_chat_channel(uuid, uuid) to authenticated;

alter table public.chat_channels enable row level security;
alter table public.chat_channel_members enable row level security;
alter table public.chat_messages enable row level security;

-- Drop every existing SELECT-only policy on the three chat tables.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('chat_channels', 'chat_channel_members', 'chat_messages')
      and cmd = 'SELECT'
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- chat_channels: team channel for staff, DM/group for members only
-- (creator can still read their own row so INSERT ... RETURNING works).
create policy "chat channels select members only" on public.chat_channels
  for select to authenticated
  using (created_by = auth.uid() or public.can_read_chat_channel(id, auth.uid()));

-- chat_channel_members: you can see membership rows of channels you can read
-- (needed to show who's on the other side of a DM).
create policy "chat members select members only" on public.chat_channel_members
  for select to authenticated
  using (user_id = auth.uid() or public.can_read_chat_channel(channel_id, auth.uid()));

-- chat_messages: only messages in channels you can read.
create policy "chat messages select members only" on public.chat_messages
  for select to authenticated
  using (public.can_read_chat_channel(channel_id, auth.uid()));

-- Any leftover FOR ALL policy would still grant read access to everyone.
-- Flag it so it can be tightened by hand.
do $$
declare p record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('chat_channels', 'chat_channel_members', 'chat_messages')
      and cmd = 'ALL'
  loop
    raise warning 'chat privacy: FOR ALL policy "%" on % still grants SELECT — review it', p.policyname, p.tablename;
  end loop;
end $$;
