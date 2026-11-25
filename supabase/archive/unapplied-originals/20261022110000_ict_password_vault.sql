-- ICT Password Vault
-- Credential payloads are encrypted in the browser with AES-GCM before they
-- reach Supabase. The database stores ciphertext, IV and vault configuration;
-- it never stores the master passphrase or a plaintext credential payload.

create table if not exists public.ict_password_vault_config (
  id boolean primary key default true check (id = true),
  salt text not null,
  verification_iv text not null,
  verification_ciphertext text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ict_password_vault (
  id uuid primary key default gen_random_uuid(),
  encrypted_data text not null,
  iv text not null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ict_password_vault_updated_at_idx
  on public.ict_password_vault (updated_at desc);

alter table public.ict_password_vault_config enable row level security;
alter table public.ict_password_vault enable row level security;

-- The vault is intentionally restricted to ICT Officer, Director and Admin.
-- This is separate from the ordinary ICT Service Desk permissions.
drop policy if exists "ICT vault config readable by authorised roles" on public.ict_password_vault_config;
create policy "ICT vault config readable by authorised roles"
  on public.ict_password_vault_config for select to authenticated
  using (exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role in ('ict_officer', 'director', 'admin')
  ));

drop policy if exists "ICT vault config initialised by authorised roles" on public.ict_password_vault_config;
create policy "ICT vault config initialised by authorised roles"
  on public.ict_password_vault_config for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role in ('ict_officer', 'director', 'admin')
    )
  );

-- Vault entries: authorised operators can read, create, update and delete.
drop policy if exists "ICT vault entries accessible by authorised roles" on public.ict_password_vault;
create policy "ICT vault entries accessible by authorised roles"
  on public.ict_password_vault for select to authenticated
  using (exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role in ('ict_officer', 'director', 'admin')
  ));

drop policy if exists "ICT vault entries created by authorised roles" on public.ict_password_vault;
create policy "ICT vault entries created by authorised roles"
  on public.ict_password_vault for insert to authenticated
  with check (
    created_by = auth.uid()
    and updated_by = auth.uid()
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role in ('ict_officer', 'director', 'admin')
    )
  );

drop policy if exists "ICT vault entries updated by authorised roles" on public.ict_password_vault;
create policy "ICT vault entries updated by authorised roles"
  on public.ict_password_vault for update to authenticated
  using (exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role in ('ict_officer', 'director', 'admin')
  ))
  with check (
    updated_by = auth.uid()
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role in ('ict_officer', 'director', 'admin')
    )
  );

drop policy if exists "ICT vault entries deleted by authorised roles" on public.ict_password_vault;
create policy "ICT vault entries deleted by authorised roles"
  on public.ict_password_vault for delete to authenticated
  using (exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role in ('ict_officer', 'director', 'admin')
  ));

grant select, insert on public.ict_password_vault_config to authenticated;
grant select, insert, update, delete on public.ict_password_vault to authenticated;
grant all on public.ict_password_vault_config to service_role;
grant all on public.ict_password_vault to service_role;
