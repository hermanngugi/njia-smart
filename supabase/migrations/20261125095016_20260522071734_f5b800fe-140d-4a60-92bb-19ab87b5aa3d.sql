
-- ENUMS
create type public.app_role as enum ('director','admin','audit_manager','tax_consultant','advisory_officer','accountant','accounts_assistant','intern');
create type public.client_status as enum ('not_started','in_progress','waiting_for_documents','under_review','filed','completed','overdue','urgent');
create type public.engagement_type as enum ('audit','tax','advisory');
create type public.engagement_status as enum ('not_started','in_progress','under_review','completed');
create type public.tax_return_type as enum ('vat','paye','corp_tax','tot','wht','rental','nil');
create type public.tax_return_status as enum ('pending','in_progress','filed','overdue');
create type public.task_priority as enum ('low','normal','high','urgent');
create type public.task_status as enum ('todo','in_progress','blocked','done');

-- PROFILES
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  department text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- USER ROLES
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id)
$$;

create or replace function public.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('director','admin'))
$$;

-- Auto-create profile + first user becomes director
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare _count int;
begin
  insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  select count(*) into _count from public.user_roles;
  if _count = 0 then
    insert into public.user_roles (user_id, role) values (new.id, 'director');
  end if;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- CLIENTS
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  kra_pin text,
  reg_number text,
  industry text,
  email text,
  phone text,
  engagement_type text,
  status public.client_status not null default 'not_started',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients enable row level security;

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  role text,
  email text,
  phone text
);
alter table public.client_contacts enable row level security;

create table public.client_assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_on_engagement text,
  created_at timestamptz not null default now(),
  unique(client_id, user_id)
);
alter table public.client_assignments enable row level security;

-- ENGAGEMENTS
create table public.engagements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  type public.engagement_type not null,
  title text not null,
  status public.engagement_status not null default 'not_started',
  start_date date,
  due_date date,
  completion_pct int not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.engagements enable row level security;

create table public.audit_workpapers (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  title text not null,
  file_path text,
  uploaded_by uuid references auth.users(id),
  version int not null default 1,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.audit_workpapers enable row level security;

create table public.audit_review_notes (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  author_id uuid references auth.users(id),
  body text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.audit_review_notes enable row level security;

-- TAX RETURNS
create table public.tax_returns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  return_type public.tax_return_type not null,
  period_start date,
  period_end date,
  due_date date not null,
  status public.tax_return_status not null default 'pending',
  ack_file_path text,
  assigned_to uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);
alter table public.tax_returns enable row level security;

-- ADVISORY
create table public.advisory_projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  description text,
  status public.engagement_status not null default 'not_started',
  due_date date,
  created_at timestamptz not null default now()
);
alter table public.advisory_projects enable row level security;

create table public.advisory_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.advisory_projects(id) on delete cascade,
  title text not null,
  due_date date,
  done boolean not null default false
);
alter table public.advisory_milestones enable row level security;

-- TASKS
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  client_id uuid references public.clients(id) on delete set null,
  engagement_id uuid references public.engagements(id) on delete set null,
  assigned_to uuid references auth.users(id),
  created_by uuid references auth.users(id),
  priority public.task_priority not null default 'normal',
  status public.task_status not null default 'todo',
  due_date date,
  is_overdue boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.tasks enable row level security;

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.task_comments enable row level security;

-- ANNOUNCEMENTS / NOTIFICATIONS
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users(id),
  title text not null,
  body text not null,
  audience text default 'all',
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;

-- DOCUMENTS
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  engagement_id uuid references public.engagements(id) on delete set null,
  title text not null,
  file_path text not null,
  version int not null default 1,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.documents enable row level security;

-- COMPLIANCE / ACTIVITY
create table public.compliance_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_date date not null,
  recurrence text not null default 'once',
  category text,
  notes text
);
alter table public.compliance_events enable row level security;

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text,
  entity_id uuid,
  meta jsonb,
  created_at timestamptz not null default now()
);
alter table public.activity_log enable row level security;

-- ============== RLS POLICIES ==============
-- Profiles
create policy "profiles select staff" on public.profiles for select to authenticated using (public.is_staff(auth.uid()));
create policy "profiles update self" on public.profiles for update to authenticated using (id = auth.uid());
create policy "profiles admin update" on public.profiles for update to authenticated using (public.is_admin(auth.uid()));

-- user_roles
create policy "roles select staff" on public.user_roles for select to authenticated using (public.is_staff(auth.uid()) or user_id = auth.uid());
create policy "roles admin manage" on public.user_roles for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Clients (staff can view; create/update by staff; delete admin)
create policy "clients select staff" on public.clients for select to authenticated using (public.is_staff(auth.uid()));
create policy "clients insert staff" on public.clients for insert to authenticated with check (public.is_staff(auth.uid()));
create policy "clients update staff" on public.clients for update to authenticated using (public.is_staff(auth.uid()));
create policy "clients delete admin" on public.clients for delete to authenticated using (public.is_admin(auth.uid()));

