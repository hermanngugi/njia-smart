-- ============================================================
-- Module-level RBAC + ownership-gated delete
-- Mirrors src/lib/permissions.ts. Keep the two in sync if the
-- role/module map ever changes.
--
-- Rank scale (matches permissions.ts RANK): none=0, assigned=1, view=2, full=3
--   0 none     -> no visibility at all (row is not returned)
--   1 assigned -> sees/uses only records assigned to them
--   2 view     -> read-only, sees everything in the module
--   3 full     -> full read/write; delete still requires ownership
--                 (see can_delete_record below) unless director/admin
-- ============================================================

-- ---------- Ownership columns the four target tables were missing ----------
alter table public.engagements
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists assigned_to uuid references auth.users(id);

alter table public.tax_returns
  add column if not exists created_by uuid references auth.users(id);

-- clients.created_by and tasks.{created_by,assigned_to} already existed.

-- ---------- Central rank function (single source of truth in SQL) ----------
create or replace function public.get_module_rank(_user_id uuid, _module text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(rank), 0) from (
    select case
      -- Tasks are personal by default: only Director/Admin see every task.
      -- Everyone else is capped at "assigned" (own tasks only), regardless
      -- of what access they'd otherwise have via the branches below.
      when _module = 'tasks' and ur.role in ('director', 'admin') then 3
      when _module = 'tasks' then 1

      -- 1. Director / Admin: full everywhere
      when ur.role in ('director', 'admin') then 3

      -- 2. Audit manager & Tax consultant
      when ur.role in ('audit_manager', 'tax_consultant') and _module in
        ('clients','audit','tax','tasks','documents','calendar','hr','settings','announcements','notifications','dashboard') then 3
      when ur.role in ('audit_manager', 'tax_consultant') and _module in
        ('outsourced_accounting','payroll_management','financial_business_management','advisory') then 2

      -- 3. Advisory officer
      when ur.role = 'advisory_officer' and _module in
        ('advisory','outsourced_accounting','payroll_management','financial_business_management','announcements','notifications','dashboard') then 3
      when ur.role = 'advisory_officer' and _module in
        ('clients','audit','tax','tasks','documents','calendar','hr','settings') then 2

      -- 4. Accountant: full except ICT (view)
      when ur.role = 'accountant' and _module = 'ict' then 2
      when ur.role = 'accountant' then 3

      -- 5. Assistants & interns: full on hr/tasks/settings, assigned elsewhere
      when ur.role in ('accounts_assistant','tax_assistant','audit_assistant','intern') and _module in
        ('hr','tasks','settings','announcements','notifications','dashboard') then 3
      when ur.role in ('accounts_assistant','tax_assistant','audit_assistant','intern') then 1

      -- 7. Marketing: view only, narrow set
      when ur.role = 'marketing' and _module in ('announcements','notifications','dashboard') then 3
      when ur.role = 'marketing' and _module in ('clients','documents','tasks','calendar','settings','advisory') then 2

      -- 8. Internal admin: view only, narrower still
      when ur.role = 'internal_admin' and _module in ('announcements','notifications','dashboard') then 3
      when ur.role = 'internal_admin' and _module in ('tasks','calendar','settings') then 2

      else 0
    end as rank
    from public.user_roles ur
    where ur.user_id = _user_id
  ) ranked
$$;

comment on function public.get_module_rank is
  'Highest access rank (0 none / 1 assigned / 2 view / 3 full) the user holds for a module, across all their roles. Mirrors src/lib/permissions.ts.';

