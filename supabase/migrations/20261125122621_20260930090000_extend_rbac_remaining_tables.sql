-- ============================================================================
-- Extend the get_module_rank RBAC model (see 20260925090000_module_rbac_
-- ownership.sql) to every table still relying on the old blanket is_staff()
-- or can_access_financials() policies:
--   - client_contacts, client_assignments      (module: clients)
--   - invoices, invoice_items, payments        (module: accounts)
--   - documents (+ storage: client-documents, audit-workpapers, tax-acks)
--   - advisory_projects, advisory_milestones, advisory_milestone_documents
--   - tax_return_assignees, client_tax_obligations
--
-- get_module_rank already resolves 'accounts', 'documents' and 'advisory'
-- correctly for every role (see 20260926140000_ict_service_desk_admin_only.sql)
-- — no change to that function is needed here, only new policies.
--
-- NOTE on Marketing: this migration makes Marketing's write access to
-- client_contacts/client_assignments match the original brief (view-only on
-- clients -> view-only here too, no more managing contacts/assignments).
-- can_access_financials() previously carved Marketing out as the one role
-- with full contact/assignment management. Flagging this in case that was
-- intentional and needs reverting.
-- ============================================================================

-- ---------- ownership columns advisory_projects was missing ----------------
alter table public.advisory_projects
  add column if not exists created_by uuid references auth.users(id);

-- ---------- CLIENT CONTACTS (module: clients) -------------------------------
drop policy if exists "contacts all staff" on public.client_contacts;

create policy "client contacts select by rank" on public.client_contacts
  for select to authenticated using (
    exists (
      select 1 from public.clients c
      where c.id = client_contacts.client_id
        and (
          public.can_view_module_all(auth.uid(), 'clients')
          or (
            public.is_module_assigned_only(auth.uid(), 'clients')
            and exists (select 1 from public.client_assignments ca where ca.client_id = c.id and ca.user_id = auth.uid())
          )
        )
    )
  );

create policy "client contacts insert full only" on public.client_contacts
  for insert to authenticated with check (public.has_full_module(auth.uid(), 'clients'));

create policy "client contacts update full only" on public.client_contacts
  for update to authenticated using (public.has_full_module(auth.uid(), 'clients'));

create policy "client contacts delete full only" on public.client_contacts
  for delete to authenticated using (public.has_full_module(auth.uid(), 'clients'));

-- ---------- CLIENT ASSIGNMENTS (module: clients) ----------------------------
-- Only full-access roles may assign staff to clients; an assigned user can
-- always see their own assignment row (that's how they see the client at all).
drop policy if exists "assignments all staff" on public.client_assignments;

create policy "client assignments select" on public.client_assignments
  for select to authenticated using (
    public.has_full_module(auth.uid(), 'clients') or client_assignments.user_id = auth.uid()
  );

create policy "client assignments insert full only" on public.client_assignments
  for insert to authenticated with check (public.has_full_module(auth.uid(), 'clients'));

create policy "client assignments update full only" on public.client_assignments
  for update to authenticated using (public.has_full_module(auth.uid(), 'clients'));

create policy "client assignments delete full only" on public.client_assignments
  for delete to authenticated using (public.has_full_module(auth.uid(), 'clients'));

-- ---------- ACCOUNTS: invoices, invoice_items, payments ---------------------
drop policy if exists "invoices staff all" on public.invoices;

create policy "invoices select by rank" on public.invoices
  for select to authenticated using (public.can_view_module_all(auth.uid(), 'accounts'));

create policy "invoices insert full only" on public.invoices
  for insert to authenticated with check (public.has_full_module(auth.uid(), 'accounts'));

create policy "invoices update full only" on public.invoices
  for update to authenticated using (public.has_full_module(auth.uid(), 'accounts'));

create policy "invoices delete owner or admin" on public.invoices
  for delete to authenticated using (public.can_delete_record(auth.uid(), 'accounts', created_by));

drop policy if exists "invoice_items staff all" on public.invoice_items;

create policy "invoice items by parent invoice" on public.invoice_items
  for all to authenticated
  using (
    exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id)
    and public.can_view_module_all(auth.uid(), 'accounts')
  )
  with check (public.has_full_module(auth.uid(), 'accounts'));

drop policy if exists "payments staff all" on public.payments;

