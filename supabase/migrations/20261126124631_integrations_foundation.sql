-- Njia Smart integration foundation.
-- All integration records are server-managed. Browser roles have no direct
-- table privileges; server endpoints must validate the caller and client
-- using public.integration_client_access_check() before privileged actions.

create table public.client_integrations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  provider text not null
    check (provider in ('quickbooks_online','kra_etims_oscu','kra_etims_vscu','xero','sage')),
  environment text not null default 'sandbox'
    check (environment in ('sandbox','production')),
  external_account_id text,
  external_account_name text,
  country_code text
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  status text not null default 'pending'
    check (status in ('pending','connected','disconnected','reconnect_required','error')),
  scopes text[] not null default '{}'::text[],
  credential_secret_id uuid,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  token_updated_at timestamptz,
  refresh_lock_id uuid,
  refresh_lock_expires_at timestamptz,
  connected_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  last_connected_at timestamptz,
  last_synced_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_integrations_id_client_unique unique (id, client_id),
  constraint client_integrations_refresh_lock_pair
    check ((refresh_lock_id is null) = (refresh_lock_expires_at is null)),
  constraint client_integrations_connected_credentials
    check (status <> 'connected' or (external_account_id is not null and credential_secret_id is not null)),
  constraint client_integrations_disconnected_no_credentials
    check (status <> 'disconnected' or credential_secret_id is null)
);

comment on table public.client_integrations is
  'Server-managed connections between a Njia Smart client and an external accounting/compliance provider. OAuth credentials live in Supabase Vault, never in this table.';
comment on column public.client_integrations.credential_secret_id is
  'Reference to a Vault secret containing the encrypted provider credential bundle; never expose the secret value through the Data API.';
comment on column public.client_integrations.metadata is
  'Non-secret provider metadata only. Never store access tokens, refresh tokens, client secrets, webhook secrets or raw credential payloads here.';

create unique index client_integrations_provider_account_active_uidx
  on public.client_integrations (provider, environment, external_account_id)
  where external_account_id is not null and status <> 'disconnected';
create index client_integrations_client_status_idx
  on public.client_integrations (client_id, status);
create index client_integrations_refresh_expiry_idx
  on public.client_integrations (access_token_expires_at)
  where status = 'connected';

create table public.integration_auth_states (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null
    check (provider in ('quickbooks_online','kra_etims_oscu','kra_etims_vscu','xero','sage')),
  environment text not null default 'sandbox'
    check (environment in ('sandbox','production')),
  state_hash text not null unique
    check (state_hash ~ '^[a-f0-9]{64}$'),
  requested_scopes text[] not null default '{}'::text[],
  initiated_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint integration_auth_states_expiry_after_creation
    check (expires_at > created_at)
);

comment on table public.integration_auth_states is
  'Short-lived, single-use OAuth state records. Only a SHA-256 hash is stored; the plaintext state is returned once to the initiating browser and is never persisted.';

create index integration_auth_states_expiry_idx
  on public.integration_auth_states (expires_at);
create index integration_auth_states_client_idx
  on public.integration_auth_states (client_id, created_at desc);

create table public.integration_record_mappings (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null,
  client_id uuid not null,
  local_record_type text not null
    check (local_record_type in ('client','invoice','payment')),
  local_record_id uuid not null,
  external_record_type text not null
    check (length(btrim(external_record_type)) between 1 and 80),
  external_record_id text not null
    check (length(btrim(external_record_id)) between 1 and 200),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_record_mappings_integration_client_fk
    foreign key (integration_id, client_id)
    references public.client_integrations(id, client_id) on delete cascade,
  constraint integration_record_mappings_external_unique
    unique (integration_id, external_record_type, external_record_id),
  constraint integration_record_mappings_local_unique
    unique (integration_id, local_record_type, local_record_id)
);

comment on table public.integration_record_mappings is
  'Explicit, client-scoped mapping between Njia Smart records and external provider records. Matching by display name alone is not sufficient to create a mapping.';
comment on column public.integration_record_mappings.metadata is
  'Sanitised non-secret mapping metadata only; do not store complete provider responses or credentials.';

create index integration_record_mappings_client_idx
  on public.integration_record_mappings (client_id, integration_id);

create table public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null,
  client_id uuid not null,
  run_type text not null
    check (run_type in ('initial','full','incremental','manual','webhook','recovery')),
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','partial','failed','cancelled')),
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  records_seen integer not null default 0 check (records_seen >= 0),
  records_created integer not null default 0 check (records_created >= 0),
  records_updated integer not null default 0 check (records_updated >= 0),
  records_skipped integer not null default 0 check (records_skipped >= 0),
  records_failed integer not null default 0 check (records_failed >= 0),
  provider_cursor jsonb,
  error_code text,
  error_summary text,
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now(),
  constraint integration_sync_runs_integration_client_fk
    foreign key (integration_id, client_id)
    references public.client_integrations(id, client_id) on delete cascade,
  constraint integration_sync_runs_finish_after_start
    check (finished_at is null or started_at is null or finished_at >= started_at)
);

