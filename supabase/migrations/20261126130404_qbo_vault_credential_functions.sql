-- Vault-backed QuickBooks credential operations.
-- Public wrappers are SECURITY INVOKER and executable only by service_role.
-- The private implementations perform the minimum required Vault operations.

create or replace function private.qbo_store_credentials(
  _integration_id uuid,
  _credentials jsonb,
  _access_token_expires_at timestamptz,
  _refresh_token_expires_at timestamptz,
  _connected_by uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $function$
declare
  v_secret_id uuid;
  v_provider text;
  v_environment text;
  v_realm_id text;
begin
  if _credentials is null or jsonb_typeof(_credentials) <> 'object'
     or nullif(_credentials->>'access_token','') is null
     or nullif(_credentials->>'refresh_token','') is null
     or nullif(_credentials->>'token_type','') is null then
    raise exception 'Invalid QuickBooks credential bundle'
      using errcode = '22023';
  end if;

  select credential_secret_id, provider, environment, external_account_id
    into v_secret_id, v_provider, v_environment, v_realm_id
  from public.client_integrations
  where id = _integration_id
  for update;

  if not found then
    raise exception 'QuickBooks integration not found'
      using errcode = 'P0002';
  end if;

  if v_provider <> 'quickbooks_online' or v_environment <> 'sandbox'
     or v_realm_id is null then
    raise exception 'Only configured QuickBooks sandbox integrations can store credentials'
      using errcode = '22023';
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      _credentials::text,
      'qbo_connection_' || _integration_id::text,
      'Encrypted QuickBooks OAuth credentials for integration ' || _integration_id::text,
      null
    );
  else
    perform vault.update_secret(
      v_secret_id,
      _credentials::text,
      null,
      'Encrypted QuickBooks OAuth credentials for integration ' || _integration_id::text,
      null
    );
  end if;

  update public.client_integrations
  set credential_secret_id = v_secret_id,
      status = 'connected',
      access_token_expires_at = _access_token_expires_at,
      refresh_token_expires_at = _refresh_token_expires_at,
      token_updated_at = now(),
      connected_by = coalesce(_connected_by, connected_by),
      last_connected_at = coalesce(last_connected_at, now()),
      last_error_code = null,
      last_error_at = null,
      refresh_lock_id = null,
      refresh_lock_expires_at = null,
      updated_at = now()
  where id = _integration_id;
end;
$function$;

