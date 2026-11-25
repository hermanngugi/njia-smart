-- ============================================================================
-- ICT Service Desk — service templates & ticket checklists
--
-- The ICT equivalent of the Advisory service-template system:
--   ict_service_templates -> ict_template_controls -> ict_case_controls
--
-- * Every ticket has a service_type. Raising a ticket copies the active
--   template's checklist onto it (a snapshot, so later template edits never
--   rewrite work already in progress).
-- * Steps can require an evidence note, and some also require a second person
--   to verify them (four-eyes). Both rules, plus the "mandatory steps must be
--   finished before a ticket is Resolved/Closed" rule, are enforced here in
--   the database — the UI only reflects them.
-- * New service types need no migration: an Admin inserts a template (and its
--   controls) and it appears in the ticket form.
--
-- Who can do what (unchanged from the existing Service Desk rules):
--   ICT work   = full Service Desk module (Admin / Director / ICT Officer)
--                or a member of ict_service_desk_team.
--   Reporters  = see (read-only) the checklist on their own tickets.
--   Templates  = readable by all staff, managed by full-module roles only.
-- Checklist content is operational guidance, not legal advice.
-- ============================================================================

-- ---------- who may work ICT tickets ---------------------------------------
create or replace function public.can_work_ict(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_full_module(_user_id, 'ict_service_desk')
      or public.is_ict_team(_user_id)
$$;
grant execute on function public.can_work_ict(uuid) to authenticated;

-- ---------- tickets get a service type -------------------------------------
alter table public.ict_tickets
  add column if not exists service_type text not null default 'general';

-- ---------- templates ------------------------------------------------------
create table if not exists public.ict_service_templates (
  id           uuid primary key default gen_random_uuid(),
  service_type text not null check (service_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  version      integer not null default 1 check (version > 0),
  title        text not null,
  description  text,
  sort_order   integer not null default 100,
  active       boolean not null default true,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (service_type, version)
);
-- one live version per service type
create unique index if not exists ict_service_templates_one_active_uidx
  on public.ict_service_templates (service_type) where active;

create table if not exists public.ict_template_controls (
  id                    uuid primary key default gen_random_uuid(),
  template_id           uuid not null references public.ict_service_templates(id) on delete cascade,
  control_key           text not null,
  category              text not null default 'general',
  title                 text not null,
  guidance              text,
  evidence_hint         text,
  mandatory             boolean not null default true,
  requires_evidence     boolean not null default false,
  requires_verification boolean not null default false,
  sort_order            integer not null default 100,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  unique (template_id, control_key)
);

-- ---------- per-ticket checklist (snapshot of the template) ----------------
create table if not exists public.ict_case_controls (
  id                    uuid primary key default gen_random_uuid(),
  ticket_id             uuid not null references public.ict_tickets(id) on delete cascade,
  template_control_id   uuid references public.ict_template_controls(id) on delete set null,
  control_key           text not null,
  category              text not null default 'general',
  title                 text not null,
  guidance              text,
  evidence_hint         text,
  mandatory             boolean not null default true,
  requires_evidence     boolean not null default false,
  requires_verification boolean not null default false,
  sort_order            integer not null default 100,
  status                text not null default 'not_started'
    check (status in ('not_started','in_progress','blocked','done','verified','not_applicable')),
  evidence_note         text,
  assigned_to           uuid references auth.users(id) on delete set null,
  due_date              date,
  completed_by          uuid references auth.users(id) on delete set null,
  completed_at          timestamptz,
  verified_by           uuid references auth.users(id) on delete set null,
  verified_at           timestamptz,
  created_by            uuid references auth.users(id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (ticket_id, control_key)
);

create index if not exists ict_template_controls_template_idx on public.ict_template_controls (template_id, active, sort_order);
create index if not exists ict_case_controls_ticket_idx on public.ict_case_controls (ticket_id, sort_order);
create index if not exists ict_case_controls_open_idx on public.ict_case_controls (status, due_date) where status not in ('done','verified','not_applicable');
create index if not exists ict_tickets_service_type_idx on public.ict_tickets (service_type);

-- ---------- row level security ---------------------------------------------
alter table public.ict_service_templates enable row level security;
alter table public.ict_template_controls enable row level security;
alter table public.ict_case_controls     enable row level security;

drop policy if exists "ict templates read staff" on public.ict_service_templates;
create policy "ict templates read staff" on public.ict_service_templates
  for select to authenticated using (public.is_staff(auth.uid()));
drop policy if exists "ict templates manage full" on public.ict_service_templates;
create policy "ict templates manage full" on public.ict_service_templates
  for all to authenticated
  using (public.has_full_module(auth.uid(), 'ict_service_desk'))
  with check (public.has_full_module(auth.uid(), 'ict_service_desk'));

drop policy if exists "ict template controls read staff" on public.ict_template_controls;
create policy "ict template controls read staff" on public.ict_template_controls
  for select to authenticated using (public.is_staff(auth.uid()));
drop policy if exists "ict template controls manage full" on public.ict_template_controls;
create policy "ict template controls manage full" on public.ict_template_controls
  for all to authenticated
  using (public.has_full_module(auth.uid(), 'ict_service_desk'))
  with check (public.has_full_module(auth.uid(), 'ict_service_desk'));

-- A checklist is visible to exactly the people who can see its ticket
-- (the sub-select is itself filtered by the ict_tickets policies).
drop policy if exists "ict case controls read" on public.ict_case_controls;
create policy "ict case controls read" on public.ict_case_controls
  for select to authenticated
  using (exists (select 1 from public.ict_tickets t where t.id = ict_case_controls.ticket_id));

-- ICT staff may add ad-hoc steps to a ticket (never mandatory ones — only the
-- full-module roles can add a mandatory step).
drop policy if exists "ict case controls insert" on public.ict_case_controls;
create policy "ict case controls insert" on public.ict_case_controls
  for insert to authenticated
  with check (
    public.can_work_ict(auth.uid())
    and exists (select 1 from public.ict_tickets t where t.id = ict_case_controls.ticket_id)
    and (mandatory = false or public.has_full_module(auth.uid(), 'ict_service_desk'))
  );

drop policy if exists "ict case controls update" on public.ict_case_controls;
create policy "ict case controls update" on public.ict_case_controls
  for update to authenticated
  using (public.can_work_ict(auth.uid()) and exists (select 1 from public.ict_tickets t where t.id = ict_case_controls.ticket_id))
  with check (public.can_work_ict(auth.uid()) and exists (select 1 from public.ict_tickets t where t.id = ict_case_controls.ticket_id));

-- Template-derived steps can only be removed by the full-module roles; ICT
-- staff may remove an ad-hoc step they added that has not been started.
drop policy if exists "ict case controls delete" on public.ict_case_controls;
create policy "ict case controls delete" on public.ict_case_controls
  for delete to authenticated
  using (
    public.has_full_module(auth.uid(), 'ict_service_desk')
    or (public.can_work_ict(auth.uid()) and template_control_id is null and status = 'not_started')
  );

grant select on public.ict_service_templates, public.ict_template_controls to authenticated;
grant insert, update, delete on public.ict_service_templates, public.ict_template_controls to authenticated; -- RLS: full module only
grant select, insert, update, delete on public.ict_case_controls to authenticated;
grant all on public.ict_service_templates, public.ict_template_controls, public.ict_case_controls to service_role;

-- ---------- ticket service_type validation ---------------------------------
-- A ticket must use a service type that has an active template. The type can
-- only change while no template step has been started (otherwise real work
-- would be thrown away); the checklist is then re-seeded.
create or replace function public.validate_ict_ticket_service_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.service_type := coalesce(nullif(btrim(new.service_type), ''), 'general');

  if not exists (select 1 from public.ict_service_templates t where t.service_type = new.service_type and t.active) then
    raise exception 'Unknown ICT service type "%".', new.service_type using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' and new.service_type is distinct from old.service_type then
    if auth.uid() is not null and not public.can_work_ict(auth.uid()) then
      raise exception 'Only the ICT team can change a ticket''s service type.' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.ict_case_controls c
      where c.ticket_id = new.id and c.template_control_id is not null
        and (c.status <> 'not_started' or nullif(btrim(coalesce(c.evidence_note, '')), '') is not null)
    ) then
      raise exception 'Work on this ticket''s checklist has already started, so its service type can no longer be changed.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_validate_ict_ticket_service_type on public.ict_tickets;
create trigger trg_validate_ict_ticket_service_type
  before insert or update of service_type on public.ict_tickets
  for each row execute function public.validate_ict_ticket_service_type();

-- ---------- seeding the checklist onto a ticket ----------------------------
-- Idempotent: adds any active template steps the ticket doesn't have yet.
create or replace function public.seed_ict_ticket_controls(_ticket_id uuid, _service_type text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare _n integer;
begin
  insert into public.ict_case_controls
    (ticket_id, template_control_id, control_key, category, title, guidance, evidence_hint,
     mandatory, requires_evidence, requires_verification, sort_order)
  select _ticket_id, c.id, c.control_key, c.category, c.title, c.guidance, c.evidence_hint,
         c.mandatory, c.requires_evidence, c.requires_verification, c.sort_order
  from public.ict_service_templates t
  join public.ict_template_controls c on c.template_id = t.id and c.active
  where t.service_type = _service_type and t.active
  on conflict (ticket_id, control_key) do nothing;
  get diagnostics _n = row_count;
  return _n;
end $$;

create or replace function public.trg_seed_ict_ticket_controls()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    -- type changed (validated as safe above): drop the old, untouched template steps
    delete from public.ict_case_controls
    where ticket_id = new.id and template_control_id is not null and status = 'not_started';
  end if;
  perform public.seed_ict_ticket_controls(new.id, new.service_type);
  return new;
end $$;

drop trigger if exists trg_ict_tickets_seed_controls on public.ict_tickets;
create trigger trg_ict_tickets_seed_controls
  after insert on public.ict_tickets
  for each row execute function public.trg_seed_ict_ticket_controls();

drop trigger if exists trg_ict_tickets_reseed_controls on public.ict_tickets;
create trigger trg_ict_tickets_reseed_controls
  after update of service_type on public.ict_tickets
  for each row when (old.service_type is distinct from new.service_type)
  execute function public.trg_seed_ict_ticket_controls();

-- "Add / sync checklist" button: older tickets (raised before this feature) and
-- tickets whose template gained new steps. Never removes anything.
create or replace function public.sync_ict_ticket_checklist(_ticket_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare _type text;
begin
  if auth.uid() is null or not public.can_work_ict(auth.uid()) then
    raise exception 'Only the ICT team can add a checklist.' using errcode = '42501';
  end if;
  select service_type into _type from public.ict_tickets where id = _ticket_id;
  if _type is null then
    raise exception 'Ticket not found.' using errcode = 'P0002';
  end if;
  return public.seed_ict_ticket_controls(_ticket_id, _type);
end $$;
grant execute on function public.sync_ict_ticket_checklist(uuid) to authenticated;

-- ---------- checklist step rules (the heart of the gating) -------------------
create or replace function public.guard_ict_case_control_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid   uuid := auth.uid();
  _full  boolean;
  _closed boolean;
begin
  _full := _uid is not null and public.has_full_module(_uid, 'ict_service_desk');

  if _uid is not null and not public.can_work_ict(_uid) then
    raise exception 'Only the ICT team can update ticket checklists.' using errcode = '42501';
  end if;

  select (t.status = 'Closed') into _closed from public.ict_tickets t where t.id = old.ticket_id;
  if coalesce(_closed, false) and not _full then
    raise exception 'This ticket is closed. Ask an ICT admin to reopen it before changing its checklist.' using errcode = '42501';
  end if;

  -- Completion / verification stamps are written only by this trigger (below),
  -- never taken from the client.
  new.completed_by := old.completed_by; new.completed_at := old.completed_at;
  new.verified_by  := old.verified_by;  new.verified_at  := old.verified_at;

  -- Step definitions are protected. ICT staff may only retitle their own ad-hoc steps.
  if not _full and (
       new.id is distinct from old.id or new.ticket_id is distinct from old.ticket_id
    or new.template_control_id is distinct from old.template_control_id
    or new.control_key is distinct from old.control_key or new.category is distinct from old.category
    or new.mandatory is distinct from old.mandatory
    or new.requires_evidence is distinct from old.requires_evidence
    or new.requires_verification is distinct from old.requires_verification
    or new.sort_order is distinct from old.sort_order
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
    or (old.template_control_id is not null
        and (new.title is distinct from old.title or new.guidance is distinct from old.guidance
             or new.evidence_hint is distinct from old.evidence_hint))
  ) then
    raise exception 'Only an ICT admin can change a checklist step''s definition.' using errcode = '42501';
  end if;

  -- A verified step is locked: only a full-module role may reopen or edit it.
  if old.status = 'verified' and not _full then
    raise exception 'This step has been verified and is locked. Only an ICT admin can reopen it.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if new.status in ('done', 'verified') and new.requires_evidence
       and nullif(btrim(coalesce(new.evidence_note, '')), '') is null then
      raise exception 'Add an evidence note before marking "%" as %.', new.title,
        case new.status when 'done' then 'done' else 'verified' end using errcode = '22023';
    end if;
    if new.status = 'not_applicable' and nullif(btrim(coalesce(new.evidence_note, '')), '') is null then
      raise exception 'Say why "%" is not applicable before marking it so.', new.title using errcode = '22023';
    end if;
    if new.status = 'blocked' and nullif(btrim(coalesce(new.evidence_note, '')), '') is null then
      raise exception 'Say what is blocking "%" before marking it blocked.', new.title using errcode = '22023';
    end if;

    if new.status = 'done' then
      new.completed_by := coalesce(_uid, new.completed_by);
      new.completed_at := now();
      new.verified_by := null; new.verified_at := null;
    elsif new.status = 'verified' then
      if not new.requires_verification then
        raise exception 'The step "%" does not need verification — mark it done instead.', new.title using errcode = '22023';
      end if;
      if old.status <> 'done' then
        raise exception 'A step must be marked done before it can be verified.' using errcode = '22023';
      end if;
      if _uid is not null and old.completed_by is not null and old.completed_by = _uid then
        raise exception 'A different ICT team member (or admin) must verify "%" — you completed it.', new.title using errcode = '42501';
      end if;
      new.verified_by := coalesce(_uid, new.verified_by);
      new.verified_at := now();
    elsif new.status = 'not_applicable' then
      new.completed_by := coalesce(_uid, new.completed_by);
      new.completed_at := now();
      new.verified_by := null; new.verified_at := null;
    else
      -- not_started / in_progress / blocked: no completion or verification stands
      new.completed_by := null; new.completed_at := null;
      new.verified_by := null;  new.verified_at := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_ict_case_control_update on public.ict_case_controls;
create trigger trg_guard_ict_case_control_update
  before update on public.ict_case_controls
  for each row execute function public.guard_ict_case_control_update();

-- ---------- a started step moves a "New" ticket to "In Progress"; steps that
-- need verification notify the ICT team ---------------------------------------
create or replace function public.after_ict_case_control_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare _tn text; _tt text;
begin
  if new.status is distinct from old.status then
    if new.status in ('in_progress', 'done') then
      update public.ict_tickets set status = 'In Progress' where id = new.ticket_id and status = 'New';
    end if;

    if new.status = 'done' and new.requires_verification then
      select ticket_number, title into _tn, _tt from public.ict_tickets where id = new.ticket_id;
      insert into public.notifications (user_id, type, title, body, link)
      select distinct r.user_id, 'ict_verification',
             'ICT step needs verification ' || coalesce(_tn, ''),
             new.title || ' — ' || coalesce(_tt, 'ticket'),
             '/ict-service-desk'
      from (
        select m.user_id from public.ict_service_desk_team m
        union
        select ur.user_id from public.user_roles ur where ur.role in ('admin', 'ict_officer')
      ) r
      where r.user_id is distinct from new.completed_by;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_after_ict_case_control_update on public.ict_case_controls;
create trigger trg_after_ict_case_control_update
  after update on public.ict_case_controls
  for each row execute function public.after_ict_case_control_update();

-- ---------- the closing gate -------------------------------------------------
-- A ticket cannot move to Resolved/Closed while a mandatory step is still open,
-- or is done but still waiting for its second-person verification. Steps that
-- genuinely don't apply are marked not applicable with a reason.
create or replace function public.guard_ict_ticket_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare _open integer; _list text;
begin
  if new.status in ('Resolved', 'Closed') and (old.status is null or old.status not in ('Resolved', 'Closed')) then
    select count(*) into _open
    from public.ict_case_controls c
    where c.ticket_id = new.id and c.mandatory
      and (c.status not in ('done', 'verified', 'not_applicable')
           or (c.requires_verification and c.status = 'done'));

    if _open > 0 then
      select string_agg(x.title, '; ' order by x.sort_order) into _list
      from (
        select c.title, c.sort_order
        from public.ict_case_controls c
        where c.ticket_id = new.id and c.mandatory
          and (c.status not in ('done', 'verified', 'not_applicable')
               or (c.requires_verification and c.status = 'done'))
        order by c.sort_order
        limit 3
      ) x;
      raise exception 'Cannot mark this ticket % yet: % mandatory checklist step(s) still open (%).',
        new.status, _open, _list || case when _open > 3 then '; …' else '' end
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_ict_ticket_completion on public.ict_tickets;
create trigger trg_guard_ict_ticket_completion
  before update of status on public.ict_tickets
  for each row execute function public.guard_ict_ticket_completion();

-- ---------- activity log, realtime ------------------------------------------
drop trigger if exists trg_log_activity on public.ict_case_controls;
create trigger trg_log_activity
  after update on public.ict_case_controls
  for each row execute function public.log_activity();
-- (inserts and deletes are not logged: seeding or cascading a ticket would add a row per step)

do $$
begin
  begin alter publication supabase_realtime add table public.ict_case_controls; exception when others then null; end;
end $$;

-- ---------- seed: service templates ------------------------------------------
insert into public.ict_service_templates (service_type, version, title, description, sort_order) values
 ('general', 1, 'General ICT request', 'Anything that does not fit another type — a short checklist keeps it accountable.', 10),
 ('incident', 1, 'Incident / fault', 'Something is broken or not working — find the cause, fix it and confirm it with the user.', 20),
 ('access_request', 1, 'Access / account request', 'New or changed access to a system, folder, mailbox or software — approved, least-privilege and checked.', 30),
 ('onboarding', 1, 'New staff setup', 'Prepare accounts, devices and access for a new team member before their first day.', 40),
 ('offboarding', 1, 'Staff exit', 'Remove access and recover equipment when someone leaves — nothing left open after the last day.', 50),
 ('maintenance', 1, 'Planned maintenance', 'Updates, upgrades, backups or hardware work done on a plan — with a backup and a test afterwards.', 60),
 ('security_review', 1, 'Security incident / review', 'Suspected phishing, lost device, malware or possible data exposure — contain, assess, escalate and learn.', 70),
 ('procurement', 1, 'Hardware / software purchase', 'Buying equipment, licences or services — specified, approved, received, recorded and handed over.', 80)
on conflict (service_type, version) do nothing;

-- General ICT request
insert into public.ict_template_controls (template_id, control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
select t.id, v.control_key, v.category, v.title, v.guidance, v.evidence_hint, v.mandatory, v.requires_evidence, v.requires_verification, v.sort_order
from public.ict_service_templates t cross join (values
 ('understand', 'triage', 'Confirm what the requester needs', 'Restate the request and the outcome the requester expects. Ask if anything is unclear.', null::text, true, false, false, 10),
 ('do_work', 'execution', 'Carry out the work', 'Do the work and keep a short note of what was done.', 'What was done, and any reference (device, account, change)', true, true, false, 20),
 ('confirm', 'closeout', 'Confirm with the requester', 'Check with the requester that it works as expected before closing.', 'Who confirmed, and how (in person, chat, email)', true, true, false, 30)
) as v(control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
where t.service_type = 'general' and t.version = 1
on conflict (template_id, control_key) do nothing;

-- Incident / fault
insert into public.ict_template_controls (template_id, control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
select t.id, v.control_key, v.category, v.title, v.guidance, v.evidence_hint, v.mandatory, v.requires_evidence, v.requires_verification, v.sort_order
from public.ict_service_templates t cross join (values
 ('log_impact', 'triage', 'Log symptoms, scope and impact', 'Record what is failing, since when, who and how many people are affected, and whether client work is blocked.', 'Symptoms, start time, affected users/systems', true, true, false, 10),
 ('workaround', 'triage', 'Offer a workaround if the impact is ongoing', 'If the fix will take time, give the user a temporary way to keep working.', null::text, false, false, false, 20),
 ('find_cause', 'execution', 'Identify the cause', 'Check recent changes, connectivity, power, accounts and updates. Note what you ruled out.', 'Cause found, or what was ruled out', true, true, false, 30),
 ('apply_fix', 'execution', 'Apply the fix', 'Make the repair or change. Note anything you replaced or reconfigured.', 'What was changed or replaced', true, true, false, 40),
 ('test_fix', 'execution', 'Test that the service works again', 'Test as the affected user would, not just from the admin side.', 'Test performed and result', true, true, false, 50),
 ('user_confirm', 'closeout', 'Confirm with the affected user', 'Ask the user to confirm the problem is gone before closing.', 'Who confirmed and how', true, true, false, 60),
 ('root_cause', 'closeout', 'Record the root cause and a prevention step', 'For repeat or serious faults, note why it happened and what stops it recurring.', null::text, false, false, false, 70)
) as v(control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
where t.service_type = 'incident' and t.version = 1
on conflict (template_id, control_key) do nothing;

-- Access / account request
insert into public.ict_template_controls (template_id, control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
select t.id, v.control_key, v.category, v.title, v.guidance, v.evidence_hint, v.mandatory, v.requires_evidence, v.requires_verification, v.sort_order
from public.ict_service_templates t cross join (values
 ('identify', 'triage', 'Confirm who is asking and what access they need', 'Confirm the requester and the exact system, folder or role. Be specific — avoid "same as <colleague>".', null::text, true, false, false, 10),
 ('approval', 'triage', 'Get approval from the line manager / system owner', 'Do not grant access on the requester''s word alone.', 'Approval message or reference (who, when)', true, true, false, 20),
 ('grant', 'execution', 'Grant the minimum access needed', 'Give only what the role needs. If it is temporary, set an expiry or review date.', 'What access was granted and any expiry date', true, true, true, 30),
 ('notify', 'closeout', 'Tell the requester how to use it and record the change', 'Confirm access works and note it for future reviews.', 'Confirmation from the requester', true, true, false, 40)
) as v(control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
where t.service_type = 'access_request' and t.version = 1
on conflict (template_id, control_key) do nothing;

-- New staff setup
insert into public.ict_template_controls (template_id, control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
select t.id, v.control_key, v.category, v.title, v.guidance, v.evidence_hint, v.mandatory, v.requires_evidence, v.requires_verification, v.sort_order
from public.ict_service_templates t cross join (values
 ('details', 'triage', 'Confirm start date, role, manager and devices needed', 'Get these from HR or the manager before starting.', null::text, true, false, false, 10),
 ('accounts', 'execution', 'Create the user accounts and email', 'Create accounts with a unique temporary password that must be changed at first sign-in.', 'Accounts created (list)', true, true, false, 20),
 ('mfa', 'security', 'Set up multi-factor sign-in and secure credential handover', 'Enable MFA where supported. Hand over credentials in person or through a secure channel, never in a group chat.', 'MFA enabled where supported', true, true, false, 30),
 ('access', 'execution', 'Assign role-based access', 'Match access to the role and nothing more.', 'Access granted (systems / folders)', true, true, true, 40),
 ('device', 'execution', 'Prepare and issue the device(s)', 'Install standard software, endpoint protection and updates. Record the device in the asset register above.', 'Device tag / serial and who it was issued to', true, true, false, 50),
 ('briefing', 'handover', 'Brief the new staff member on acceptable use and security basics', 'Passwords, phishing, client data handling, who to call for help.', null::text, true, false, false, 60),
 ('confirm_day1', 'closeout', 'Confirm everything works with the new staff member', 'Check sign-in, email, printing and the systems they need.', 'Confirmation from the staff member', true, true, false, 70)
) as v(control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
where t.service_type = 'onboarding' and t.version = 1
on conflict (template_id, control_key) do nothing;

-- Staff exit
insert into public.ict_template_controls (template_id, control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
select t.id, v.control_key, v.category, v.title, v.guidance, v.evidence_hint, v.mandatory, v.requires_evidence, v.requires_verification, v.sort_order
from public.ict_service_templates t cross join (values
 ('details', 'triage', 'Confirm last working day and who takes over their files and mail', 'Agree this with HR and the manager before the last day.', null::text, true, false, false, 10),
 ('disable', 'security', 'Disable accounts and active sessions on the last day', 'Email, shared systems, VPN, remote access and mobile sync.', 'Accounts disabled (list) and time', true, true, true, 20),
 ('groups', 'security', 'Remove from groups, shared folders and mailing lists; revoke tokens', 'Also revoke API keys, app passwords and any linked personal devices.', 'What was removed', true, true, true, 30),
 ('shared_creds', 'security', 'Reset shared credentials the person knew', 'Shared mailboxes, Wi-Fi, portals and any system with a shared login.', 'Which credentials were reset', true, true, false, 40),
 ('equipment', 'handover', 'Recover devices and accessories and update the asset register', 'Laptop, phone, tokens, keys, chargers. Record returns above.', 'Items returned (tag / serial)', true, true, true, 50),
 ('data', 'handover', 'Hand over or archive their mailbox and files as instructed', 'Follow the manager''s written instruction. Do not delete until it is confirmed.', 'Instruction and what was done', true, true, false, 60),
 ('wipe', 'closeout', 'Wipe and prepare returned devices for reuse', 'Only after any needed data has been handed over.', 'Device wiped / reissued', false, true, false, 70)
) as v(control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
where t.service_type = 'offboarding' and t.version = 1
on conflict (template_id, control_key) do nothing;

-- Planned maintenance
insert into public.ict_template_controls (template_id, control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
select t.id, v.control_key, v.category, v.title, v.guidance, v.evidence_hint, v.mandatory, v.requires_evidence, v.requires_verification, v.sort_order
from public.ict_service_templates t cross join (values
 ('scope', 'triage', 'Define the work, who is affected and the maintenance window', 'Choose a time that avoids busy filing and reporting periods where possible.', 'Scope, window and affected users', true, true, false, 10),
 ('notify_before', 'triage', 'Notify affected staff in advance', 'Say what, when and for how long.', 'Notice sent (channel and date)', true, true, false, 20),
 ('backup', 'execution', 'Take a backup and confirm it can be restored', 'A backup that has not been checked is not a backup.', 'Backup taken and restore check done', true, true, true, 30),
 ('perform', 'execution', 'Perform the maintenance', 'Follow the plan and note any deviations.', 'What was done', true, true, false, 40),
 ('test', 'execution', 'Test the systems afterwards', 'Check the key systems staff rely on, not only the one you changed.', 'Tests performed and results', true, true, false, 50),
 ('rollback', 'execution', 'Roll back if testing fails', 'Restore from the backup and reschedule if needed.', null::text, false, false, false, 60),
 ('notify_after', 'closeout', 'Tell staff the work is complete and update records', 'Update asset, licence or configuration records that changed.', 'Completion notice sent', true, true, false, 70)
) as v(control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
where t.service_type = 'maintenance' and t.version = 1
on conflict (template_id, control_key) do nothing;

-- Security incident / review
insert into public.ict_template_controls (template_id, control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
select t.id, v.control_key, v.category, v.title, v.guidance, v.evidence_hint, v.mandatory, v.requires_evidence, v.requires_verification, v.sort_order
from public.ict_service_templates t cross join (values
 ('record', 'triage', 'Record what happened, when and how it was noticed', 'Keep facts separate from guesses. Do not delete evidence.', 'Timeline and who reported it', true, true, false, 10),
 ('contain', 'security', 'Contain it', 'Isolate the device, disable affected accounts, block the sender or reset credentials as needed.', 'What was contained and when', true, true, false, 20),
 ('data_impact', 'security', 'Assess whether client or personal data may be affected', 'If personal or client data may be involved, tell the Director straight away. Breach-notification duties under Kenyan data-protection law can have short deadlines — confirm current requirements with the Office of the Data Protection Commissioner.', 'Assessment and who was informed', true, true, true, 30),
 ('recover', 'execution', 'Remove the cause and recover', 'Clean or rebuild affected devices, patch, reset credentials and restore from backup if needed.', 'Recovery actions taken', true, true, false, 40),
 ('notify_decision', 'closeout', 'Decide on notifying clients, regulators or insurers', 'Record the decision and who made it. Mark not applicable only with a reason.', 'Decision, decision-maker and date', true, true, true, 50),
 ('lessons', 'closeout', 'Record lessons learned and preventive actions', 'What would have prevented or caught it sooner?', 'Actions agreed', true, true, false, 60)
) as v(control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
where t.service_type = 'security_review' and t.version = 1
on conflict (template_id, control_key) do nothing;

-- Hardware / software purchase
insert into public.ict_template_controls (template_id, control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
select t.id, v.control_key, v.category, v.title, v.guidance, v.evidence_hint, v.mandatory, v.requires_evidence, v.requires_verification, v.sort_order
from public.ict_service_templates t cross join (values
 ('spec', 'triage', 'Define the requirement and specification', 'Who needs it, what it must do and the budget.', null::text, true, false, false, 10),
 ('quotes', 'triage', 'Get quotations and compare options', 'Get more than one quotation where practical and note why the choice was made.', 'Quotes compared and the choice', true, true, false, 20),
 ('approval', 'triage', 'Obtain approval before buying', 'Do not order before approval is in writing.', 'Approval reference (who, when, amount)', true, true, true, 30),
 ('order', 'execution', 'Place the order and track delivery', 'Record the order or LPO number and expected delivery date.', 'Order / LPO number and supplier', true, true, false, 40),
 ('receive', 'execution', 'Receive, inspect and test the item', 'Check it matches the order and works.', 'Delivery note and test result', true, true, false, 50),
 ('register', 'handover', 'Record it in the asset register', 'Add the item (serial, cost, purchase date, who has it) in IT Assets above.', 'Asset recorded (name / serial)', true, true, false, 60),
 ('handover', 'closeout', 'Set up and hand over to the user', 'Install software, secure it and have the user confirm receipt.', 'Handover confirmed by', true, true, false, 70),
 ('warranty', 'closeout', 'File warranty and licence details', 'Keep warranty end dates and licence keys where the team can find them.', null::text, false, false, false, 80)
) as v(control_key, category, title, guidance, evidence_hint, mandatory, requires_evidence, requires_verification, sort_order)
where t.service_type = 'procurement' and t.version = 1
on conflict (template_id, control_key) do nothing;

comment on table public.ict_service_templates is 'Versioned ICT Service Desk templates. One active version per service_type; add a new type by inserting a template + controls (no migration needed).';
comment on table public.ict_template_controls is 'Reusable checklist steps for a template. Operational guidance, not legal advice.';
comment on table public.ict_case_controls is 'Per-ticket snapshot of checklist steps with status, evidence and verification. Rules enforced by guard_ict_case_control_update and guard_ict_ticket_completion.';
