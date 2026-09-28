-- ============================================================================
-- Chat write-side security + attachment privacy
--
-- 1. FIX: 20260926100000_chat_dm_privacy.sql made can_read_chat_channel()
--    understand only 'team' and member-based channels. The per-client chat
--    panel (kind = 'client', no member rows) would have lost access. This
--    restores it: staff who can see that client (same rule as the clients
--    table) can read that client's chat.
-- 2. chat_channel_members: a user can no longer add themselves to a chat they
--    aren't in (DMs/groups). Self-insert/update is allowed only for chats
--    they can already read (which includes the open Team Chat). No client
--    code deletes membership rows, so DELETE is closed.
-- 3. chat_messages: you can only post as yourself, into a chat you can read.
-- 4. chat-attachments storage bucket: private; files can be uploaded and read
--    only by people who can read the chat whose id is the file's first path
--    folder (that's how the app names them: <channel_id>/<timestamp>-<name>).
--
-- Existing SELECT/INSERT/UPDATE/DELETE policies on the tables above (created
-- outside this repo) are replaced; FOR ALL policies can't be split safely, so
-- any left over are reported as warnings for manual review.
-- ============================================================================

-- ---------- 1. can_read_chat_channel: add client chats ----------------------
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
        or (
          c.kind = 'client' and public.is_staff(_user_id) and (
            public.can_view_module_all(_user_id, 'clients')
            or (
              public.is_module_assigned_only(_user_id, 'clients')
              and exists (
                select 1 from public.client_assignments ca
                where ca.client_id = c.client_id and ca.user_id = _user_id
              )
            )
          )
        )
      )
  )
$$;

grant execute on function public.can_read_chat_channel(uuid, uuid) to authenticated;

-- ---------- 2. chat_channel_members write policies --------------------------
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'chat_channel_members'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  loop
    execute format('drop policy %I on public.chat_channel_members', p.policyname);
  end loop;
end $$;

create policy "chat members insert own readable" on public.chat_channel_members
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_read_chat_channel(channel_id, auth.uid()));

create policy "chat members update own readable" on public.chat_channel_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_read_chat_channel(channel_id, auth.uid()));

-- ---------- 3. chat_messages insert policy ----------------------------------
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'chat_messages' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.chat_messages', p.policyname);
  end loop;
end $$;

create policy "chat messages insert as self in readable chat" on public.chat_messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.can_read_chat_channel(channel_id, auth.uid()));

-- ---------- 4. chat-attachments storage -------------------------------------
update storage.buckets set public = false where id = 'chat-attachments';

-- First path folder = channel id. Returns null for anything that isn't a uuid
-- (so a malformed path is simply denied instead of erroring).
create or replace function public.chat_attachment_channel(_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(_name, '/', 1)::uuid
    else null
  end
$$;

grant execute on function public.chat_attachment_channel(text) to authenticated;

do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') ilike '%chat-attachments%' or coalesce(with_check, '') ilike '%chat-attachments%')
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

create policy "chat attachments read if in chat" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-attachments'
         and public.can_read_chat_channel(public.chat_attachment_channel(name), auth.uid()));

create policy "chat attachments upload if in chat" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-attachments'
              and public.can_read_chat_channel(public.chat_attachment_channel(name), auth.uid()));

-- ---------- warnings for anything this migration can't safely rewrite -------
do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('chat_channels', 'chat_channel_members', 'chat_messages')
      and cmd = 'ALL'
  loop
    raise warning 'chat security: FOR ALL policy "%" on % still applies — review it', p.policyname, p.tablename;
  end loop;

  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('SELECT', 'ALL')
      and coalesce(qual, '') not ilike '%bucket_id%'
  loop
    raise warning 'storage: policy "%" on storage.objects has no bucket condition and may expose chat attachments — review it', p.policyname;
  end loop;
end $$;
