-- ============================================================================
-- 1. Every user is detected as staff in chat (now and in future)
--
-- Chat lists people from `profiles`, and a DM can only be started with someone
-- who is_staff() (i.e. has a row in user_roles). Users created straight in the
-- Supabase dashboard got a profile but no role (or, for older accounts, no
-- profile at all), so they were missing from chat.
--
--   a) Backfill a profile for any auth user that doesn't have one.
--   b) handle_new_user now also gives every new user a default staff role
--      ('intern', the least-privileged one). The first user is still the
--      director. The in-app "add staff" flow replaces the default with the
--      chosen role (see src/lib/admin.functions.ts).
--
-- NOTE: keep "Allow new users to sign up" switched OFF in Supabase
-- (Authentication > Providers > Email), otherwise anyone who registers would
-- become staff. The app has no sign-up screen, so staff are added by admins.
--
-- Existing accounts that already have a profile but NO role are deliberately
-- not auto-promoted (they may have been deactivated on purpose). Give them a
-- role from the Team page, or run for a specific person:
--   insert into public.user_roles (user_id, role) values ('<user uuid>', 'intern');
-- ============================================================================

insert into public.profiles (id, full_name)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', u.email)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare _count int;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;

  select count(*) into _count from public.user_roles;
  if _count = 0 then
    insert into public.user_roles (user_id, role) values (new.id, 'director') on conflict do nothing;
  else
    insert into public.user_roles (user_id, role) values (new.id, 'intern') on conflict do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ============================================================================
-- 2. Delete a message for yourself / clear a chat for yourself
--
-- Both are personal: they hide things from the caller's own view only, the
-- other person's chat is untouched.
--   * chat_channel_members.cleared_at  — messages older than this are hidden
--   * chat_message_hides               — individual messages hidden by a user
-- Both are written through SECURITY DEFINER functions that check membership.
-- ============================================================================

alter table public.chat_channel_members
  add column if not exists cleared_at timestamptz;

create table if not exists public.chat_message_hides (
  user_id    uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

alter table public.chat_message_hides enable row level security;

drop policy if exists "chat hides select own" on public.chat_message_hides;
create policy "chat hides select own" on public.chat_message_hides
  for select to authenticated using (user_id = auth.uid());

grant select on public.chat_message_hides to authenticated;
grant all on public.chat_message_hides to service_role;

create or replace function public.clear_chat_for_me(_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.chat_channel_members
     set cleared_at = now()
   where channel_id = _channel_id and user_id = auth.uid();
  if not found then raise exception 'not a member of this chat'; end if;
end;
$$;

create or replace function public.hide_chat_message_for_me(_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _channel uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select channel_id into _channel from public.chat_messages where id = _message_id;
  if _channel is null or not public.can_read_chat_channel(_channel, auth.uid()) then
    raise exception 'not permitted';
  end if;
  insert into public.chat_message_hides (user_id, message_id)
  values (auth.uid(), _message_id) on conflict do nothing;
end;
$$;

grant execute on function public.clear_chat_for_me(uuid) to authenticated;
grant execute on function public.hide_chat_message_for_me(uuid) to authenticated;
