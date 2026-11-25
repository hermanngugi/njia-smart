-- ============================================================================
-- Fix: a staff member with a role assigned but no public.profiles row gets
-- stuck on "Loading…" forever on the Settings page (and anywhere else that
-- reads their own profile) — profiles.select("*") returns no row, profile
-- never gets set, and the page has nothing else to show.
--
-- This shouldn't happen (handle_new_user() creates the row on signup), but
-- an account created before that trigger existed, or any other edge case
-- that slipped past it, is left stranded with no way to self-heal, since
-- profiles has no INSERT policy for a user to create their own row.
--
-- 1. Backfill: create the missing profiles row for every current auth user
--    who doesn't have one. Idempotent — only inserts where none exists.
-- 2. Add a narrow INSERT policy so this can't happen again even if some
--    future account creation path skips the trigger: a user may insert
--    their own profile row (id = auth.uid()), nothing else.
-- ============================================================================

insert into public.profiles (id, full_name)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', u.email)
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles insert self'
  ) then
    create policy "profiles insert self" on public.profiles
      for insert to authenticated
      with check (id = auth.uid());
  end if;
end $$;