comment on table public.integration_sync_runs is
  'Audit history for connector synchronisation. Store counts, cursors and sanitised errors; do not store OAuth credentials or unredacted provider payloads.';
comment on column public.integration_sync_runs.provider_cursor is
  'Provider pagination/change cursor only. Must not contain credentials or personal data.';
comment on column public.integration_sync_runs.error_summary is
  'Sanitised diagnostic text. Remove tokens, secrets, full payloads and unnecessary personal data.';

create index integration_sync_runs_client_created_idx
  on public.integration_sync_runs (client_id, created_at desc);
create index integration_sync_runs_integration_status_idx
  on public.integration_sync_runs (integration_id, status, created_at desc);

create table public.integration_webhook_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null,
  client_id uuid not null,
  provider_event_id text,
  deduplication_hash text not null
    check (deduplication_hash ~ '^[a-f0-9]{64}$'),
  payload_sha256 text not null
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  event_type text not null
    check (length(btrim(event_type)) between 1 and 160),
  processing_status text not null default 'received'
    check (processing_status in ('received','processing','processed','ignored','failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  error_code text,
  constraint integration_webhook_events_integration_client_fk
    foreign key (integration_id, client_id)
    references public.client_integrations(id, client_id) on delete cascade,
  constraint integration_webhook_events_dedupe_unique
    unique (integration_id, deduplication_hash)
);

comment on table public.integration_webhook_events is
  'Webhook idempotency and processing ledger. Only hashes and event metadata are stored; raw signed webhook bodies are not retained in this table.';

create index integration_webhook_events_client_received_idx
  on public.integration_webhook_events (client_id, received_at desc);
create index integration_webhook_events_status_received_idx
  on public.integration_webhook_events (processing_status, received_at);

create table public.integration_operations (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null,
  client_id uuid not null,
  operation_type text not null
    check (operation_type in (
      'create_invoice','record_payment','void_invoice',
      'submit_etims_invoice','cancel_etims_invoice'
    )),
  status text not null default 'pending_approval'
    check (status in (
      'pending_approval','approved','rejected','executing',
      'succeeded','failed','cancelled'
    )),
  idempotency_key text not null
    check (length(btrim(idempotency_key)) between 8 and 128),
  request_payload jsonb not null
    check (jsonb_typeof(request_payload) = 'object'),
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  rejected_reason text,
  executed_by uuid references auth.users(id) on delete set null,
  executed_at timestamptz,
  external_record_type text,
  external_record_id text,
  result_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result_summary) = 'object'),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_operations_integration_client_fk
    foreign key (integration_id, client_id)
    references public.client_integrations(id, client_id) on delete cascade,
  constraint integration_operations_idempotency_unique
    unique (integration_id, idempotency_key),
  constraint integration_operations_approval_pair
    check ((approved_by is null) = (approved_at is null))
);

comment on table public.integration_operations is
  'Controlled external write requests for later phases. Every operation is idempotent and must pass server-side validation and explicit approval before execution.';
comment on column public.integration_operations.request_payload is
  'Validated business request only. Never include OAuth tokens, provider client secrets, passwords or webhook verification secrets.';
comment on column public.integration_operations.result_summary is
  'Sanitised execution summary only. The authoritative provider identifier is stored separately.';

create index integration_operations_client_status_idx
  on public.integration_operations (client_id, status, created_at desc);

create or replace function private.integration_record_mapping_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
begin
  if new.local_record_type = 'client' then
    if new.local_record_id is distinct from new.client_id then
      raise exception 'Client mapping must reference the integration client'
        using errcode = '23514';
    end if;
  elsif new.local_record_type = 'invoice' then
    if not exists (
      select 1 from public.invoices i
      where i.id = new.local_record_id
        and i.client_id = new.client_id
    ) then
      raise exception 'Invoice mapping must reference an invoice belonging to the integration client'
        using errcode = '23514';
    end if;
  elsif new.local_record_type = 'payment' then
    if not exists (
      select 1 from public.payments p
      where p.id = new.local_record_id
        and p.client_id = new.client_id
    ) then
      raise exception 'Payment mapping must reference a payment belonging to the integration client'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.integration_record_mapping_guard() from public, anon, authenticated;
grant execute on function private.integration_record_mapping_guard() to service_role;

create trigger integration_record_mapping_client_guard
before insert or update of integration_id, client_id, local_record_type, local_record_id
on public.integration_record_mappings
for each row execute function private.integration_record_mapping_guard();

