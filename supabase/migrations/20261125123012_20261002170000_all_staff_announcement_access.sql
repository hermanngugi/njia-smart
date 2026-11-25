-- ==========================================================================
-- Announcements: every staff member can view and manage announcements.
--
-- This matches the application requirement that Announcements is a full-access
-- module for every staff role. RLS remains limited to authenticated staff.
-- ============================================================================

drop policy if exists "announcements select staff" on public.announcements;
drop policy if exists "announcements insert admin" on public.announcements;
drop policy if exists "announcements update admin" on public.announcements;
drop policy if exists "announcements delete admin" on public.announcements;

drop policy if exists "announcements select all staff" on public.announcements;
drop policy if exists "announcements insert all staff" on public.announcements;
drop policy if exists "announcements update all staff" on public.announcements;
drop policy if exists "announcements delete all staff" on public.announcements;

create policy "announcements select all staff"
on public.announcements
for select
to authenticated
using (public.is_staff(auth.uid()));

create policy "announcements insert all staff"
on public.announcements
for insert
to authenticated
with check (
  public.is_staff(auth.uid())
  and author_id = auth.uid()
);

create policy "announcements update all staff"
on public.announcements
for update
to authenticated
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

create policy "announcements delete all staff"
on public.announcements
for delete
to authenticated
using (public.is_staff(auth.uid()));

grant select, insert, update, delete on public.announcements to authenticated;