create policy "payments select by rank" on public.payments
  for select to authenticated using (public.can_view_module_all(auth.uid(), 'accounts'));

create policy "payments insert full only" on public.payments
  for insert to authenticated with check (public.has_full_module(auth.uid(), 'accounts'));

create policy "payments update full only" on public.payments
  for update to authenticated using (public.has_full_module(auth.uid(), 'accounts'));

create policy "payments delete owner or admin" on public.payments
  for delete to authenticated using (public.can_delete_record(auth.uid(), 'accounts', recorded_by));

-- ---------- DOCUMENTS (module: documents) -----------------------------------
drop policy if exists "documents all staff" on public.documents;

create policy "documents select by rank" on public.documents
  for select to authenticated using (
    public.can_view_module_all(auth.uid(), 'documents')
    or (
      public.is_module_assigned_only(auth.uid(), 'documents')
      and (
        documents.uploaded_by = auth.uid()
        or exists (select 1 from public.client_assignments ca where ca.client_id = documents.client_id and ca.user_id = auth.uid())
      )
    )
  );

create policy "documents insert full only" on public.documents
  for insert to authenticated with check (public.has_full_module(auth.uid(), 'documents'));

create policy "documents update by rank" on public.documents
  for update to authenticated using (
    public.has_full_module(auth.uid(), 'documents')
    or (public.is_module_assigned_only(auth.uid(), 'documents') and documents.uploaded_by = auth.uid())
  );

create policy "documents delete owner or admin" on public.documents
  for delete to authenticated using (public.can_delete_record(auth.uid(), 'documents', uploaded_by));

-- Storage: client-documents/audit-workpapers/tax-acks were only excluding
-- Marketing (via can_access_financials). Replace with per-bucket module rank.
drop policy if exists "staff read client docs" on storage.objects;
drop policy if exists "staff write client docs" on storage.objects;
drop policy if exists "staff update client docs" on storage.objects;
drop policy if exists "staff delete client docs" on storage.objects;

create policy "docs storage read by rank" on storage.objects
  for select to authenticated using (
    (bucket_id = 'client-documents' and public.can_view_module(auth.uid(), 'documents'))
    or (bucket_id = 'audit-workpapers' and public.can_view_module(auth.uid(), 'audit'))
    or (bucket_id = 'tax-acks' and public.can_view_module(auth.uid(), 'tax'))
  );

create policy "docs storage write by rank" on storage.objects
  for insert to authenticated with check (
    (bucket_id = 'client-documents' and public.has_full_module(auth.uid(), 'documents'))
    or (bucket_id = 'audit-workpapers' and public.has_full_module(auth.uid(), 'audit'))
    or (bucket_id = 'tax-acks' and public.has_full_module(auth.uid(), 'tax'))
  );

create policy "docs storage update by rank" on storage.objects
  for update to authenticated using (
    (bucket_id = 'client-documents' and public.has_full_module(auth.uid(), 'documents'))
    or (bucket_id = 'audit-workpapers' and public.has_full_module(auth.uid(), 'audit'))
    or (bucket_id = 'tax-acks' and public.has_full_module(auth.uid(), 'tax'))
  );

create policy "docs storage delete admin" on storage.objects
  for delete to authenticated using (
    bucket_id in ('client-documents', 'audit-workpapers', 'tax-acks') and public.is_admin(auth.uid())
  );

-- ---------- ADVISORY: projects, milestones, milestone documents -------------
drop policy if exists "advisory projects select staff" on public.advisory_projects;
drop policy if exists "advisory projects insert staff" on public.advisory_projects;
drop policy if exists "advisory projects update staff" on public.advisory_projects;
drop policy if exists "advisory projects delete admin" on public.advisory_projects;
drop policy if exists "advisory projects all staff" on public.advisory_projects;

create policy "advisory projects select by rank" on public.advisory_projects
  for select to authenticated using (
    public.can_view_module_all(auth.uid(), 'advisory')
    or (
      public.is_module_assigned_only(auth.uid(), 'advisory')
      and (
        advisory_projects.created_by = auth.uid()
        or exists (select 1 from public.client_assignments ca where ca.client_id = advisory_projects.client_id and ca.user_id = auth.uid())
      )
    )
  );

create policy "advisory projects insert full only" on public.advisory_projects
  for insert to authenticated with check (public.has_full_module(auth.uid(), 'advisory'));

