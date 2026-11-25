-- ============================================================================
-- Let an Admin/Director delete a staff member (Team page -> Delete).
--
-- Deleting a user (auth.admin.deleteUser) fails with "Database error deleting
-- user" while ANY record still points at them through a foreign key that has
-- no ON DELETE rule - e.g. clients.created_by, tasks.assigned_to,
-- invoices.created_by, documents.uploaded_by, leave_requests.reliever_id.
-- 36 such links exist in this project.
--
-- Fix: for every single-column foreign key to auth.users(id) or profiles(id)
-- that has no ON DELETE rule, change it to
--   * ON DELETE SET NULL  - the record is KEPT, it just no longer names the
--                           deleted person (shows as unassigned / unknown), or
--   * ON DELETE CASCADE   - only for a "user_id" column or a primary-key column
--                           (a row that is nothing without the person).
-- NOT NULL is dropped from the columns that become SET NULL, otherwise the
-- database would still refuse. Nothing else about the tables changes.
--
-- Written as a loop over the live catalog, so it also covers links that were
-- created outside these migration files. Safe to run again: once a key has an
-- ON DELETE rule it is skipped.
-- ============================================================================
do $$
declare
  r        record;
  col      text;
  in_pk    boolean;
  rule     text;
  n_set    int := 0;
  n_casc   int := 0;
begin
  for r in
    select c.conname, c.conrelid, c.conrelid::regclass as tbl,
           c.confrelid::regclass as ref, c.conkey
      from pg_constraint c
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
       and c.confdeltype in ('a', 'r')          -- NO ACTION / RESTRICT
       and cardinality(c.conkey) = 1
  loop
    select a.attname into col
      from pg_attribute a
     where a.attrelid = r.conrelid and a.attnum = r.conkey[1];

    select exists (
      select 1 from pg_constraint p
       where p.conrelid = r.conrelid and p.contype = 'p' and r.conkey[1] = any (p.conkey)
    ) into in_pk;

    rule := case when in_pk or col = 'user_id' then 'cascade' else 'set null' end;

    if rule = 'set null' then
      execute format('alter table %s alter column %I drop not null', r.tbl, col);
      n_set := n_set + 1;
    else
      n_casc := n_casc + 1;
    end if;

    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references %s (id) on delete %s',
      r.tbl, r.conname, col, r.ref, rule
    );
  end loop;

  raise notice 'Staff deletion: % keys set to SET NULL, % to CASCADE', n_set, n_casc;
end $$;
