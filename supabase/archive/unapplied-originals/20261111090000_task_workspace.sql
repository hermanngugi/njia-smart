-- ============================================================================
-- Task Workspace
--
-- Turns a task into a small workspace everyone involved can work in:
--   * Subtasks handed to teammates who assist
--   * A progress bar (automatic when a task has subtasks, manual otherwise)
--   * Notes, feedback and progress reports from staff
--   * Guidance ("way forward") from the supervisor / manager
--   * Outputs: the document(s) that are the outcome of the task
--   * A timeline of everything that happened, recorded by the database
--
-- Who can open a task: Director/Admin, the person it is assigned to, the person
-- who gave it, its supervisor, and any teammate holding a subtask on it.
-- Who can give tasks / reassign them does NOT change (still Director/Admin).
--
-- Idempotent: safe to run more than once. Run the whole file in the Supabase
-- SQL Editor. Existing tasks and comments are kept as they are.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists supervisor_id uuid references auth.users(id) on delete set null,
  add column if not exists progress smallint not null default 0,
  add column if not exists needs_guidance boolean not null default false;

alter table public.tasks drop constraint if exists tasks_progress_range;
alter table public.tasks add constraint tasks_progress_range check (progress between 0 and 100);

-- task_comments becomes the task's activity feed: notes, feedback, reports,
-- guidance and system events (the timeline).
alter table public.task_comments
  add column if not exists kind text not null default 'note',
  add column if not exists action text,
  add column if not exists ask_guidance boolean not null default false;

alter table public.task_comments drop constraint if exists task_comments_kind_check;
alter table public.task_comments add constraint task_comments_kind_check
  check (kind in ('note', 'feedback', 'report', 'guidance', 'system'));
alter table public.task_comments drop constraint if exists task_comments_action_check;
alter table public.task_comments add constraint task_comments_action_check
  check (action is null or action in ('approved', 'changes_requested', 'continue'));