create or replace function private.qbo_read_credentials(_integration_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, vault
as $function$
declare
  v_credentials jsonb;
begin
  select ds.decrypted_secret::jsonb
    into v_credentials
  from public.client_integrations i
  join vault.decrypted_secrets ds on ds.id = i.credential_secret_id
  where i.id = _integration_id
    and i.provider = 'quickbooks_online'
    and i.environment = 'sandbox'
    and i.status in ('connected','reconnect_required');

  if not found then
    raise exception 'QuickBooks credentials are unavailable'
      using errcode = 'P0002';
  end if;

  return v_credentials;
end;
$function$;

create or replace function private.qbo_clear_credentials(_integration_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $function$
declare
  v_secret_id uuid;
begin
  select credential_secret_id into v_secret_id
  from public.client_integrations
  where id = _integration_id
    and provider = 'quickbooks_online'
    and environment = 'sandbox'
  for update;

  if not found then
    return false;
  end if;

  update public.client_integrations
  set credential_secret_id = null,
      status = 'disconnected',
      access_token_expires_at = null,
      refresh_token_expires_at = null,
      token_updated_at = null,
      refresh_lock_id = null,
      refresh_lock_expires_at = null,
      last_error_code = null,
      last_error_at = null,
      updated_at = now()
  where id = _integration_id;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;

  return true;
end;
$function$;

create or replace function private.qbo_try_acquire_refresh_lock(
  _integration_id uuid,
  _lock_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_acquired boolean := false;
begin
  if _integration_id is null or _lock_id is null then
    return false;
  end if;

  update public.client_integrations
  set refresh_lock_id = _lock_id,
      refresh_lock_expires_at = now() + interval '90 seconds',
      updated_at = now()
  where id = _integration_id
    and provider = 'quickbooks_online'
    and environment = 'sandbox'
    and status = 'connected'
    and (
      refresh_lock_id is null
      or refresh_lock_expires_at is null
      or refresh_lock_expires_at <= now()
    )
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$function$;

create or replace function private.qbo_release_refresh_lock(
  _integration_id uuid,
  _lock_id uuid
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.client_integrations
  set refresh_lock_id = null,
      refresh_lock_expires_at = null,
      updated_at = now()
  where id = _integration_id
    and refresh_lock_id = _lock_id;
$function$;

create or replace function private.qbo_mark_reconnect_required(
  _integration_id uuid,
  _error_code text
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.client_integrations
  set status = 'reconnect_required',
      last_error_code = left(coalesce(_error_code, 'reauthorization_required'), 80),
      last_error_at = now(),
      refresh_lock_id = null,
      refresh_lock_expires_at = null,
      updated_at = now()
  where id = _integration_id
    and provider = 'quickbooks_online'
    and environment = 'sandbox'
    and status <> 'disconnected';
$function$;

create or replace function public.qbo_store_credentials(
  _integration_id uuid,
  _credentials jsonb,
  _access_token_expires_at timestamptz,
  _refresh_token_expires_at timestamptz,
  _connected_by uuid
)
returns void
language sql
security invoker
set search_path = pg_catalog, public, private
as $function$
  select private.qbo_store_credentials(
    _integration_id, _credentials, _access_token_expires_at,
    _refresh_token_expires_at, _connected_by
  );
$function$;

create or replace function public.qbo_read_credentials(_integration_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  select private.qbo_read_credentials(_integration_id);
$function$;

create or replace function public.qbo_clear_credentials(_integration_id uuid)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, private
as $function$
  select private.qbo_clear_credentials(_integration_id);
$function$;

create or replace function public.qbo_try_acquire_refresh_lock(
  _integration_id uuid,
  _lock_id uuid
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, private
as $function$
  select private.qbo_try_acquire_refresh_lock(_integration_id, _lock_id);
$function$;

create or replace function public.qbo_release_refresh_lock(
  _integration_id uuid,
  _lock_id uuid
)
returns void
language sql
security invoker
set search_path = pg_catalog, public, private
as $function$
  select private.qbo_release_refresh_lock(_integration_id, _lock_id);
$function$;

create or replace function public.qbo_mark_reconnect_required(
  _integration_id uuid,
  _error_code text
)
returns void
language sql
security invoker
set search_path = pg_catalog, public, private
as $function$
  select private.qbo_mark_reconnect_required(_integration_id, _error_code);
$function$;

revoke all on function private.qbo_store_credentials(uuid,jsonb,timestamptz,timestamptz,uuid) from public, anon, authenticated;
revoke all on function private.qbo_read_credentials(uuid) from public, anon, authenticated;
revoke all on function private.qbo_clear_credentials(uuid) from public, anon, authenticated;
revoke all on function private.qbo_try_acquire_refresh_lock(uuid,uuid) from public, anon, authenticated;
revoke all on function private.qbo_release_refresh_lock(uuid,uuid) from public, anon, authenticated;
revoke all on function private.qbo_mark_reconnect_required(uuid,text) from public, anon, authenticated;

grant execute on function private.qbo_store_credentials(uuid,jsonb,timestamptz,timestamptz,uuid) to service_role;
grant execute on function private.qbo_read_credentials(uuid) to service_role;
grant execute on function private.qbo_clear_credentials(uuid) to service_role;
grant execute on function private.qbo_try_acquire_refresh_lock(uuid,uuid) to service_role;
grant execute on function private.qbo_release_refresh_lock(uuid,uuid) to service_role;
grant execute on function private.qbo_mark_reconnect_required(uuid,text) to service_role;

revoke all on function public.qbo_store_credentials(uuid,jsonb,timestamptz,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.qbo_read_credentials(uuid) from public, anon, authenticated;
revoke all on function public.qbo_clear_credentials(uuid) from public, anon, authenticated;
revoke all on function public.qbo_try_acquire_refresh_lock(uuid,uuid) from public, anon, authenticated;
revoke all on function public.qbo_release_refresh_lock(uuid,uuid) from public, anon, authenticated;
revoke all on function public.qbo_mark_reconnect_required(uuid,text) from public, anon, authenticated;

grant execute on function public.qbo_store_credentials(uuid,jsonb,timestamptz,timestamptz,uuid) to service_role;
grant execute on function public.qbo_read_credentials(uuid) to service_role;
grant execute on function public.qbo_clear_credentials(uuid) to service_role;
grant execute on function public.qbo_try_acquire_refresh_lock(uuid,uuid) to service_role;
grant execute on function public.qbo_release_refresh_lock(uuid,uuid) to service_role;
grant execute on function public.qbo_mark_reconnect_required(uuid,text) to service_role;

notify pgrst, 'reload schema';
