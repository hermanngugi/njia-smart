-- ============================================================================
-- ICT Service Desk — ICT team (Amos & Herman) get instant notice + full ticket
-- access
--
-- 1. ict_service_desk_team: the people who work the service desk. Seeded with
--    Amos and Herman (matched by name in profiles — CHECK the seeded rows
--    below). To add someone later:
--      insert into public.ict_service_desk_team (user_id) values ('<uuid>');
-- 2. ICT team members can read and update ALL tickets (before this they only
--    had "own tickets" access like every other staff member, so they couldn't
--    see what others raised). Deleting tickets and the Assets inventory stay
--    Director/Admin only.
-- 3. Notifications (the bell, updated in real time):
--      * new ticket raised  -> every ICT team member (critical ones flagged)
--      * ticket assigned    -> the person it was assigned to
-- ============================================================================

create table if not exists public.ict_service_desk_team (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.ict_service_desk_team enable row level security;

drop policy if exists "ict team select staff" on public.ict_service_desk_team;
create policy "ict team select staff" on public.ict_service_desk_team
  for select to authenticated using (public.is_staff(auth.uid()));

drop policy if exists "ict team manage full module" on public.ict_service_desk_team;
create policy "ict team manage full module" on public.ict_service_desk_team
  for all to authenticated
  using (public.has_full_module(auth.uid(), 'ict_service_desk'))
  with check (public.has_full_module(auth.uid(), 'ict_service_desk'));

grant select, insert, update, delete on public.ict_service_desk_team to authenticated;
grant all on public.ict_service_desk_team to service_role;

-- Seed Amos and Herman (verify the result: select * from ict_service_desk_team;)
insert into public.ict_service_desk_team (user_id)
select p.id from public.profiles p
where lower(coalesce(p.full_name, '')) like '%amos%'
   or lower(coalesce(p.full_name, '')) like '%herman%'
on conflict do nothing;

create or replace function public.is_ict_team(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.ict_service_desk_team where user_id = _user_id)
$$;

grant execute on function public.is_ict_team(uuid) to authenticated;

-- ---------- ticket policies: ICT team can read + update every ticket --------
drop policy if exists "ict tickets select own or full module" on public.ict_tickets;
create policy "ict tickets select own or full module" on public.ict_tickets
  for select to authenticated
  using (
    reported_by = auth.uid()
    or public.can_view_module_all(auth.uid(), 'ict_service_desk')
    or public.is_ict_team(auth.uid())
  );

drop policy if exists "ict tickets update full module only" on public.ict_tickets;
create policy "ict tickets update full module only" on public.ict_tickets
  for update to authenticated
  using (public.has_full_module(auth.uid(), 'ict_service_desk') or public.is_ict_team(auth.uid()))
  with check (public.has_full_module(auth.uid(), 'ict_service_desk') or public.is_ict_team(auth.uid()));

-- ---------- notifications ---------------------------------------------------
create or replace function public.notify_ict_new_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _reporter text;
  _critical boolean := coalesce(new.priority, '') = 'Critical';
begin
  select coalesce(full_name, 'Someone') into _reporter from public.profiles where id = new.reported_by;

  insert into public.notifications (user_id, type, title, body, link)
  select t.user_id,
         'ict_ticket',
         case when _critical then 'CRITICAL ICT ticket ' else 'New ICT ticket ' end || coalesce(new.ticket_number, ''),
         new.title || ' — ' || coalesce(new.priority, 'no priority') || ' — raised by ' || coalesce(_reporter, 'a colleague'),
         '/ict-service-desk'
  from public.ict_service_desk_team t
  where t.user_id <> new.reported_by;

  return new;
end;
$$;

drop trigger if exists trg_ict_tickets_notify_new on public.ict_tickets;
create trigger trg_ict_tickets_notify_new
  after insert on public.ict_tickets
  for each row execute function public.notify_ict_new_ticket();

create or replace function public.notify_ict_ticket_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is not null
     and new.assigned_to is distinct from old.assigned_to
     and new.assigned_to <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) then
    insert into public.notifications (user_id, type, title, body, link)
    values (new.assigned_to, 'ict_ticket_assigned',
            'ICT ticket assigned to you ' || coalesce(new.ticket_number, ''),
            new.title || ' — ' || coalesce(new.priority, 'no priority'),
            '/ict-service-desk');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ict_tickets_notify_assigned on public.ict_tickets;
create trigger trg_ict_tickets_notify_assigned
  after update of assigned_to on public.ict_tickets
  for each row execute function public.notify_ict_ticket_assigned();

-- ---------- realtime (so the dashboard card and bell update instantly) -------
do $$
begin
  begin alter publication supabase_realtime add table public.ict_tickets; exception when others then null; end;
  begin alter publication supabase_realtime add table public.notifications; exception when others then null; end;
end $$;
