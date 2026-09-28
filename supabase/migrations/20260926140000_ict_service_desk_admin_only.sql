-- ============================================================================
-- ICT Service Desk — Admin-only oversight, ticket assignment at creation
--
-- 1. Full rank (all tickets, assets, delete, manage team) on 'ict_service_desk'
--    now belongs to the 'admin' role ONLY. The 'director' role is treated like
--    any other staff member for this module: rank 1 (raise and see their own
--    tickets). Every other module is unchanged — Director still has full
--    access everywhere else.
--    This is a full replacement of get_module_rank from
--    20260926070000_ict_service_desk_open_access.sql, with the two
--    ict_service_desk clauses moved ABOVE the Director/Admin catch-all.
--
-- 2. When a ticket is raised with a specific ICT person chosen, that person
--    is notified as "assigned to you"; the rest of the ICT team still get the
--    normal "new ticket" notice.
-- ============================================================================

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
      when _module = 'tasks' and ur.role in ('director', 'admin') then 3
      when _module = 'tasks' then 1

      -- ICT Service Desk: Admin only gets full; everyone else (Director
      -- included) is "assigned" — own tickets. Must sit above the catch-all.
      when _module = 'ict_service_desk' and ur.role = 'admin' then 3
      when _module = 'ict_service_desk' then 1

      -- 1. Director / Admin: full everywhere else
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

      -- 4. Accountant: full except ICT projects (view)
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

-- ---------- new-ticket notification: tell the chosen assignee directly -------
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
         case
           when t.user_id = new.assigned_to and _critical then 'CRITICAL ICT ticket assigned to you '
           when t.user_id = new.assigned_to then 'New ICT ticket assigned to you '
           when _critical then 'CRITICAL ICT ticket '
           else 'New ICT ticket '
         end || coalesce(new.ticket_number, ''),
         new.title || ' — ' || coalesce(new.priority, 'no priority') || ' — raised by ' || coalesce(_reporter, 'a colleague'),
         '/ict-service-desk'
  from public.ict_service_desk_team t
  where t.user_id <> new.reported_by;

  return new;
end;
$$;
