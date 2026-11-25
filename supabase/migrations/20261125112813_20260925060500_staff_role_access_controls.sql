-- ----------------------------------------------------------------------------
-- Access control notes
--
-- is_admin() already only recognises 'director'/'admin' explicitly, so none
-- of the four roles added in the previous migration gain admin powers (team
-- management, role assignment, policy management, client deletion) just by
-- existing in the enum -- that stays locked down exactly as before.
--
-- tax_assistant / audit_assistant / internal_admin are treated as ordinary
-- operational staff (same tier as accountant/intern/etc. today) -- they get
-- the same is_staff()-gated access those roles already have, minus any
-- admin-only action. No existing role's access changes.
--
-- marketing is the one role that should NOT see the firm's client financial
-- work product. It keeps: viewing/managing the client directory and
-- contacts (its actual job), and its own tasks. It's excluded from tax
-- returns, tax obligations, engagements (audit/advisory/service), general
-- documents, and the audit-workpapers/tax-acks storage buckets.
-- ----------------------------------------------------------------------------

create or replace function public.can_access_financials(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role <> 'marketing'
  )
$$;
grant execute on function public.can_access_financials(uuid) to authenticated;

alter policy "tax returns all staff" on public.tax_returns
  using (public.can_access_financials(auth.uid()))
  with check (public.can_access_financials(auth.uid()));

alter policy "client tax obligations staff all" on public.client_tax_obligations
  using (public.can_access_financials(auth.uid()))
  with check (public.can_access_financials(auth.uid()));

alter policy "engagements all staff" on public.engagements
  using (public.can_access_financials(auth.uid()))
  with check (public.can_access_financials(auth.uid()));

alter policy "documents all staff" on public.documents
  using (public.can_access_financials(auth.uid()))
  with check (public.can_access_financials(auth.uid()));

alter policy "staff read client docs" on storage.objects
  using (bucket_id in ('client-documents','audit-workpapers','tax-acks') and public.can_access_financials(auth.uid()));

alter policy "staff write client docs" on storage.objects
  with check (bucket_id in ('client-documents','audit-workpapers','tax-acks') and public.can_access_financials(auth.uid()));

alter policy "staff update client docs" on storage.objects
  using (bucket_id in ('client-documents','audit-workpapers','tax-acks') and public.can_access_financials(auth.uid()));