create policy "advisory projects update by rank" on public.advisory_projects
  for update to authenticated using (
    public.has_full_module(auth.uid(), 'advisory')
    or (public.is_module_assigned_only(auth.uid(), 'advisory') and advisory_projects.created_by = auth.uid())
  );

create policy "advisory projects delete owner or admin" on public.advisory_projects
  for delete to authenticated using (public.can_delete_record(auth.uid(), 'advisory', created_by));

drop policy if exists "advisory milestones select staff" on public.advisory_milestones;
drop policy if exists "advisory milestones insert staff" on public.advisory_milestones;
drop policy if exists "advisory milestones update staff" on public.advisory_milestones;
drop policy if exists "advisory milestones delete admin" on public.advisory_milestones;
drop policy if exists "advisory milestones all staff" on public.advisory_milestones;

create policy "advisory milestones by parent project" on public.advisory_milestones
  for all to authenticated
  using (
    exists (
      select 1 from public.advisory_projects p
      where p.id = advisory_milestones.project_id
        and (
          public.can_view_module_all(auth.uid(), 'advisory')
          or (
            public.is_module_assigned_only(auth.uid(), 'advisory')
            and (
              p.created_by = auth.uid()
              or exists (select 1 from public.client_assignments ca where ca.client_id = p.client_id and ca.user_id = auth.uid())
            )
          )
        )
    )
  )
  with check (public.can_view_module(auth.uid(), 'advisory'));

drop policy if exists "Staff can view milestone documents" on public.advisory_milestone_documents;
drop policy if exists "Staff can insert milestone documents" on public.advisory_milestone_documents;
drop policy if exists "Staff can update milestone documents" on public.advisory_milestone_documents;
drop policy if exists "Staff can delete milestone documents" on public.advisory_milestone_documents;

create policy "milestone documents by parent" on public.advisory_milestone_documents
  for all to authenticated
  using (
    exists (
      select 1 from public.advisory_milestones m
      join public.advisory_projects p on p.id = m.project_id
      where m.id = advisory_milestone_documents.milestone_id
        and (
          public.can_view_module_all(auth.uid(), 'advisory')
          or (
            public.is_module_assigned_only(auth.uid(), 'advisory')
            and (
              p.created_by = auth.uid()
              or exists (select 1 from public.client_assignments ca where ca.client_id = p.client_id and ca.user_id = auth.uid())
            )
          )
        )
    )
  )
  with check (public.can_view_module(auth.uid(), 'advisory'));

-- ---------- TAX RETURN ASSIGNEES (module: tax) ------------------------------
drop policy if exists "tax assignees all staff" on public.tax_return_assignees;

create policy "tax assignees by parent return" on public.tax_return_assignees
  for all to authenticated
  using (
    exists (
      select 1 from public.tax_returns t
      where t.id = tax_return_assignees.tax_return_id
        and (
          public.can_view_module_all(auth.uid(), 'tax')
          or (
            public.is_module_assigned_only(auth.uid(), 'tax')
            and (
              t.assigned_to = auth.uid()
              or exists (select 1 from public.client_assignments ca where ca.client_id = t.client_id and ca.user_id = auth.uid())
            )
          )
        )
    )
  )
  with check (public.can_view_module(auth.uid(), 'tax'));

-- ---------- CLIENT TAX OBLIGATIONS (module: tax) ----------------------------
drop policy if exists "client tax obligations staff all" on public.client_tax_obligations;

create policy "client tax obligations select by rank" on public.client_tax_obligations
  for select to authenticated using (
    exists (
      select 1 from public.clients c
      where c.id = client_tax_obligations.client_id
        and (
          public.can_view_module_all(auth.uid(), 'tax')
          or (
            public.is_module_assigned_only(auth.uid(), 'tax')
            and exists (select 1 from public.client_assignments ca where ca.client_id = c.id and ca.user_id = auth.uid())
          )
        )
    )
  );

create policy "client tax obligations insert full only" on public.client_tax_obligations
  for insert to authenticated with check (public.has_full_module(auth.uid(), 'tax'));

create policy "client tax obligations update full only" on public.client_tax_obligations
  for update to authenticated using (public.has_full_module(auth.uid(), 'tax'));

create policy "client tax obligations delete full only" on public.client_tax_obligations
  for delete to authenticated using (public.has_full_module(auth.uid(), 'tax'));