-- Generic staff policies helper via repeated grants
create policy "contacts all staff" on public.client_contacts for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "assignments all staff" on public.client_assignments for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "engagements all staff" on public.engagements for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "workpapers all staff" on public.audit_workpapers for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "review notes all staff" on public.audit_review_notes for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "tax returns all staff" on public.tax_returns for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "advisory projects all staff" on public.advisory_projects for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "advisory milestones all staff" on public.advisory_milestones for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "tasks all staff" on public.tasks for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "task comments all staff" on public.task_comments for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "announcements select staff" on public.announcements for select to authenticated using (public.is_staff(auth.uid()));
create policy "announcements insert admin" on public.announcements for insert to authenticated with check (public.is_admin(auth.uid()));
create policy "announcements update admin" on public.announcements for update to authenticated using (public.is_admin(auth.uid()));
create policy "announcements delete admin" on public.announcements for delete to authenticated using (public.is_admin(auth.uid()));
create policy "notifications select own" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notifications update own" on public.notifications for update to authenticated using (user_id = auth.uid());
create policy "notifications insert staff" on public.notifications for insert to authenticated with check (public.is_staff(auth.uid()));
create policy "documents all staff" on public.documents for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "compliance select staff" on public.compliance_events for select to authenticated using (public.is_staff(auth.uid()));
create policy "compliance admin manage" on public.compliance_events for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "activity select admin" on public.activity_log for select to authenticated using (public.is_admin(auth.uid()));
create policy "activity insert staff" on public.activity_log for insert to authenticated with check (public.is_staff(auth.uid()));

-- Storage buckets
insert into storage.buckets (id, name, public) values
  ('client-documents','client-documents', false),
  ('audit-workpapers','audit-workpapers', false),
  ('tax-acks','tax-acks', false),
  ('avatars','avatars', true)
  on conflict (id) do nothing;

create policy "staff read client docs" on storage.objects for select to authenticated using (bucket_id in ('client-documents','audit-workpapers','tax-acks') and public.is_staff(auth.uid()));
create policy "staff write client docs" on storage.objects for insert to authenticated with check (bucket_id in ('client-documents','audit-workpapers','tax-acks') and public.is_staff(auth.uid()));
create policy "staff update client docs" on storage.objects for update to authenticated using (bucket_id in ('client-documents','audit-workpapers','tax-acks') and public.is_staff(auth.uid()));
create policy "staff delete client docs" on storage.objects for delete to authenticated using (bucket_id in ('client-documents','audit-workpapers','tax-acks') and public.is_admin(auth.uid()));
create policy "avatars public read" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars auth write" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');

-- Seed compliance events (monthly Kenyan tax deadlines for current month as anchor; UI will project recurrence)
insert into public.compliance_events (title, event_date, recurrence, category, notes) values
  ('VAT Return Due', (date_trunc('month', now()) + interval '19 days')::date, 'monthly', 'tax', 'VAT returns due 20th of each month'),
  ('PAYE Return Due', (date_trunc('month', now()) + interval '8 days')::date, 'monthly', 'tax', 'PAYE due 9th of each month'),
  ('Withholding Tax Due', (date_trunc('month', now()) + interval '19 days')::date, 'monthly', 'tax', 'WHT due 20th of each month'),
  ('Rental Income Tax', (date_trunc('month', now()) + interval '19 days')::date, 'monthly', 'tax', 'MRI due 20th of each month'),
  ('Turnover Tax Due', (date_trunc('month', now()) + interval '19 days')::date, 'monthly', 'tax', 'TOT due 20th of following month'),
  ('Corporation Tax Installment', (date_trunc('year', now()) + interval '3 months 19 days')::date, 'annual', 'tax', 'Quarterly installments'),
  ('New Year Day', (date_trunc('year', now()))::date, 'annual', 'holiday', null),
  ('Labour Day', (date_trunc('year', now()) + interval '4 months')::date, 'annual', 'holiday', null),
  ('Madaraka Day', (date_trunc('year', now()) + interval '5 months')::date, 'annual', 'holiday', null),
  ('Mashujaa Day', (date_trunc('year', now()) + interval '9 months 19 days')::date, 'annual', 'holiday', null),
  ('Jamhuri Day', (date_trunc('year', now()) + interval '11 months 11 days')::date, 'annual', 'holiday', null),
  ('Christmas Day', (date_trunc('year', now()) + interval '11 months 24 days')::date, 'annual', 'holiday', null),
  ('Boxing Day', (date_trunc('year', now()) + interval '11 months 25 days')::date, 'annual', 'holiday', null);
