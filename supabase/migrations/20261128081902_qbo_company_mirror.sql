-- QuickBooks: one read-only connection for the whole company (not one per client).
-- Invoices and payments are mirrored server-side so Accounts can compare them with
-- Njia Smart's own invoices. Nothing is ever written back to QuickBooks.

-- 1. A company connection has no client.
alter table public.client_integrations alter column client_id drop not null;
alter table public.integration_auth_states alter column client_id drop not null;

alter table public.client_integrations
  drop constraint if exists client_integrations_company_or_client;
alter table public.client_integrations
  add constraint client_integrations_company_or_client
  check (client_id is not null or coalesce(metadata->>'scope','') = 'company');

create unique index if not exists client_integrations_one_company_uidx
  on public.client_integrations (provider, environment)
  where client_id is null and status <> 'disconnected';

-- 2. The credential functions only accepted 'sandbox'. Allow 'production' as well
-- by patching the live definitions (keeps their bodies otherwise identical).
do $patch$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('qbo_clear_credentials','qbo_mark_reconnect_required','qbo_read_credentials',
                        'qbo_store_credentials','qbo_try_acquire_refresh_lock')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_def := replace(v_def, 'environment = ''sandbox''', 'environment in (''sandbox'',''production'')');
    v_def := replace(v_def, 'v_environment <> ''sandbox''', 'v_environment not in (''sandbox'',''production'')');
    v_def := replace(v_def, 'Only configured QuickBooks sandbox integrations', 'Only configured QuickBooks integrations');
    execute v_def;
  end loop;
end
$patch$;

-- 3. Read-only mirror of QuickBooks invoices and payments (server access only).
create table if not exists public.qbo_invoices (
  integration_id uuid not null references public.client_integrations(id) on delete cascade,
  qbo_id text not null check (length(btrim(qbo_id)) between 1 and 100),
  doc_number text,
  customer_id text,
  customer_name text,
  txn_date date,
  due_date date,
  total numeric(18,4) not null default 0,
  balance numeric(18,4) not null default 0,
  currency text,
  voided boolean not null default false,
  provider_modified_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (integration_id, qbo_id)
);
create index if not exists qbo_invoices_doc_idx on public.qbo_invoices (integration_id, lower(btrim(doc_number)));
create index if not exists qbo_invoices_customer_idx on public.qbo_invoices (integration_id, lower(customer_name));

create table if not exists public.qbo_payments (
  integration_id uuid not null references public.client_integrations(id) on delete cascade,
  qbo_id text not null check (length(btrim(qbo_id)) between 1 and 100),
  customer_id text,
  customer_name text,
  txn_date date,
  total numeric(18,4) not null default 0,
  unapplied numeric(18,4) not null default 0,
  currency text,
  reference text,
  linked_invoice_ids text[] not null default '{}',
  provider_modified_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (integration_id, qbo_id)
);
create index if not exists qbo_payments_date_idx on public.qbo_payments (integration_id, txn_date desc);

alter table public.qbo_invoices enable row level security;
alter table public.qbo_payments enable row level security;
revoke all privileges on table public.qbo_invoices, public.qbo_payments from public, anon, authenticated;
grant select, insert, update, delete on table public.qbo_invoices, public.qbo_payments to service_role;
comment on table public.qbo_invoices is 'Read-only mirror of QuickBooks invoices (allow-listed fields). Server access only. Never written back to QuickBooks or used to overwrite Njia Smart invoices.';
comment on table public.qbo_payments is 'Read-only mirror of QuickBooks payments (allow-listed fields). Server access only.';

notify pgrst, 'reload schema';
