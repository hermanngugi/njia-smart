-- ============================================================================
-- Everyone on the team is a member of the Team Chat
--
-- Team Chat is readable by any staff member, but only people with a row in
-- chat_channel_members have their own personal state there (cleared_at for
-- "Clear chat", last_read_at...). Staff who had never opened it had no row.
--
--   1. Backfill: every current staff member (anyone with a role) becomes a
--      member of the Team Chat.
--   2. From now on, whoever is added to the team (a role is assigned) is added
--      to the Team Chat automatically.
--
-- Idempotent: safe to run more than once. Nothing is removed.
-- ============================================================================

insert into public.chat_channel_members (channel_id, user_id)
select c.id, r.user_id
  from public.chat_channels c
 cross join (select distinct user_id from public.user_roles) r
 where c.kind = 'team'
on conflict (channel_id, user_id) do nothing;

create or replace function public.tg_team_chat_add_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chat_channel_members (channel_id, user_id)
  select c.id, new.user_id
    from public.chat_channels c
   where c.kind = 'team'
  on conflict (channel_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_team_chat_add_member on public.user_roles;
create trigger trg_team_chat_add_member
  after insert on public.user_roles
  for each row execute function public.tg_team_chat_add_member();
