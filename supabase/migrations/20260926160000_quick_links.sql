-- ============================================================================
-- Quick Links — shared list of external portals the firm uses (iTax, eTIMS, ...)
--
--   * Every staff member can read the list.
--   * Only Director/Admin (is_admin) can add, edit or delete links.
--   * Seeded once with common links; edit or add more from the app.
-- ============================================================================

create table if not exists public.quick_links (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  url         text not null check (url ~* '^https?://'),   -- blocks javascript:/data: links
  category    text not null default 'General',
  description text,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.quick_links enable row level security;

drop trigger if exists quick_links_updated_at on public.quick_links;
create trigger quick_links_updated_at
  before update on public.quick_links
  for each row execute function public.set_updated_at();

drop policy if exists "quick links select staff" on public.quick_links;
create policy "quick links select staff" on public.quick_links
  for select to authenticated using (public.is_staff(auth.uid()));

drop policy if exists "quick links manage admin" on public.quick_links;
create policy "quick links manage admin" on public.quick_links
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

grant select, insert, update, delete on public.quick_links to authenticated;
grant all on public.quick_links to service_role;

-- Seed (only if the table is empty). iTax and eTIMS addresses were checked;
-- confirm the rest and correct any from the app.
insert into public.quick_links (title, url, category, description, sort_order)
select * from (values
  ('KRA iTax',  'https://itax.kra.go.ke/KRA-Portal/',            'Tax & Compliance', 'File returns, pay tax, PIN and TCC services', 10),
  ('KRA eTIMS', 'https://etims.kra.go.ke/basic/login/index',      'Tax & Compliance', 'Electronic tax invoice management', 20),
  ('KRA website', 'https://www.kra.go.ke',                        'Tax & Compliance', 'Notices, forms and publications', 30),
  ('eCitizen',  'https://www.ecitizen.go.ke',                     'Business Registration', 'Government services portal', 40),
  ('Business Registration Service (BRS)', 'https://brs.go.ke',    'Business Registration', 'Company and business name registration, CR12 searches', 50),
  ('NSSF',      'https://www.nssf.or.ke',                         'Statutory & Payroll', 'National Social Security Fund', 60),
  ('SHA',       'https://sha.go.ke',                              'Statutory & Payroll', 'Social Health Authority', 70),
  ('NITA',      'https://www.nita.go.ke',                         'Statutory & Payroll', 'National Industrial Training Authority', 80),
  ('ICPAK',     'https://www.icpak.com',                          'Professional & Reference', 'Institute of Certified Public Accountants of Kenya', 90),
  ('Kenya Law', 'https://kenyalaw.org',                           'Professional & Reference', 'Acts, case law and legal notices', 100)
) as v(title, url, category, description, sort_order)
where not exists (select 1 from public.quick_links);