create or replace function public.can_view_module(_user_id uuid, _module text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.get_module_rank(_user_id, _module) >= 1
$$;

create or replace function public.has_full_module(_user_id uuid, _module text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.get_module_rank(_user_id, _module) = 3
$$;

create or replace function public.can_view_module_all(_user_id uuid, _module text)
returns boolean language sql stable security definer set search_path = public as $$
  -- "view" or "full": sees every row in the module, not just assigned ones
  select public.get_module_rank(_user_id, _module) >= 2
$$;

create or replace function public.is_module_assigned_only(_user_id uuid, _module text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.get_module_rank(_user_id, _module) = 1
$$;

-- Ownership-gated delete: creator or director/admin only. A NULL created_by
-- (legacy rows predating this migration) can only be cleared up by an admin.
create or replace function public.can_delete_record(_user_id uuid, _module text, _created_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin(_user_id)
    or (public.has_full_module(_user_id, _module) and _created_by is not null and _created_by = _user_id)
$$;

-- ---------- CLIENTS ----------
drop policy if exists "clients select staff" on public.clients;
drop policy if exists "clients insert staff" on public.clients;
drop policy if exists "clients update staff" on public.clients;
drop policy if exists "clients delete admin" on public.clients;

drop policy if exists "clients select by rank" on public.clients;
create policy "clients select by rank" on public.clients
  for select to authenticated using (
    public.can_view_module_all(auth.uid(), 'clients')
    or (
      public.is_module_assigned_only(auth.uid(), 'clients')
      and exists (
        select 1 from public.client_assignments ca
        where ca.client_id = clients.id and ca.user_id = auth.uid()
      )
    )
  );

drop policy if exists "clients insert full only" on public.clients;
create policy "clients insert full only" on public.clients
  for insert to authenticated with check (public.has_full_module(auth.uid(), 'clients'));

drop policy if exists "clients update by rank" on public.clients;
create policy "clients update by rank" on public.clients
  for update to authenticated using (
    public.has_full_module(auth.uid(), 'clients')
    or (
      public.is_module_assigned_only(auth.uid(), 'clients')
      and exists (
        select 1 from public.client_assignments ca
        where ca.client_id = clients.id and ca.user_id = auth.uid()
      )
    )
  );

drop policy if exists "clients delete owner or admin" on public.clients;
create policy "clients delete owner or admin" on public.clients
  for delete to authenticated using (public.can_delete_record(auth.uid(), 'clients', created_by));

-- ---------- AUDIT (engagements, workpapers, review notes) ----------
drop policy if exists "engagements all staff" on public.engagements;

drop policy if exists "engagements select by rank" on public.engagements;
create policy "engagements select by rank" on public.engagements
  for select to authenticated using (
    public.can_view_module_all(auth.uid(), 'audit')
    or (
      public.is_module_assigned_only(auth.uid(), 'audit')
      and (
        engagements.assigned_to = auth.uid()
        or exists (
          select 1 from public.client_assignments ca
          where ca.client_id = engagements.client_id and ca.user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "engagements insert full only" on public.engagements;
create policy "engagements insert full only" on public.engagements
  for insert to authenticated with check (public.has_full_module(auth.uid(), 'audit'));

drop policy if exists "engagements update by rank" on public.engagements;
create policy "engagements update by rank" on public.engagements
  for update to authenticated using (
    public.has_full_module(auth.uid(), 'audit')
    or (
      public.is_module_assigned_only(auth.uid(), 'audit')
      and (
        engagements.assigned_to = auth.uid()
        or exists (
          select 1 from public.client_assignments ca
          where ca.client_id = engagements.client_id and ca.user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "engagements delete owner or admin" on public.engagements;
create policy "engagements delete owner or admin" on public.engagements
  for delete to authenticated using (public.can_delete_record(auth.uid(), 'audit', created_by));

drop policy if exists "workpapers all staff" on public.audit_workpapers;
drop policy if exists "workpapers by parent engagement" on public.audit_workpapers;
create policy "workpapers by parent engagement" on public.audit_workpapers
  for all to authenticated using (
    exists (
      select 1 from public.engagements e
      where e.id = audit_workpapers.engagement_id
        and (
          public.can_view_module_all(auth.uid(), 'audit')
          or (
            public.is_module_assigned_only(auth.uid(), 'audit')
            and (
              e.assigned_to = auth.uid()
              or exists (select 1 from public.client_assignments ca where ca.client_id = e.client_id and ca.user_id = auth.uid())
            )
          )
        )
    )
  ) with check (public.can_view_module(auth.uid(), 'audit'));

drop policy if exists "review notes all staff" on public.audit_review_notes;
drop policy if exists "review notes by parent engagement" on public.audit_review_notes;
create policy "review notes by parent engagement" on public.audit_review_notes
  for all to authenticated using (
    exists (
      select 1 from public.engagements e
      where e.id = audit_review_notes.engagement_id
        and (
          public.can_view_module_all(auth.uid(), 'audit')
          or (
            public.is_module_assigned_only(auth.uid(), 'audit')
            and (
              e.assigned_to = auth.uid()
              or exists (select 1 from public.client_assignments ca where ca.client_id = e.client_id and ca.user_id = auth.uid())
            )
          )
        )
    )
  ) with check (public.can_view_module(auth.uid(), 'audit'));

-- ---------- TAX (tax_returns) ----------
drop policy if exists "tax returns all staff" on public.tax_returns;

drop policy if exists "tax returns select by rank" on public.tax_returns;
create policy "tax returns select by rank" on public.tax_returns
  for select to authenticated using (
    public.can_view_module_all(auth.uid(), 'tax')
    or (
      public.is_module_assigned_only(auth.uid(), 'tax')
      and (
        tax_returns.assigned_to = auth.uid()
        or exists (
          select 1 from public.client_assignments ca
          where ca.client_id = tax_returns.client_id and ca.user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "tax returns insert full only" on public.tax_returns;
create policy "tax returns insert full only" on public.tax_returns
  for insert to authenticated with check (public.has_full_module(auth.uid(), 'tax'));

drop policy if exists "tax returns update by rank" on public.tax_returns;
create policy "tax returns update by rank" on public.tax_returns
  for update to authenticated using (
    public.has_full_module(auth.uid(), 'tax')
    or (
      public.is_module_assigned_only(auth.uid(), 'tax')
      and (
        tax_returns.assigned_to = auth.uid()
        or exists (
          select 1 from public.client_assignments ca
          where ca.client_id = tax_returns.client_id and ca.user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "tax returns delete owner or admin" on public.tax_returns;
create policy "tax returns delete owner or admin" on public.tax_returns
  for delete to authenticated using (public.can_delete_record(auth.uid(), 'tax', created_by));

-- ---------- TASKS ----------
-- Tasks are personal by default (see get_module_rank): only Director/Admin
-- (rank 3) see every task; everyone else (rank 1, "assigned") only sees,
-- edits, and creates within their own tasks.
drop policy if exists "tasks all staff" on public.tasks;

drop policy if exists "tasks select by rank" on public.tasks;
create policy "tasks select by rank" on public.tasks
  for select to authenticated using (
    public.has_full_module(auth.uid(), 'tasks')
    or tasks.assigned_to = auth.uid()
    or tasks.created_by = auth.uid()
  );

drop policy if exists "tasks insert full only" on public.tasks;
create policy "tasks insert full only" on public.tasks
  for insert to authenticated with check (public.can_view_module(auth.uid(), 'tasks'));

drop policy if exists "tasks update by rank" on public.tasks;
create policy "tasks update by rank" on public.tasks
  for update to authenticated using (
    public.has_full_module(auth.uid(), 'tasks')
    or tasks.assigned_to = auth.uid()
    or tasks.created_by = auth.uid()
  );

drop policy if exists "tasks delete owner or admin" on public.tasks;
create policy "tasks delete owner or admin" on public.tasks
  for delete to authenticated using (
    public.is_admin(auth.uid()) or tasks.created_by = auth.uid()
  );

drop policy if exists "task comments all staff" on public.task_comments;
drop policy if exists "task comments by parent task" on public.task_comments;
create policy "task comments by parent task" on public.task_comments
  for all to authenticated using (
    exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and (
          public.has_full_module(auth.uid(), 'tasks')
          or t.assigned_to = auth.uid()
          or t.created_by = auth.uid()
        )
    )
  ) with check (public.can_view_module(auth.uid(), 'tasks'));
