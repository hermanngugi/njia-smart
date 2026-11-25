-- ============================================================================
-- ICT Assets — inventory of office/individual IT equipment
--
-- One row per asset or asset line (e.g. "Dell Latitude laptop" assigned to
-- one person, or "HP LaserJet printer" shared by the office with
-- assigned_to left null). Fully restricted: only Director/Admin (the only
-- roles holding "full" rank on 'ict_service_desk', per
-- 20260926070000_ict_service_desk_open_access.sql) can see, create, update
-- or delete rows — matching that the Assets stat card is already hidden
-- from everyone else on the ICT Service Desk page.
-- ============================================================================

create table if not exists public.ict_assets (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  quantity      integer not null default 1,
  unit_cost     numeric(14,2),
  purchase_date date,
  assigned_to   uuid references auth.users(id) on delete set null,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.ict_assets is 'ICT-owned equipment (office-shared or individually assigned). Visible/editable to Director/Admin only.';

alter table public.ict_assets enable row level security;

drop trigger if exists ict_assets_updated_at on public.ict_assets;
create trigger ict_assets_updated_at
  before update on public.ict_assets
  for each row execute function public.set_updated_at();

drop policy if exists "ict assets full module only" on public.ict_assets;
create policy "ict assets full module only" on public.ict_assets
  for all to authenticated
  using (public.has_full_module(auth.uid(), 'ict_service_desk'))
  with check (public.has_full_module(auth.uid(), 'ict_service_desk'));

grant select, insert, update, delete on public.ict_assets to authenticated;
grant all on public.ict_assets to service_role;
