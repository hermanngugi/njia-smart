-- Phase 2: connect assessed risks to the procedures that respond to them.
-- Additive migration; existing audit records and policies remain intact.

create table if not exists public.audit_risk_procedure_links (
  id uuid primary key default gen_random_uuid(),
  risk_id uuid not null references public.audit_risks(id) on delete cascade,
  engagement_procedure_id uuid not null references public.audit_engagement_procedures(id) on delete cascade,
  linked_by uuid references auth.users(id) on delete set null default auth.uid(),
  linked_at timestamptz not null default now(),
  unique (risk_id, engagement_procedure_id)
);

create index if not exists audit_risk_procedure_links_procedure_idx
  on public.audit_risk_procedure_links(engagement_procedure_id);

alter table public.audit_risk_procedure_links enable row level security;

drop policy if exists "audit risk procedure links financial staff" on public.audit_risk_procedure_links;
create policy "audit risk procedure links financial staff" on public.audit_risk_procedure_links
  for all to authenticated
  using (public.can_access_financials(auth.uid()))
  with check (
    public.can_access_financials(auth.uid())
    and (linked_by is null or linked_by = auth.uid())
  );

-- A risk can only be linked to a procedure within the same engagement.
create or replace function public.audit_validate_risk_procedure_engagement()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  risk_engagement uuid;
  procedure_engagement uuid;
begin
  select engagement_id into risk_engagement
    from public.audit_risks where id = new.risk_id;
  select engagement_id into procedure_engagement
    from public.audit_engagement_procedures where id = new.engagement_procedure_id;
  if risk_engagement is null or procedure_engagement is null or risk_engagement <> procedure_engagement then
    raise exception 'Risk and audit procedure must belong to the same engagement';
  end if;
  return new;
end;
$$;

drop trigger if exists audit_validate_risk_procedure_engagement on public.audit_risk_procedure_links;
create trigger audit_validate_risk_procedure_engagement
  before insert or update on public.audit_risk_procedure_links
  for each row execute function public.audit_validate_risk_procedure_engagement();