create index if not exists idx_task_comments_task_created on public.task_comments (task_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. New tables
-- ---------------------------------------------------------------------------
create table if not exists public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  assigned_to uuid references auth.users(id) on delete set null,
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_task_subtasks_task on public.task_subtasks (task_id);
create index if not exists idx_task_subtasks_assignee on public.task_subtasks (assigned_to);
alter table public.task_subtasks enable row level security;
grant select, insert, update, delete on public.task_subtasks to authenticated;
grant all on public.task_subtasks to service_role;

create table if not exists public.task_outputs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  note text,
  is_final boolean not null default false,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_task_outputs_task on public.task_outputs (task_id);
alter table public.task_outputs enable row level security;
grant select, insert, update, delete on public.task_outputs to authenticated;
grant all on public.task_outputs to service_role;

-- ---------------------------------------------------------------------------
-- 3. Who may do what (helper functions used by the policies)
-- ---------------------------------------------------------------------------
-- Can this person open the task at all?
create or replace function public.task_has_access(_task_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    _user_id is not null and (
      public.has_full_module(_user_id, 'tasks')
      or exists (
        select 1 from public.tasks t
         where t.id = _task_id
           and (t.assigned_to = _user_id or t.created_by = _user_id or t.supervisor_id = _user_id)
      )
      or exists (
        select 1 from public.task_subtasks s
         where s.task_id = _task_id and s.assigned_to = _user_id
      )
    ), false);
$$;

-- "Lead" = runs the task: Director/Admin, the assignee, the giver, the supervisor.
create or replace function public.task_is_lead(_task_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    _user_id is not null and (
      public.is_admin(_user_id)
      or exists (
        select 1 from public.tasks t
         where t.id = _task_id
           and (t.assigned_to = _user_id or t.created_by = _user_id or t.supervisor_id = _user_id)
      )
    ), false);
$$;

-- Supervisor side: may give guidance. Director/Admin, the giver, the named supervisor.
create or replace function public.task_is_supervisor(_task_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    _user_id is not null and (
      public.is_admin(_user_id)
      or exists (
        select 1 from public.tasks t
         where t.id = _task_id
           and (t.created_by = _user_id or t.supervisor_id = _user_id)
      )
    ), false);
$$;

revoke all on function public.task_has_access(uuid, uuid) from public, anon;
revoke all on function public.task_is_lead(uuid, uuid) from public, anon;
revoke all on function public.task_is_supervisor(uuid, uuid) from public, anon;
grant execute on function public.task_has_access(uuid, uuid) to authenticated, service_role;
grant execute on function public.task_is_lead(uuid, uuid) to authenticated, service_role;
grant execute on function public.task_is_supervisor(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Row-level security
-- ---------------------------------------------------------------------------
-- tasks: also visible to the supervisor and to teammates holding a subtask.
drop policy if exists "tasks select by rank" on public.tasks;
create policy "tasks select by rank" on public.tasks
  for select to authenticated using (public.task_has_access(tasks.id, auth.uid()));

drop policy if exists "tasks update by rank" on public.tasks;
create policy "tasks update by rank" on public.tasks
  for update to authenticated using (
    public.has_full_module(auth.uid(), 'tasks')
    or tasks.assigned_to = auth.uid()
    or tasks.created_by = auth.uid()
    or tasks.supervisor_id = auth.uid()
  );

-- task_comments (the activity feed)
drop policy if exists "task comments by parent task" on public.task_comments;
drop policy if exists "task comments read" on public.task_comments;
drop policy if exists "task comments write" on public.task_comments;
drop policy if exists "task comments delete" on public.task_comments;

create policy "task comments read" on public.task_comments
  for select to authenticated using (public.task_has_access(task_comments.task_id, auth.uid()));

-- You can only post as yourself. Notes, feedback and reports: anyone on the task.
-- Guidance: only the supervisor side. System events are written by the database.
create policy "task comments write" on public.task_comments
  for insert to authenticated with check (
    public.task_has_access(task_comments.task_id, auth.uid())
    and task_comments.author_id = auth.uid()
    and (
      task_comments.kind in ('note', 'feedback', 'report')
      or (task_comments.kind = 'guidance'
          and public.task_is_supervisor(task_comments.task_id, auth.uid()))
    )
  );

create policy "task comments delete" on public.task_comments
  for delete to authenticated using (
    task_comments.kind <> 'system'
    and (task_comments.author_id = auth.uid() or public.is_admin(auth.uid()))
  );

-- task_subtasks
drop policy if exists "task subtasks read" on public.task_subtasks;
drop policy if exists "task subtasks insert" on public.task_subtasks;
drop policy if exists "task subtasks update" on public.task_subtasks;
drop policy if exists "task subtasks delete" on public.task_subtasks;

create policy "task subtasks read" on public.task_subtasks
  for select to authenticated using (public.task_has_access(task_subtasks.task_id, auth.uid()));
create policy "task subtasks insert" on public.task_subtasks
  for insert to authenticated with check (
    public.task_is_lead(task_subtasks.task_id, auth.uid())
    and task_subtasks.created_by = auth.uid()
  );
create policy "task subtasks update" on public.task_subtasks
  for update to authenticated
  using (public.task_is_lead(task_subtasks.task_id, auth.uid()) or task_subtasks.assigned_to = auth.uid())
  with check (public.task_is_lead(task_subtasks.task_id, auth.uid()) or task_subtasks.assigned_to = auth.uid());
create policy "task subtasks delete" on public.task_subtasks
  for delete to authenticated using (public.task_is_lead(task_subtasks.task_id, auth.uid()));

-- task_outputs
drop policy if exists "task outputs read" on public.task_outputs;
drop policy if exists "task outputs insert" on public.task_outputs;
drop policy if exists "task outputs update" on public.task_outputs;
drop policy if exists "task outputs delete" on public.task_outputs;

create policy "task outputs read" on public.task_outputs
  for select to authenticated using (public.task_has_access(task_outputs.task_id, auth.uid()));
create policy "task outputs insert" on public.task_outputs
  for insert to authenticated with check (
    public.task_has_access(task_outputs.task_id, auth.uid())
    and task_outputs.uploaded_by = auth.uid()
  );
create policy "task outputs update" on public.task_outputs
  for update to authenticated
  using (public.task_is_lead(task_outputs.task_id, auth.uid()))
  with check (public.task_is_lead(task_outputs.task_id, auth.uid()));
create policy "task outputs delete" on public.task_outputs
  for delete to authenticated using (
    task_outputs.uploaded_by = auth.uid() or public.task_is_lead(task_outputs.task_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 5. Guards
-- ---------------------------------------------------------------------------
-- A helper (not the lead) may tick their own subtask done, but not rewrite it.
-- Not security definer, so current_user is the real caller role.
create or replace function public.tg_task_subtask_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated'
     and auth.uid() is not null
     and not public.task_is_lead(old.task_id, auth.uid())
     and (new.task_id is distinct from old.task_id
          or new.title is distinct from old.title
          or new.assigned_to is distinct from old.assigned_to
          or new.due_date is distinct from old.due_date) then
    raise exception 'Only the task owner, supervisor or admin can change a subtask''s title, owner or date. You can mark your own subtask done.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_subtask_guard on public.task_subtasks;
create trigger trg_task_subtask_guard
  before update on public.task_subtasks
  for each row execute function public.tg_task_subtask_guard();

-- Only the giver or an admin can name / change the supervisor.
create or replace function public.tg_task_supervisor_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated'
     and auth.uid() is not null
     and not public.is_admin(auth.uid())
     and new.created_by is distinct from auth.uid()
     and new.supervisor_id is distinct from old.supervisor_id then
    raise exception 'Only the person who gave the task, or a director/admin, can change its supervisor.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_supervisor_guard on public.tasks;
create trigger trg_task_supervisor_guard
  before update of supervisor_id on public.tasks
  for each row execute function public.tg_task_supervisor_guard();

-- ---------------------------------------------------------------------------
-- 6. Automatic bookkeeping
-- ---------------------------------------------------------------------------
-- done_at on subtasks
create or replace function public.tg_task_subtask_done_at()
returns trigger
language plpgsql
as $$
begin
  if new.done and (tg_op = 'INSERT' or old.done is distinct from true) then
    new.done_at := now();
  elsif not new.done then
    new.done_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_subtask_done_at on public.task_subtasks;
create trigger trg_task_subtask_done_at
  before insert or update of done on public.task_subtasks
  for each row execute function public.tg_task_subtask_done_at();

-- A finished task is 100%.
create or replace function public.tg_task_progress_on_done()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' then
    new.progress := 100;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_progress_on_done on public.tasks;
create trigger trg_task_progress_on_done
  before insert or update of status on public.tasks
  for each row execute function public.tg_task_progress_on_done();

-- With subtasks, progress = share of subtasks done (kept on the task itself so
-- lists and reports can use it).
create or replace function public.tg_task_subtasks_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _task uuid := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  _total int;
  _done int;
  _pct smallint;
begin
  select count(*), count(*) filter (where done) into _total, _done
    from public.task_subtasks where task_id = _task;
  if _total > 0 then
    _pct := round(_done * 100.0 / _total)::smallint;
    update public.tasks set progress = _pct
     where id = _task and progress is distinct from _pct and status <> 'done';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_task_subtasks_progress on public.task_subtasks;
create trigger trg_task_subtasks_progress
  after insert or update of done or delete on public.task_subtasks
  for each row execute function public.tg_task_subtasks_progress();

-- "Needs guidance" flag: a report that asks for it raises it, guidance clears it.
create or replace function public.tg_task_guidance_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'report' and new.ask_guidance then
    update public.tasks set needs_guidance = true where id = new.task_id and not needs_guidance;
  elsif new.kind = 'guidance' then
    update public.tasks set needs_guidance = false where id = new.task_id and needs_guidance;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_task_guidance_flag on public.task_comments;
create trigger trg_task_guidance_flag
  after insert on public.task_comments
  for each row execute function public.tg_task_guidance_flag();

-- ---------------------------------------------------------------------------
-- 7. Timeline: the database records what happened
-- ---------------------------------------------------------------------------
create or replace function public.tg_task_log_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _who uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.task_comments (task_id, author_id, kind, body)
    values (new.id, _who, 'system', 'Task created');
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.task_comments (task_id, author_id, kind, body)
    values (new.id, _who, 'system',
            'Status changed from ' || replace(old.status::text, '_', ' ') || ' to ' || replace(new.status::text, '_', ' '));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.task_comments (task_id, author_id, kind, body)
    values (new.id, _who, 'system',
            'Assigned to ' || coalesce((select full_name from public.profiles where id = new.assigned_to), 'nobody'));
  end if;
  if new.supervisor_id is distinct from old.supervisor_id then
    insert into public.task_comments (task_id, author_id, kind, body)
    values (new.id, _who, 'system',
            'Supervisor set to ' || coalesce((select full_name from public.profiles where id = new.supervisor_id), 'nobody'));
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.task_comments (task_id, author_id, kind, body)
    values (new.id, _who, 'system',
            'Due date changed to ' || coalesce(to_char(new.due_date, 'DD Mon YYYY'), 'none'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_log_events on public.tasks;
create trigger trg_task_log_events
  after insert or update of status, assigned_to, supervisor_id, due_date on public.tasks
  for each row execute function public.tg_task_log_events();

create or replace function public.tg_task_subtask_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _who uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.task_comments (task_id, author_id, kind, body)
    values (new.task_id, _who, 'system',
            'Subtask added: ' || new.title ||
            coalesce(' (assigned to ' || (select full_name from public.profiles where id = new.assigned_to) || ')', ''));
  elsif new.done is distinct from old.done then
    insert into public.task_comments (task_id, author_id, kind, body)
    values (new.task_id, _who, 'system',
            case when new.done then 'Subtask completed: ' else 'Subtask reopened: ' end || new.title);
  elsif new.assigned_to is distinct from old.assigned_to then
    insert into public.task_comments (task_id, author_id, kind, body)
    values (new.task_id, _who, 'system',
            'Subtask "' || new.title || '" assigned to ' ||
            coalesce((select full_name from public.profiles where id = new.assigned_to), 'nobody'));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_task_subtask_log on public.task_subtasks;
create trigger trg_task_subtask_log
  after insert or update of done, assigned_to on public.task_subtasks
  for each row execute function public.tg_task_subtask_log();

create or replace function public.tg_task_output_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _who uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.task_comments (task_id, author_id, kind, body)
    values (new.task_id, _who, 'system',
            'Output added: ' || new.file_name || case when new.is_final then ' (final outcome)' else '' end);
  elsif new.is_final is distinct from old.is_final and new.is_final then
    insert into public.task_comments (task_id, author_id, kind, body)
    values (new.task_id, _who, 'system', 'Marked as the final outcome: ' || new.file_name);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_task_output_log on public.task_outputs;
create trigger trg_task_output_log
  after insert or update of is_final on public.task_outputs
  for each row execute function public.tg_task_output_log();

-- ---------------------------------------------------------------------------
-- 8. Live updates (so the workspace refreshes by itself)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['tasks', 'task_comments', 'task_subtasks', 'task_outputs'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Output files: private bucket, only people on the task can read/write
--    (files are stored as <task_id>/<timestamp>-<name>)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('task-outputs', 'task-outputs', false)
on conflict (id) do nothing;

create or replace function public.task_output_task(_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(_name, '/', 1)::uuid
    else null
  end;
$$;

drop policy if exists "task outputs files read" on storage.objects;
drop policy if exists "task outputs files write" on storage.objects;
drop policy if exists "task outputs files delete" on storage.objects;

create policy "task outputs files read" on storage.objects
  for select to authenticated
  using (bucket_id = 'task-outputs'
         and public.task_has_access(public.task_output_task(name), auth.uid()));

create policy "task outputs files write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-outputs'
              and public.task_has_access(public.task_output_task(name), auth.uid()));

create policy "task outputs files delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'task-outputs'
         and public.task_has_access(public.task_output_task(name), auth.uid())
         and (owner = auth.uid() or public.task_is_lead(public.task_output_task(name), auth.uid())));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- CHECK 1: should list the three new objects and the new columns
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks'
      and column_name in ('supervisor_id', 'progress', 'needs_guidance')) as task_columns_expected_3,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('task_subtasks', 'task_outputs')) as new_tables_expected_2,
  (select count(*) from storage.buckets where id = 'task-outputs') as bucket_expected_1;
