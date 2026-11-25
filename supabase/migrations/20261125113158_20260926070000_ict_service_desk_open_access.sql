-- ============================================================================
-- ICT Service Desk — open visibility to all staff
--
-- Previously 'ict_service_desk' mirrored 'ict' (projects) in get_module_rank:
-- most roles got rank 0 (none), so the module and its nav item were invisible
-- to everyone except Director/Admin (rank 3, via the catch-all) and
-- Accountant (rank 2, view). That matched src/lib/permissions.ts at the time.
--
-- permissions.ts has since changed: every role now gets at least "assigned"
-- (rank 1) on ict_service_desk — see everyone, raise/see your own tickets —
-- while Director/Admin keep "full" (rank 3: every ticket, plus asset and
-- maintenance detail). This migration mirrors that in SQL so RLS matches.
--
-- Full replacement of get_module_rank from
-- 20260926060000_ict_tickets.sql, with two changes:
--   1. A new universal branch: _module = 'ict_service_desk' -> rank 1 for
--      any role that hasn't already matched Director/Admin's rank-3 clause.
--   2. The Accountant branch is reverted to cover only 'ict' (projects);
--      Accountant's ict_service_desk rank now comes from the universal
--      branch above (rank 1, same as everyone else — 'ict' itself is
--      unaffected and keeps its own rules).
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
      -- Everyone else is capped at "assigned" (own tasks only), regardless
      -- of what access they'd otherwise have via the branches below.
      when _module = 'tasks' and ur.role in ('director', 'admin') then 3
      when _module = 'tasks' then 1

      -- 1. Director / Admin: full everywhere
      when ur.role in ('director', 'admin') then 3

      -- ICT Service Desk: open to every role at "assigned" (own tickets +
      -- the module's non-restricted stats). Director/Admin already matched
      -- the clause above and never reach this one.
      when _module = 'ict_service_desk' then 1

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
