-- ============================================================================
-- Updated role x module permissions matrix (see
-- new_njia-smart-role-permissions.xlsx). Full replacement of get_module_rank
-- — mirrors src/lib/permissions.ts. Keep the two in sync.
--
-- Rank scale: 0 none / 1 assigned (own records only) / 2 view (read-only,
-- everything in the module) / 3 full (read/write; delete still requires
-- ownership via can_delete_record unless director/admin).
--
-- Changes from the previous matrix:
--   - New role: ict_officer — full on ICT (projects) + ICT Service Desk +
--     Activity, view on most other modules.
--   - Clients: tightened to Director/Admin only for Full; every other role
--     (incl. Audit Manager/Tax Consultant, who previously had Full) is now
--     View-only.
--   - Audit/Tax: Accountant downgraded from Full to View-only.
--   - Advisory: Advisory Officer keeps Full only on 'advisory' itself;
--     Outsourced Accounting/Payroll/Financial Business Mgmt are now
--     View-only for Advisory Officer (previously Full). Accountant keeps
--     Full on those three, but is now View-only on 'advisory' itself.
--   - ICT (projects): Accountant downgraded from View to None (ICT Officer
--     owns this module now).
--   - HR: only Director/Admin keep Full; Audit Manager/Tax Consultant/
--     Advisory Officer/Accountant/Assistants/Marketing/Internal Admin are
--     all View-only (was Full for several of these roles, and None for
--     Marketing/Internal Admin).
--   - Documents: Advisory Officer upgraded View -> Full. Assistants/Marketing
--     become View (see everything) instead of "assigned" (own uploads only).
--   - Calendar/Settings: Assistants, Marketing and Internal Admin all
--     upgraded to Full (previously View/assigned).
--   - ICT Service Desk: Director now gets Full (previously only Admin).
--   - Team: Director restored to Full (previously only Admin).
--   - Activity: Director explicitly has NONE (Admin and the new ICT Officer
--     role get Full instead).
--   - Accounts: Internal Admin is explicitly None (not "assigned" like every
--     other non-director/admin role).
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

      -- Accounts: Director/Admin see everything; Internal Admin has no
      -- access at all; every other role is limited to the invoices/payments
      -- of the clients they handle ("assigned").
      when _module = 'accounts' and ur.role in ('director', 'admin') then 3
      when _module = 'accounts' and ur.role = 'internal_admin' then 0
      when _module = 'accounts' then 1

      -- ICT Service Desk: Admin, Director and ICT Officer get full oversight
      -- (every ticket, asset detail, delete). Everyone else is "assigned" —
      -- raise and see their own tickets only.
      when _module = 'ict_service_desk' and ur.role in ('admin', 'director', 'ict_officer') then 3
      when _module = 'ict_service_desk' then 1

      -- Activity (audit trail): Admin and ICT Officer only. Director is
      -- explicitly excluded, so this must sit above the Director/Admin
      -- catch-all below.
      when _module = 'activity' and ur.role = 'director' then 0

      -- 1. Director / Admin: full everywhere else (clients, audit, tax,
      -- advisory, outsourced_accounting, payroll_management,
      -- financial_business_management, ict, documents, calendar, hr,
      -- settings, team, activity [admin only, see above], announcements,
      -- notifications, chat, dashboard).
      when ur.role in ('director', 'admin') then 3

      -- 2. ICT Officer: full on ICT (projects), documents, calendar,
      -- settings and activity; view everywhere else that's client/ops work;
      -- none on team.
      when ur.role = 'ict_officer' and _module in
        ('ict','documents','calendar','settings','activity','announcements','notifications','dashboard') then 3
      when ur.role = 'ict_officer' and _module in
        ('clients','audit','tax','advisory','outsourced_accounting','payroll_management','financial_business_management','hr') then 2

      -- 3. Audit manager & Tax consultant: full on their core ops (audit,
      -- tax, documents, calendar, settings); view on clients, the other
      -- service lines, advisory and hr.
      when ur.role in ('audit_manager', 'tax_consultant') and _module in
        ('audit','tax','documents','calendar','settings','announcements','notifications','dashboard') then 3
      when ur.role in ('audit_manager', 'tax_consultant') and _module in
        ('clients','outsourced_accounting','payroll_management','financial_business_management','advisory','hr') then 2

      -- 4. Advisory officer: full on advisory + documents/calendar/settings;
      -- view on clients/audit/tax/the other three service lines/hr.
      when ur.role = 'advisory_officer' and _module in
        ('advisory','documents','calendar','settings','announcements','notifications','dashboard') then 3
      when ur.role = 'advisory_officer' and _module in
        ('clients','audit','tax','outsourced_accounting','payroll_management','financial_business_management','hr') then 2

      -- 5. Accountant: full on the three service lines it runs plus
      -- documents/calendar/settings; view on clients/audit/tax/advisory/hr;
      -- no ICT (projects) access at all.
      when ur.role = 'accountant' and _module in
        ('outsourced_accounting','payroll_management','financial_business_management','documents','calendar','settings','announcements','notifications','dashboard') then 3
      when ur.role = 'accountant' and _module in
        ('clients','audit','tax','advisory','hr') then 2

      -- 6. Assistants & interns: full on calendar/settings (+announcements);
      -- view on clients/audit/tax/documents/hr; nothing on the service
      -- lines, advisory or ICT.
      when ur.role in ('accounts_assistant','tax_assistant','audit_assistant','intern') and _module in
        ('calendar','settings','announcements','notifications','dashboard') then 3
      when ur.role in ('accounts_assistant','tax_assistant','audit_assistant','intern') and _module in
        ('clients','audit','tax','documents','hr') then 2

      -- 7. Marketing: full on calendar/settings; view on clients/documents/
      -- advisory/hr.
      when ur.role = 'marketing' and _module in
        ('calendar','settings','announcements','notifications','dashboard') then 3
      when ur.role = 'marketing' and _module in
        ('clients','documents','advisory','hr') then 2

      -- 8. Internal admin: full on calendar/settings; view on hr only.
      when ur.role = 'internal_admin' and _module in
        ('calendar','settings','announcements','notifications','dashboard') then 3
      when ur.role = 'internal_admin' and _module = 'hr' then 2

      else 0
    end as rank
    from public.user_roles ur
    where ur.user_id = _user_id
  ) ranked
$$;

comment on function public.get_module_rank is
  'Highest access rank (0 none / 1 assigned / 2 view / 3 full) the user holds for a module, across all their roles. Mirrors src/lib/permissions.ts. See new_njia-smart-role-permissions.xlsx for the source matrix.';
