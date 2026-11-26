-- Phase 2: read-only QuickBooks mirror.
-- Phase 3: operation ledger remains approval-gated; this migration does not
-- grant browser access or change any existing RLS policies.

create table if not exists public.integration_external_records (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null,
  client_id uuid not null,
  provider text not null default 'quickbooks_online'
    check (provider = 'quickbooks_online'),
  external_record_type text not null
    check (external_record_type in ('Customer','Invoice','Payment')),
  external_record_id text not null
    check (length(btrim(external_record_id)) between 1 and 200),
  display_name text,
  document_number text,
  transaction_date date,
  due_date date,
  total_amount numeric(18, 4),
  balance_amount numeric(18, 4),
  currency_code text,
  provider_modified_at timestamptz,
  record_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(record_data) = 'object'),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_external_records_integration_client_fk
    foreign key (integration_id, client_id)
    references public.client_integrations(id, client_id) on delete cascade,
  constraint integration_external_records_external_unique
    unique (integration_id, external_record_type, external_record_id)
);

comment on table public.integration_external_records is
  'Read-only, client-scoped mirror of selected QuickBooks Customer, Invoice and Payment fields. Never write these rows back to QuickBooks; never use them to overwrite Njia Smart operational records.';
comment on column public.integration_external_records.record_data is
  'Allow-listed provider fields only. Do not store OAuth tokens, payment card data, raw API responses, or unnecessary personal data.';

create index if not exists integration_external_records_client_type_idx
  on public.integration_external_records (client_id, integration_id, external_record_type, synced_at desc);
create index if not exists integration_external_records_modified_idx
  on public.integration_external_records (integration_id, external_record_type, provider_modified_at desc);

alter table public.integration_external_records enable row level security;
revoke all privileges on table public.integration_external_records from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_external_records to service_role;

-- Keep operation execution server-only. Existing operation rows and policies
-- are unchanged; the server functions enforce pending -> approved -> executing.
notify pgrst, 'reload schema';