create or replace function private.get_module_rank(_user_id uuid, _module text)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(max(rank), 0) from (
    select case
      when _module = 'tasks' and ur.role in ('director', 'admin') then 3
      when _module = 'tasks' then 1
      when _module = 'accounts' and ur.role in ('director', 'admin') then 3
      when _module = 'accounts' and ur.role = 'internal_admin' then 0
      when _module = 'accounts' then 1
      when _module = 'ict_service_desk' and ur.role in ('admin', 'director', 'ict_officer') then 3
      when _module = 'ict_service_desk' then 1
      when _module = 'activity' and ur.role = 'director' then 0
      when _module = 'integrations' and ur.role in
        ('accountant','audit_manager','tax_consultant') then 1
      when ur.role in ('director', 'admin') then 3
      when ur.role = 'ict_officer' and _module in
        ('ict','documents','calendar','settings','activity','announcements','notifications','dashboard') then 3
      when ur.role = 'ict_officer' and _module in
        ('clients','audit','tax','advisory','outsourced_accounting','payroll_management','financial_business_management','hr') then 2
      when ur.role in ('audit_manager', 'tax_consultant') and _module in
        ('audit','tax','documents','calendar','settings','announcements','notifications','dashboard') then 3
      when ur.role in ('audit_manager', 'tax_consultant') and _module in
        ('clients','outsourced_accounting','payroll_management','financial_business_management','advisory','hr') then 2
      when ur.role = 'advisory_officer' and _module in
        ('advisory','documents','calendar','settings','announcements','notifications','dashboard') then 3
      when ur.role = 'advisory_officer' and _module in
        ('clients','audit','tax','outsourced_accounting','payroll_management','financial_business_management','hr') then 2
      when ur.role = 'accountant' and _module in
        ('outsourced_accounting','payroll_management','financial_business_management','documents','calendar','settings','announcements','notifications','dashboard') then 3
      when ur.role = 'accountant' and _module in
        ('clients','audit','tax','advisory','hr') then 2
      when ur.role in ('accounts_assistant','tax_assistant','audit_assistant','intern') and _module in
        ('calendar','settings','announcements','notifications','dashboard') then 3
      when ur.role in ('accounts_assistant','tax_assistant','audit_assistant','intern') and _module in
        ('clients','audit','tax','documents','hr') then 2
      when ur.role = 'marketing' and _module in
        ('calendar','settings','announcements','notifications','dashboard') then 3
      when ur.role = 'marketing' and _module in
        ('clients','documents','advisory','hr') then 2
      when ur.role = 'internal_admin' and _module in
        ('calendar','settings','announcements','notifications','dashboard') then 3
      when ur.role = 'internal_admin' and _module = 'hr' then 2
      else 0
    end as rank
    from public.user_roles ur
    where ur.user_id = _user_id
  ) ranked
$function$;

comment on function private.get_module_rank(uuid, text) is
  'Highest access rank (0 none / 1 assigned / 2 view / 3 full) for a user and module. Includes assigned-client integrations access for Accountant, Audit Manager and Tax Consultant.';

create or replace function private.can_access_integration_client(
  _user_id uuid,
  _client_id uuid,
  _action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_rank integer;
  v_is_admin boolean;
  v_is_paused boolean;
  v_is_assigned boolean;
  v_is_accountant boolean;
begin
  if _user_id is null or _client_id is null
     or _action not in ('view','connect','sync','disconnect','approve') then
    return false;
  end if;
  if not private.is_staff(_user_id) then
    return false;
  end if;
  select coalesce(c.is_paused, false)
    into v_is_paused
  from public.clients c
  where c.id = _client_id;
  if not found then
    return false;
  end if;
  v_is_admin := private.is_admin(_user_id);
  if v_is_paused and not v_is_admin then
    return false;
  end if;
  v_rank := private.get_module_rank(_user_id, 'integrations');
  if v_rank < 1 then
    return false;
  end if;
  v_is_assigned := exists (
    select 1 from public.client_assignments ca
    where ca.client_id = _client_id and ca.user_id = _user_id
  );
  if v_rank = 1 and not v_is_assigned then
    return false;
  end if;
  if _action = 'view' then
    return true;
  elsif _action in ('connect','sync') then
    select exists (
      select 1 from public.user_roles ur
      where ur.user_id = _user_id and ur.role = 'accountant'
    ) into v_is_accountant;
    return v_is_admin or (v_is_accountant and v_is_assigned);
  elsif _action in ('disconnect','approve') then
    return v_is_admin;
  end if;
  return false;
end;
$function$;

revoke all on function private.can_access_integration_client(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.can_access_integration_client(uuid, uuid, text)
  to service_role;

create or replace function public.integration_client_access_check(
  _user_id uuid,
  _client_id uuid,
  _action text
)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  select private.can_access_integration_client(_user_id, _client_id, _action);
$function$;

comment on function public.integration_client_access_check(uuid, uuid, text) is
  'Server-only permission check for integration actions. Execute using service_role only; never expose service_role credentials to clients.';

revoke all on function public.integration_client_access_check(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.integration_client_access_check(uuid, uuid, text)
  to service_role;

alter table public.client_integrations enable row level security;
alter table public.integration_auth_states enable row level security;
alter table public.integration_record_mappings enable row level security;
alter table public.integration_sync_runs enable row level security;
alter table public.integration_webhook_events enable row level security;
alter table public.integration_operations enable row level security;

revoke all privileges on table
  public.client_integrations,
  public.integration_auth_states,
  public.integration_record_mappings,
  public.integration_sync_runs,
  public.integration_webhook_events,
  public.integration_operations
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.client_integrations,
  public.integration_auth_states,
  public.integration_record_mappings,
  public.integration_sync_runs,
  public.integration_webhook_events,
  public.integration_operations
to service_role;

notify pgrst, 'reload schema';
