-- ============================================================================
-- Accounts: Director/Admin see everything; every other role only works with
-- the invoices raised on the clients they handle.
--
-- "My invoice" = I am one of the invoice's handlers (staff assigned to the
-- client when it was raised, see invoice_handlers) OR I created it.
-- Everyone else can: see their own invoices, record/update payments on them
-- (and standalone receipts for clients assigned to them). They cannot edit
-- invoice totals/status, delete, or read other people's invoices/payments, so
-- firm-wide balance and collected totals are visible to Director/Admin only.
--
-- Mirrors src/lib/permissions.ts (accounts: director/admin = full, rest = assigned).
-- ============================================================================

-- 1. Rank: accounts is full for director/admin, "assigned" (1) for everyone else
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

      -- Accounts: Director/Admin see everything; every other role is limited
      -- to the invoices/payments of the clients they handle.
      when _module = 'accounts' and ur.role in ('director', 'admin') then 3
      when _module = 'accounts' then 1

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

-- 2. Ownership helpers -------------------------------------------------------
create or replace function public.is_my_client(_user_id uuid, _client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.client_assignments ca
                  where ca.client_id = _client_id and ca.user_id = _user_id)
$$;

create or replace function public.is_my_invoice(_user_id uuid, _invoice_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invoice_handlers h
                  where h.invoice_id = _invoice_id and h.user_id = _user_id)
      or exists (select 1 from public.invoices i
                  where i.id = _invoice_id and i.created_by = _user_id)
$$;

GRANT EXECUTE ON FUNCTION public.is_my_client(uuid, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_invoice(uuid, uuid) TO authenticated;

-- 3. invoices ----------------------------------------------------------------
drop policy if exists "invoices select by rank" on public.invoices;
create policy "invoices select own or admin" on public.invoices
  for select to authenticated
  using (public.has_full_module(auth.uid(), 'accounts') or public.is_my_invoice(auth.uid(), id));

-- Staff can raise an invoice only on a client they are assigned to (this is
-- what the "generate invoice on completion" flow does).
drop policy if exists "invoices insert full only" on public.invoices;
create policy "invoices insert own clients or admin" on public.invoices
  for insert to authenticated
  with check (
    public.has_full_module(auth.uid(), 'accounts')
    or (created_by = auth.uid() and public.is_my_client(auth.uid(), client_id))
  );
-- update stays "full only" (totals/status are changed by triggers, not by staff)
-- delete stays "owner or admin" and, with rank 1, is effectively admin only.

-- 4. invoice_items -----------------------------------------------------------
drop policy if exists "invoice items by parent invoice" on public.invoice_items;

create policy "invoice items select own or admin" on public.invoice_items
  for select to authenticated
  using (public.has_full_module(auth.uid(), 'accounts') or public.is_my_invoice(auth.uid(), invoice_id));

create policy "invoice items insert own or admin" on public.invoice_items
  for insert to authenticated
  with check (public.has_full_module(auth.uid(), 'accounts') or public.is_my_invoice(auth.uid(), invoice_id));

create policy "invoice items update admin only" on public.invoice_items
  for update to authenticated
  using (public.has_full_module(auth.uid(), 'accounts'))
  with check (public.has_full_module(auth.uid(), 'accounts'));

create policy "invoice items delete admin only" on public.invoice_items
  for delete to authenticated
  using (public.has_full_module(auth.uid(), 'accounts'));

-- 5. payments ----------------------------------------------------------------
-- A payment belongs to a person if it is on one of their invoices, or it is a
-- standalone receipt (no invoice yet) for a client assigned to them.
drop policy if exists "payments select by rank" on public.payments;
drop policy if exists "payments insert full only" on public.payments;
drop policy if exists "payments update full only" on public.payments;

create policy "payments select own or admin" on public.payments
  for select to authenticated
  using (
    public.has_full_module(auth.uid(), 'accounts')
    or (invoice_id is not null and public.is_my_invoice(auth.uid(), invoice_id))
    or (invoice_id is null and public.is_my_client(auth.uid(), client_id))
  );

create policy "payments insert own or admin" on public.payments
  for insert to authenticated
  with check (
    public.has_full_module(auth.uid(), 'accounts')
    or (invoice_id is not null and public.is_my_invoice(auth.uid(), invoice_id))
    or (invoice_id is null and public.is_my_client(auth.uid(), client_id))
  );

create policy "payments update own or admin" on public.payments
  for update to authenticated
  using (
    public.has_full_module(auth.uid(), 'accounts')
    or (invoice_id is not null and public.is_my_invoice(auth.uid(), invoice_id))
    or (invoice_id is null and public.is_my_client(auth.uid(), client_id))
  )
  with check (
    public.has_full_module(auth.uid(), 'accounts')
    or (invoice_id is not null and public.is_my_invoice(auth.uid(), invoice_id))
    or (invoice_id is null and public.is_my_client(auth.uid(), client_id))
  );
-- delete stays "owner or admin" -> admin only for restricted roles.

-- 6. invoice_handlers (the "Handled by" column) ------------------------------
drop policy if exists "invoice handlers select" on public.invoice_handlers;
create policy "invoice handlers select own or admin" on public.invoice_handlers
  for select to authenticated
  using (public.has_full_module(auth.uid(), 'accounts') or public.is_my_invoice(auth.uid(), invoice_id));
-- write policy ("full only") is unchanged and now means director/admin only.
